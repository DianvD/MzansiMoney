"""Ingestion orchestration - turn parsed rows into duplicate-safe transaction docs.

This is pure (no Firestore) so the dedup-critical logic is unit-testable. It:
  1. assigns the within-document occurrence index used by the no-balance
     fingerprint fallback,
  2. computes each transaction's fingerprint (its Firestore doc id),
  3. de-duplicates identical rows *within the file* by fingerprint, and
  4. runs the balance-chain integrity check.

The Firestore write + document-ledger dedup lives in ``documents.py`` / ``main.py``.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date

from .categorize import categorize, home_loan_category
from .identity import account_id, clean_account_number, normalize_desc, transaction_fingerprint
from .model import CASH, HOME_LOAN, RawTxn, normalize


@dataclass
class PreparedTxn:
    fingerprint: str
    doc: dict


@dataclass
class IngestPrep:
    account: str
    transactions: list[PreparedTxn]
    duplicates_in_file: int
    has_balance: bool
    integrity_ok: bool | None  # None = not checkable (no balance column)
    integrity_detail: str
    period_start: date | None = None
    period_end: date | None = None
    rows_parsed: int = 0
    warnings: list[str] = field(default_factory=list)


def prepare_transactions(
    raw_txns: list[RawTxn],
    *,
    institution: str,
    account: str,
    source_document: str,
    document_id: str,
    learned: dict[str, str] | None = None,
    account_type: str = CASH,
    account_number: str | None = None,
) -> IngestPrep:
    acct = account_id(institution, account, account_number)
    acct_number = clean_account_number(account_number)

    # Pass 1: normalize so we can decide the fingerprint scheme for the WHOLE
    # document before assigning any ids.
    prelim: list[tuple] = []
    for raw in raw_txns:
        doc = normalize(
            raw,
            account=account,
            institution=institution,
            source_document=source_document,
            job_id=document_id,
            account_type=account_type,
        )
        nd = normalize_desc(doc["description"])
        prelim.append((raw, doc, nd))

    any_balance = any(d["balance"] is not None for _, d, _ in prelim)
    all_have_balance = len(prelim) > 0 and all(d["balance"] is not None for _, d, _ in prelim)
    integrity_ok, detail = (
        _check_balance_chain(raw_txns) if any_balance else (None, "no balance column")
    )

    # CRITICAL: only key transactions on the running balance when EVERY row has a
    # balance AND the chain verifies (strictly changing, internally consistent).
    # If the balance is partial, constant, or mis-mapped, the chain check fails
    # and we fall back to the description+occurrence scheme - otherwise two
    # distinct same-day, same-amount rows sharing a repeated balance would
    # silently collapse into one (lost transaction).
    use_balance = all_have_balance and integrity_ok is True

    seen_day: dict[tuple, int] = {}
    prepared: dict[str, PreparedTxn] = {}

    for raw, doc, nd in prelim:
        signed = doc["signedAmount"]
        day_key = (raw.date.date(), round(signed, 2), nd)
        day_index = seen_day.get(day_key, 0)
        seen_day[day_key] = day_index + 1

        fingerprint = transaction_fingerprint(
            account=acct,
            when=raw.date,
            signed_amount=signed,
            balance_after=doc["balance"] if use_balance else None,
            norm_desc=nd,
            day_index=day_index,
        )

        doc["accountId"] = acct
        doc["accountNumber"] = acct_number
        doc["documentId"] = document_id
        doc["dayIndex"] = day_index
        doc["balanceAfter"] = doc["balance"]
        doc["hash"] = fingerprint
        doc["fingerprintScheme"] = "balance" if use_balance else "sequence"
        if account_type == HOME_LOAN:
            doc["category"] = home_loan_category(doc["description"])
        else:
            doc["category"] = categorize(doc["merchant"], doc["description"], doc["direction"], learned)

        # Same fingerprint within one file => truly the same line repeated; the
        # later one overwrites.
        prepared[fingerprint] = PreparedTxn(fingerprint, doc)

    dates = [r.date.date() for r in raw_txns]
    return IngestPrep(
        account=acct,
        transactions=list(prepared.values()),
        duplicates_in_file=len(raw_txns) - len(prepared),
        has_balance=use_balance,
        integrity_ok=integrity_ok,
        integrity_detail=detail,
        period_start=min(dates) if dates else None,
        period_end=max(dates) if dates else None,
        rows_parsed=len(raw_txns),
    )


def _check_balance_chain(raw_txns: list[RawTxn], tol: float = 0.01) -> tuple[bool, str]:
    """Verify ``balance[i] == balance[i-1] + signedAmount[i]`` along the rows that
    carry a balance. Statements may be oldest- or newest-first, so we accept
    whichever orientation is internally consistent. Advisory: a failure flags the
    document for review rather than blocking import.
    """
    seq = [r for r in raw_txns if r.balance is not None]
    if len(seq) < 2:
        return True, "too few balance points to verify"

    def signed(r: RawTxn) -> float:
        return r.amount if r.direction == "credit" else -r.amount

    def consistent(forward: bool) -> tuple[bool, str]:
        for i in range(1, len(seq)):
            prev, cur = seq[i - 1], seq[i]
            delta = signed(cur) if forward else -signed(prev)
            base = prev.balance if forward else cur.balance
            target = cur.balance if forward else prev.balance
            if abs((base + delta) - target) > tol:
                return False, (
                    f"balance break near {cur.date.date()} "
                    f"({prev.balance:.2f} -> {cur.balance:.2f}, line {signed(cur):+.2f})"
                )
        return True, "balance chain verified"

    ok_fwd, detail_fwd = consistent(True)
    if ok_fwd:
        return True, detail_fwd
    ok_rev, _ = consistent(False)
    if ok_rev:
        return True, "balance chain verified (newest-first)"
    return False, detail_fwd
