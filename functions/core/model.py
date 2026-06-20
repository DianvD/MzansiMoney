"""The common internal transaction format.

Every parser emits ``RawTxn`` objects. ``normalize`` turns one into the canonical
Firestore document shape that the whole app reads. This is the single source of
truth for what a transaction *is*; change it here and the rest follows.
"""
from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional

DEBIT = "debit"
CREDIT = "credit"

# Account types. A *cash* account (cheque/savings) holds money you have: a credit
# adds to it, a debit subtracts. A *home_loan* account is a liability - it tracks
# what you OWE: a debit (interest/insurance/fee charged) increases the balance
# owed, a credit (a payment, or a deposit into the access bond) reduces it. The
# distinction drives the sign of ``signedAmount`` and keeps the bond out of the
# cash dashboard (interest must never read as income).
CASH = "cash"
HOME_LOAN = "home_loan"


@dataclass
class RawTxn:
    """What a parser produces - institution-agnostic, not yet categorized."""

    date: datetime
    description: str
    amount: float  # always a positive magnitude; sign lives in ``direction``
    direction: str  # DEBIT or CREDIT
    reference: str = ""
    balance: Optional[float] = None
    raw: dict = field(default_factory=dict)  # original row, kept for debugging


# Noise we strip when guessing a clean merchant name from a bank narrative.
_MERCHANT_NOISE = re.compile(
    r"\b(pos|purchase|payment|card|ref|reference|auth|tfr|transfer|debit|credit|"
    r"order|trans|fee|eft|deb|cr|dr|za|zar|rand)\b",
    re.IGNORECASE,
)
# Card/ref numbers - 4+ digit runs, even when glued to text ("Velddrif5181030010").
_LONG_NUMBER = re.compile(r"\d[\d*x]{3,}", re.IGNORECASE)
_DATE_FRAGMENT = re.compile(r"\b\d{1,2}[/-]\d{1,2}([/-]\d{2,4})?\b")
_MULTISPACE = re.compile(r"\s{2,}")


def derive_merchant(description: str) -> str:
    """Best-effort clean merchant name from a noisy bank description.

    Heuristic, not perfect - the categorizer and (future) learned overrides do
    the heavy lifting. We just want a human-readable label.
    """
    text = description or ""
    text = _LONG_NUMBER.sub(" ", text)
    text = _DATE_FRAGMENT.sub(" ", text)
    text = _MERCHANT_NOISE.sub(" ", text)
    text = re.sub(r"[^A-Za-z0-9&'\- ]", " ", text)
    text = _MULTISPACE.sub(" ", text).strip()
    if not text:
        return (description or "Unknown").strip()[:60] or "Unknown"
    # Keep it short; merchant names are usually the first couple of tokens.
    tokens = text.split()
    merchant = " ".join(tokens[:4])
    return merchant.title()


def txn_hash(date: datetime, amount: float, direction: str, description: str) -> str:
    """Stable id for a transaction, used as the Firestore doc id.

    Using the hash as the document id makes imports idempotent: re-uploading the
    same statement overwrites identical rows instead of duplicating them.
    """
    key = f"{date.date().isoformat()}|{amount:.2f}|{direction}|{(description or '').strip().lower()}"
    return hashlib.sha1(key.encode("utf-8")).hexdigest()


def normalize(
    raw: RawTxn,
    *,
    account: str,
    institution: str,
    source_document: str,
    job_id: str,
    account_type: str = CASH,
) -> dict:
    """Convert a ``RawTxn`` into the canonical Firestore transaction document.

    ``category`` is left as "Uncategorized" here; the caller runs the categorizer
    and ``createdAt`` is stamped server-side at write time.

    ``signedAmount`` is the signed effect on the account's headline number. For a
    cash account that's the change in cash (credits +, debits -). For a home-loan
    (liability) account it's the change in the balance *owed* (a charge/debit
    increases it, a payment/credit reduces it) - the opposite sign convention.
    """
    amount = round(abs(float(raw.amount)), 2)
    direction = raw.direction if raw.direction in (DEBIT, CREDIT) else DEBIT
    description = (raw.description or "").strip()
    if account_type == HOME_LOAN:
        signed = amount if direction == DEBIT else -amount
    else:
        signed = amount if direction == CREDIT else -amount
    return {
        "date": raw.date,
        "description": description,
        "merchant": derive_merchant(description),
        "amount": amount,
        # Signed convenience value for easy summing on the client. Cash: credits +,
        # debits -. Home loan (liability): debits + (owe more), credits - (owe less).
        "signedAmount": signed,
        "direction": direction,
        "accountType": account_type,
        "category": "Uncategorized",
        "account": account,
        "reference": (raw.reference or "").strip(),
        "balance": raw.balance,
        "sourceDocument": source_document,
        "sourceInstitution": institution,
        "importJobId": job_id,
        "hash": txn_hash(raw.date, amount, direction, description),
    }
