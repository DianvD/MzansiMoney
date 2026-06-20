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

from datetime import date, datetime
from typing import Optional

from .categorize import categorize
from .classify import ClassifiedDoc
from .identity import digest, slug


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
    c: ClassifiedDoc, *, document_id: str, source_document: str
) -> tuple[str, dict]:
    """Return (bill_id, bill_doc) for an invoice-type classified document."""
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
        "paidTransactionId": None,
        "documentId": document_id,
        "sourceDocument": source_document,
    }
    return fingerprint, bill
