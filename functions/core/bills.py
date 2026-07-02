"""Bills / payables - what you OWE, derived from invoices.

A bill is created from an invoice/pro-forma/municipal document. Its id is a
stable fingerprint so re-importing the same invoice (or the same invoice arriving
by a second channel) overwrites rather than creating a second payable - the
bill-level twin of the transaction dedup.

Crucially, only *invoices* mint bills. A biller statement's closing balance is NOT
turned into a separate bill, because that same charge already exists as an
invoice - synthesising one from a statement would double-count the obligation.
"""
from __future__ import annotations

import math
import re
from datetime import date, datetime
from typing import Optional

from .categorize import categorize
from .classify import ClassifiedDoc
from .identity import digest, slug

# ---------------------------------------------------------------------------
# Bill-update validation
# ---------------------------------------------------------------------------

_ALLOWED_SET_KEYS = frozenset({"paid", "payTo", "amount", "dueDate", "note"})
_ALLOWED_PAY_TO_KEYS = frozenset(
    {"beneficiary", "bank", "accountNumber", "branchCode", "accountType", "reference"}
)
_MAX_STR_LEN = 120


def _sanitize_str(value: object, field: str) -> str:
    """Strip whitespace and control characters, truncate to _MAX_STR_LEN."""
    if not isinstance(value, str):
        raise ValueError(f"{field} must be a string.")
    cleaned = re.sub(r"[\x00-\x1f\x7f]", "", value).strip()
    return cleaned[:_MAX_STR_LEN]


def validate_bill_update(set_data: object) -> dict:
    """Validate and sanitize the ``set`` payload for the ``update_bill`` callable.

    Raises ``ValueError`` with a user-readable message on any invalid input.
    Returns a clean dict ready for a Firestore merge write.
    """
    if not isinstance(set_data, dict):
        raise ValueError("set must be an object.")

    unknown = set(set_data.keys()) - _ALLOWED_SET_KEYS
    if unknown:
        raise ValueError(f"Unknown key(s): {', '.join(sorted(unknown))}.")

    result: dict = {}

    if "paid" in set_data:
        val = set_data["paid"]
        if not isinstance(val, bool):
            raise ValueError("paid must be a boolean.")
        result["paid"] = val

    if "payTo" in set_data:
        pay_to_raw = set_data["payTo"]
        if not isinstance(pay_to_raw, dict):
            raise ValueError("payTo must be an object.")
        unknown_pt = set(pay_to_raw.keys()) - _ALLOWED_PAY_TO_KEYS
        if unknown_pt:
            raise ValueError(f"Unknown payTo key(s): {', '.join(sorted(unknown_pt))}.")
        pay_to: dict = {}
        for k in _ALLOWED_PAY_TO_KEYS:
            if k in pay_to_raw:
                # Empty string is allowed - it signals "clear this key".
                pay_to[k] = _sanitize_str(pay_to_raw[k], f"payTo.{k}")
        result["payTo"] = pay_to

    if "amount" in set_data:
        try:
            amt = float(set_data["amount"])
        except (TypeError, ValueError):
            raise ValueError("amount must be a number.")
        if not math.isfinite(amt) or amt <= 0:
            raise ValueError("amount must be a positive finite number.")
        result["amount"] = round(amt, 2)

    if "dueDate" in set_data:
        val = set_data["dueDate"]
        if not isinstance(val, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", val):
            raise ValueError("dueDate must be YYYY-MM-DD.")
        try:
            datetime.strptime(val, "%Y-%m-%d")
        except ValueError:
            raise ValueError("dueDate is not a valid calendar date.")
        result["dueDate"] = val

    if "note" in set_data:
        result["note"] = _sanitize_str(set_data["note"], "note")

    return result


def bill_fingerprint(
    institution: str,
    doc_number: Optional[str],
    account: Optional[str],
    due_date: Optional[date],
    amount: Optional[float],
) -> str:
    """Stable id for a bill. Prefer the biller's own document number; fall back to
    (institution, account, due date, amount)."""
    if doc_number:
        return "bill:" + digest(slug(institution), doc_number.upper())
    return "bill:" + digest(
        slug(institution),
        slug(account or ""),
        due_date.isoformat() if due_date else "",
        f"{amount:.2f}" if amount is not None else "",
    )


def _ts(d: Optional[date]):
    if d is None:
        return None
    return datetime(d.year, d.month, d.day)


def classified_to_bill(
    c: ClassifiedDoc,
    *,
    document_id: str,
    source_document: str,
    pay_to: Optional[dict] = None,
) -> tuple[str, dict]:
    """Return (bill_id, bill_doc) for an invoice-type classified document.

    ``pay_to`` is the structured payment-details dict produced by
    ``classify.extract_payment_details``; pass ``{}`` or omit when the invoice
    carries no banking details (the frontend treats missing/empty payTo as {}).
    """
    fingerprint = bill_fingerprint(c.institution, c.doc_number, c.account, c.due_date, c.total)
    category = categorize(c.institution, c.doc_type)
    label = c.doc_type.replace("_", " ")
    bill = {
        "institution": c.institution,
        "docNumber": c.doc_number,
        "account": c.account,
        "description": f"{c.institution} {label}".strip(),
        "amount": c.total,
        "currency": "ZAR",
        "issueDate": _ts(c.issue_date),
        "dueDate": _ts(c.due_date),
        "docType": c.doc_type,
        "category": category,
        "paid": False,
        "paidAt": None,
        "payTo": pay_to or {},
        "paidTransactionId": None,
        "documentId": document_id,
        "sourceDocument": source_document,
    }
    return fingerprint, bill
