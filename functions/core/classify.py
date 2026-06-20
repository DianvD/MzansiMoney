"""Document classification + header extraction.

Given the text of a financial PDF, decide *what it is* (invoice vs statement vs
bank statement) and pull the identity fields that drive dedup and routing:
institution, document number, account, total, dates.

Routing matters for accuracy: an **invoice** is something you *owe* (-> a Bill);
a **statement** is a ledger of money that *moved* (-> Transactions). Counting an
invoice as a transaction - when its charge also shows up inside a statement and
again as a bank debit - is exactly how totals get inflated.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Optional

from .parsers.base import BaseParser

# doc_type values
INVOICE = "invoice"
PROFORMA = "proforma_invoice"
MUNICIPAL = "municipal_invoice"
STATEMENT = "statement"
BANK_STATEMENT = "bank_statement"
UNKNOWN = "unknown"

# institution slug -> keywords that identify it. CRITICAL: these must identify the
# *issuer*, not the customer. A customer's home address appears on EVERY invoice
# billed to them, so municipal and HOA entries key on the biller's DOMAIN / managing
# agent (which only appear on the real biller's document), never on address tokens.
# These are example issuers - add your own billers' identifying keywords.
_INSTITUTIONS: list[tuple[str, list[str]]] = [
    ("Vodacom", ["vodacom"]),
    ("Axxess", ["axxess"]),
    ("Municipality", ["gov.za", "municipality"]),
    ("Estate HOA", ["estate management", "homeowners association"]),
    ("Nedbank", ["nedbank"]),
    ("FNB", ["first national bank", "fnb"]),
    ("Capitec", ["capitec"]),
    ("Absa", ["absa"]),
    ("Standard Bank", ["standard bank"]),
    ("Discovery", ["discovery"]),
]

# Where the customer block starts - institution detection ignores everything from
# here on, so the bill-to address and a statement's transaction lines (which list
# merchant names like "Vodacom") can't hijack the issuer.
_CUSTOMER_MARKERS = (
    "bill to", "billed to", "invoice to", "invoiced to", "sold to",
    "statement to", "deliver to", "customer", "account holder",
)

_AMOUNT = r"[R$]?\s*([\d][\d  ,]*\.\d{2})"
# code -> ISO currency. Default ZAR (South African docs).
_CURRENCY_SIGNS = [("usd", "USD"), ("$", "USD"), ("eur", "EUR"), ("gbp", "GBP")]
_DATE_PATTERNS = [
    (re.compile(r"(\d{4}-\d{2}-\d{2})"), "%Y-%m-%d"),
    (re.compile(r"(\d{2}/\d{2}/\d{4})"), "%d/%m/%Y"),
]


@dataclass
class ClassifiedDoc:
    doc_type: str
    institution: str
    doc_number: Optional[str] = None
    account: Optional[str] = None
    total: Optional[float] = None
    issue_date: Optional[date] = None
    due_date: Optional[date] = None
    period_start: Optional[date] = None
    period_end: Optional[date] = None
    is_bill: bool = False
    currency: str = "ZAR"
    notes: list[str] = field(default_factory=list)


def classify(text: str, filename: str = "") -> ClassifiedDoc:
    low = text.lower()

    institution = _detect_institution(low)
    doc_type = _detect_type(low, institution)
    doc_number = _extract_doc_number(text, filename, doc_type)
    account = _extract_account(text)
    total = _extract_total(text, doc_type)
    currency = _detect_currency(low)
    issue_date, due_date = _extract_dates(text, doc_type)

    is_bill = doc_type in (INVOICE, PROFORMA, MUNICIPAL)
    return ClassifiedDoc(
        doc_type=doc_type,
        institution=institution,
        doc_number=doc_number,
        account=account,
        total=total,
        issue_date=issue_date,
        due_date=due_date,
        is_bill=is_bill,
        currency=currency,
    )


def _detect_currency(low: str) -> str:
    """Currency of the amount due. Look in the 'amount due' / 'total' context so a
    stray '$' elsewhere doesn't flip it; default ZAR (local docs)."""
    m = re.search(r"(amount due|total due|amount payable|total)[^\n]{0,40}", low)
    ctx = m.group(0) if m else low[:400]
    for sign, code in _CURRENCY_SIGNS:
        if sign in ctx:
            return code
    return "ZAR"


def _issuer_region(low: str) -> str:
    """The masthead - text before the customer block, capped so a long statement's
    transaction lines don't leak in. This is where the issuer identifies itself."""
    cut = len(low)
    for marker in _CUSTOMER_MARKERS:
        i = low.find(marker)
        if i != -1:
            cut = min(cut, i)
    return low[: min(cut, 800)]


def _detect_institution(low: str) -> str:
    # Prefer the issuer region (top of the document). Only if nothing matches there
    # do we fall back to the whole text - which is how a one-off layout that puts
    # the biller name lower down (e.g. some Vodacom invoices) still resolves, while
    # a bank statement's "Vodacom" debit line never beats the bank's own masthead.
    head = _issuer_region(low)
    for name, keywords in _INSTITUTIONS:
        if any(k in head for k in keywords):
            return name
    for name, keywords in _INSTITUTIONS:
        if any(k in low for k in keywords):
            return name
    return "Unknown"


def _detect_type(low: str, institution: str) -> str:
    if "proforma" in low or "pro forma" in low:
        return PROFORMA
    if institution == "City of Cape Town":
        return MUNICIPAL
    # A statement is a dated ledger with a running balance / ageing.
    statement_signals = ("cumulative", "balance b/f", "balance fwd", "account summary",
                         "120+ days", "opening balance", "closing balance")
    is_statement = ("statement" in low) and any(s in low for s in statement_signals)
    if is_statement:
        # Distinguish a *bank* statement (cash account) from a biller statement.
        if any(b in low for b in ("nedbank", "fnb", "capitec", "absa", "standard bank")) \
                and "available balance" in low:
            return BANK_STATEMENT
        return STATEMENT
    if "tax invoice" in low or "invoice" in low:
        return INVOICE
    return UNKNOWN


def _extract_doc_number(text: str, filename: str, doc_type: str) -> Optional[str]:
    # Statements must NOT borrow an invoice line's number as their identity, or a
    # standalone invoice with that number would be wrongly flagged a duplicate.
    if doc_type in (STATEMENT, BANK_STATEMENT):
        m = re.search(r"(?:statement)[-_]?(\d{4,})", filename, re.IGNORECASE)
        return m.group(1) if m else None

    patterns = [
        r"Invoice number[:\s]+([A-Z0-9][A-Z0-9\-]{3,})",
        r"Tax invoice number[:\s]+([A-Z0-9][A-Z0-9\-]{6,})",
        r"\b(INV\d{4,})\b",
        r"INVOICE NO\.?\s*\n?\s*([A-Z0-9][A-Z0-9\-]{3,})",
    ]
    for pat in patterns:
        m = re.search(pat, text, re.IGNORECASE)
        if m:
            candidate = m.group(1).strip()
            # A real document number contains a digit; this rejects label words
            # like "Customer" that follow the matched phrase in linear PDF text.
            if any(ch.isdigit() for ch in candidate):
                return candidate
    # Fall back to a number embedded in the filename (e.g. CustomerStatement-178172.pdf)
    m = re.search(r"(?:statement|inv|invoice)[-_]?(\d{4,})", filename, re.IGNORECASE)
    if m:
        return m.group(1)
    return None


def _extract_account(text: str) -> Optional[str]:
    for pat in [
        r"Account number[:\s]+([A-Z0-9][A-Z0-9\-]{3,})",
        r"Account No\.?\W*([A-Z0-9][A-Z0-9\-]{3,})",
    ]:
        m = re.search(pat, text, re.IGNORECASE)
        if m:
            return m.group(1).strip()
    return None


def _extract_total(text: str, doc_type: str) -> Optional[float]:
    # Look for the strongest "what is owed" label first.
    labels = [
        r"INVOICE TOTAL[:\s]*" + _AMOUNT,
        r"Total due(?:\s+if not paid in cash)?[:\s]*" + _AMOUNT,
        r"Amount due[:\s]*" + _AMOUNT,
        r"This Invoice Amount[:\s]*\S*\s*\S*\s*" + _AMOUNT,
        # plain TOTAL, but not the "Sub Total" line
        r"(?<!sub )TOTAL[:\s]*" + _AMOUNT,
    ]
    for pat in labels:
        m = re.search(pat, text, re.IGNORECASE)
        if m:
            return BaseParser.parse_amount(m.group(1))
    return None


def _extract_dates(text: str, doc_type: str):
    issue = _find_labeled_date(text, ["invoice date", "statement\\s*date", "date"])
    due = _find_labeled_date(text, ["due date"])
    return issue, due


def _find_labeled_date(text: str, labels: list[str]) -> Optional[date]:
    for label in labels:
        m = re.search(label + r"[:\s ]*" + r"(\d{4}-\d{2}-\d{2}|\d{2}/\d{2}/\d{4})",
                      text, re.IGNORECASE)
        if m:
            return _parse_date(m.group(1))
    return None


def _parse_date(value: str) -> Optional[date]:
    for pat, fmt in _DATE_PATTERNS:
        if pat.fullmatch(value):
            try:
                return datetime.strptime(value, fmt).date()
            except ValueError:
                pass
    return None
