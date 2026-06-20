"""Identity & hashing - the core of accurate, duplicate-free imports.

Two kinds of identity live here:

* **Document identity** - ``content_sha256`` of the raw bytes, and a ``logical_key``
  for "the same statement obtained a different way".
* **Transaction identity** - ``transaction_fingerprint``, deliberately built so it
  is *unique within a document* (two genuinely identical transactions both
  survive) yet *identical across documents* (the same real transaction in two
  overlapping statements reconciles to one). The running balance is what makes
  both true at once; without it we fall back to a within-document occurrence
  index.

Getting this wrong silently corrupts every downstream number, so the rules are
explicit and tested in ``_dedup_test.py``.
"""
from __future__ import annotations

import hashlib
import re
from datetime import date, datetime

_SLUG_STRIP = re.compile(r"[^a-z0-9]+")
_LONG_DIGITS = re.compile(r"\d{4,}")
_MULTISPACE = re.compile(r"\s+")
# Account number inside a statement body ("Account Number : ,1234567890").
_ACCT_IN_TEXT = re.compile(r"account\s*(?:number|no)\s*[:,\-\s]*?(\d{6,})", re.IGNORECASE)
# ...or in a Nedbank export filename: Statement_9876543210_01Jan2025-...csv
_ACCT_IN_NAME = re.compile(r"(?:statement|account|acc|stmt)[_\s\-]*?(\d{6,})", re.IGNORECASE)
_DIGIT_RUN = re.compile(r"(?<!\d)(\d{8,20})(?!\d)")


def _h(*parts: object) -> str:
    raw = "|".join("" if p is None else str(p) for p in parts)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def content_sha256(data: bytes) -> str:
    """Stable hash of a raw uploaded artifact (CSV bytes, PDF bytes)."""
    return hashlib.sha256(data).hexdigest()


def digest(*parts: object) -> str:
    """Public stable hash of arbitrary parts (used for bill ids etc.)."""
    return _h(*parts)


def slug(*parts: str) -> str:
    joined = ":".join(p for p in parts if p)
    return _SLUG_STRIP.sub("-", joined.lower()).strip("-")


def clean_account_number(value: str | None) -> str | None:
    """Digits-only account number, or None. Strips spaces/dashes a user may type."""
    if not value:
        return None
    digits = re.sub(r"\D", "", str(value))
    return digits or None


def extract_account_number(filename: str = "", text: str = "") -> str | None:
    """Recover the bank account number from a statement. The number is the stable
    identity of an account, so the user's free-text label can't spawn a phantom
    duplicate. Prefer the statement body, then the filename."""
    m = _ACCT_IN_TEXT.search(text or "")
    if m:
        return m.group(1)
    m = _ACCT_IN_NAME.search(filename or "")
    if m:
        return m.group(1)
    m = _DIGIT_RUN.search(filename or "")
    if m:
        return m.group(1)
    return None


def account_id(institution: str, account: str, account_number: str | None = None) -> str:
    """Scope transactions to an account so identical amounts in *different*
    accounts never collide.

    Identity is the **account number** when known (``nedbank-9876543210``), so the
    same account dedups regardless of the label the user typed. Without a number we
    fall back to the institution+label slug."""
    digits = clean_account_number(account_number)
    if digits:
        return slug(institution or "unknown") + "-" + digits
    return slug(institution or "unknown", account or "default")


def normalize_desc(desc: str) -> str:
    """Lower-case, strip long digit runs (card/ref numbers) and collapse space -
    so the same line described slightly differently across exports still matches
    in the no-balance fallback."""
    text = (desc or "").lower()
    text = _LONG_DIGITS.sub("", text)
    text = _MULTISPACE.sub(" ", text)
    return text.strip()


def _norm_date(d: date | datetime) -> str:
    if isinstance(d, datetime):
        d = d.date()
    return d.isoformat()


def transaction_fingerprint(
    *,
    account: str,
    when: date | datetime,
    signed_amount: float,
    balance_after: float | None,
    norm_desc: str = "",
    day_index: int = 0,
) -> str:
    """Content-addressable id for a transaction (used as the Firestore doc id).

    ``signed_amount`` is +credit / -debit. When ``balance_after`` is present we
    key on it (unique per line, stable across docs). Otherwise we key on the
    normalized description plus ``day_index`` (the n-th identical line that day in
    this document), which keeps re-imports idempotent without collapsing real
    duplicates.
    """
    if balance_after is not None:
        return "b:" + _h(account, _norm_date(when), f"{signed_amount:.2f}", f"{balance_after:.2f}")
    return "s:" + _h(account, _norm_date(when), f"{signed_amount:.2f}", norm_desc, day_index)


def logical_key(
    *,
    institution: str,
    account: str | None,
    period_start: date | None,
    period_end: date | None,
    doc_type: str,
) -> str:
    """Identity of a *logical* document - same statement regardless of the exact
    bytes / channel it arrived through. Used to flag suspected duplicates."""
    return _h(
        slug(institution or "unknown"),
        slug(account or ""),
        _norm_date(period_start) if period_start else "",
        _norm_date(period_end) if period_end else "",
        doc_type or "unknown",
    )
