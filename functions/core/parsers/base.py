"""Base parser + shared parsing helpers.

Every institution gets its own parser subclass. A parser's only contract is
``parse(text) -> list[RawTxn]``. The helpers here (delimiter sniffing, date and
amount parsing) are deliberately forgiving because real bank exports are messy.
"""
from __future__ import annotations

import csv
import io
import re
from datetime import datetime
from typing import Iterable

from ..model import CREDIT, DEBIT, RawTxn

# Day-first formats first - South African statements are dd/mm/yyyy.
_DATE_FORMATS = [
    "%Y-%m-%d",
    "%Y/%m/%d",
    "%d/%m/%Y",
    "%d-%m-%Y",
    "%d.%m.%Y",
    "%d/%m/%y",
    "%d-%m-%y",
    "%d %b %Y",
    "%d %B %Y",
    "%d-%b-%Y",
    "%d%b%Y",   # Nedbank CSV: 03Mar2025
    "%d%b%y",
    "%d %b %y",
    "%m/%d/%Y",  # last-resort US order
]

_AMOUNT_CLEAN = re.compile(r"[^\d,.\-()]")
# A value that is ENTIRELY a number (no embedded words) - used to tell an amount
# column from a description that merely contains a reference number.
_PURE_NUMERIC = re.compile(r"^\s*\(?-?\s*r?\s*\d[\d ,.]*\)?\s*(cr|dr)?\s*$", re.IGNORECASE)


class BaseParser:
    institution = "Generic"
    # The kind of account this parser produces. "cash" for cheque/savings exports;
    # "home_loan" (a liability) for bond statements, which must stay out of the
    # cash dashboard and carry inverted balance semantics. See model.normalize.
    account_type = "cash"

    def parse(self, text: str) -> list[RawTxn]:  # pragma: no cover - interface
        raise NotImplementedError

    # ---- helpers shared by subclasses -------------------------------------

    @staticmethod
    def sniff_delimiter(text: str) -> str:
        """Best-guess the delimiter for a CSV/TSV export (kept separate so the
        shape fingerprint can record it)."""
        sample = text[:4096]
        try:
            return csv.Sniffer().sniff(sample, delimiters=",;\t|").delimiter
        except csv.Error:
            return ","

    @staticmethod
    def sniff_rows(text: str) -> list[list[str]]:
        """Split CSV text into rows, auto-detecting the delimiter."""
        delimiter = BaseParser.sniff_delimiter(text)
        reader = csv.reader(io.StringIO(text), delimiter=delimiter)
        return [row for row in reader if any((c or "").strip() for c in row)]

    @staticmethod
    def parse_date(value: str) -> datetime | None:
        value = (value or "").strip()
        if not value:
            return None
        for fmt in _DATE_FORMATS:
            try:
                return datetime.strptime(value, fmt)
            except ValueError:
                continue
        return None

    @staticmethod
    def is_numeric_token(value: str) -> bool:
        """True only if the whole value is a number (not text with a number in it)."""
        return bool(_PURE_NUMERIC.match(value or ""))

    @staticmethod
    def parse_amount(value: str) -> float | None:
        """Parse a money string into a signed float.

        Handles ``R 1 234,56``, ``1,234.56``, ``(123.45)`` for negatives, and a
        trailing ``Cr``/``Dr`` marker.
        """
        if value is None:
            return None
        raw = str(value).strip()
        if not raw:
            return None

        negative = False
        low = raw.lower()
        if low.endswith("cr"):
            raw = raw[:-2].strip()
        elif low.endswith("dr"):
            negative = True
            raw = raw[:-2].strip()

        cleaned = _AMOUNT_CLEAN.sub("", raw)
        if "(" in cleaned and ")" in cleaned:
            negative = True
        cleaned = cleaned.replace("(", "").replace(")", "")
        if cleaned.startswith("-"):
            negative = True
        cleaned = cleaned.replace("-", "")
        if not cleaned:
            return None

        # Decide which of ',' / '.' is the decimal separator vs thousands grouping.
        cleaned = BaseParser._normalize_decimal(cleaned)
        try:
            number = float(cleaned)
        except ValueError:
            return None
        return -number if negative else number

    @staticmethod
    def _normalize_decimal(s: str) -> str:
        """Turn a numeric string into a plain float string, handling both
        thousands grouping and decimal separators (and any number of decimal
        places - bank running balances often use 6, e.g. ``24341.870000``)."""
        has_comma = "," in s
        has_dot = "." in s
        if has_comma and has_dot:
            # The RIGHTMOST separator is the decimal point; the other groups
            # thousands. ("1,234.56" -> dot decimal; "1.234,56" -> comma decimal.)
            if s.rfind(",") > s.rfind("."):
                return s.replace(".", "").replace(",", ".")
            return s.replace(",", "")
        sep = "," if has_comma else ("." if has_dot else "")
        if not sep:
            return s
        if s.count(sep) > 1:
            return s.replace(sep, "")  # repeated => thousands grouping (1.234.567)
        frac = s.split(sep)[1]
        if len(frac) == 3 and sep == ",":
            return s.replace(sep, "")  # "1,234" => 1234 (thousands, no cents)
        # Single separator, any other trailing length => decimal point.
        return s.replace(sep, ".")

    @staticmethod
    def make_txn(
        date: datetime,
        description: str,
        *,
        amount: float | None = None,
        debit: float | None = None,
        credit: float | None = None,
        reference: str = "",
        balance: float | None = None,
        raw: dict | None = None,
    ) -> RawTxn | None:
        """Build a RawTxn from either a signed amount or debit/credit columns."""
        if credit is not None and credit != 0:
            magnitude, direction = abs(credit), CREDIT
        elif debit is not None and debit != 0:
            magnitude, direction = abs(debit), DEBIT
        elif amount is not None and amount != 0:
            magnitude = abs(amount)
            direction = CREDIT if amount > 0 else DEBIT
        else:
            return None
        return RawTxn(
            date=date,
            description=(description or "").strip(),
            amount=magnitude,
            direction=direction,
            reference=reference,
            balance=balance,
            raw=raw or {},
        )
