"""Generic CSV parser - column-mapping by fuzzy header names, with shape detection.

Works on most bank CSV exports without per-bank code: it finds the header row,
maps columns to roles (date / description / amount / debit / credit / balance),
and reads the rest. Institution-specific parsers subclass this and override the
header hints or pre-clean the text.

It can also *report* what it detected (``detect``) and *reuse* a previously
learned mapping (``parse_with_profile``). That's what lets the app remember how
each bank's export is laid out instead of re-guessing every time - see
``core/profiles.py``. The remembered key (``Detection.fingerprint``) is built
from the column *shape* only, never from transaction values, so it carries no
personal data.
"""
from __future__ import annotations

import hashlib
from dataclasses import dataclass, field

from ..model import RawTxn
from .base import BaseParser

# Header keywords -> role. First keyword found in a header cell wins that role.
_ROLE_HINTS: dict[str, list[str]] = {
    "date": ["date", "posting date", "transaction date", "txn date"],
    "description": [
        "description",
        "narrative",
        "details",
        "transaction",
        "memo",
        "particulars",
        "reference",
    ],
    "amount": ["amount", "value", "transaction amount"],
    "debit": ["debit", "money out", "withdrawal", "paid out", " dr"],
    "credit": ["credit", "money in", "deposit", "paid in", " cr"],
    "balance": ["balance", "running balance", "closing balance"],
}


@dataclass
class Detection:
    """What the parser worked out about a file's shape - enough to parse it now
    AND to remember it for next time.

    ``fingerprint`` identifies "this kind of file". Two statements from the same
    bank/export share it (so a learned mapping is reused); a different layout gets
    a different id. It is derived from the column shape only - delimiter + header
    names, or column count + per-column type pattern when headerless - so it never
    encodes a single transaction value.
    """

    delimiter: str
    header_idx: int            # -1 when the file has no labelled header row
    mapping: dict              # role -> column index
    ncols: int
    header_cells: list         # normalized header cell text (empty if headerless)
    type_signature: list       # per-column dominant type: 'd' date / 'n' num / 't' text / '?'
    confidence: float
    rows: list = field(default_factory=list, repr=False)

    @property
    def has_header(self) -> bool:
        return self.header_idx >= 0

    @property
    def fingerprint(self) -> str:
        if self.has_header:
            key = "h|" + self.delimiter + "|" + "|".join(self.header_cells)
        else:
            key = "p|" + self.delimiter + "|" + str(self.ncols) + "|" + "".join(self.type_signature)
        return "shape:" + hashlib.sha256(key.encode("utf-8")).hexdigest()[:16]


class GenericCsvParser(BaseParser):
    institution = "Generic"
    # Subclasses can extend these.
    extra_hints: dict[str, list[str]] = {}

    # ---- public API --------------------------------------------------------

    def parse(self, text: str) -> list[RawTxn]:
        det = self.detect(text)
        return self._parse_rows(det.rows, det.header_idx, det.mapping)

    def detect(self, text: str) -> Detection:
        """Work out a file's shape + column mapping, WITHOUT committing to it.

        Returns everything needed to parse the file now and to remember it as a
        profile. Used by the import path to learn a mapping the first time and to
        show the user "here's how I read it" so they can correct a column.
        """
        delimiter = self.sniff_delimiter(text)
        rows = self.sniff_rows(text)
        if not rows:
            return Detection(delimiter, -1, {}, 0, [], [], 0.0, rows)
        ncols = max((len(r) for r in rows), default=0)

        header_idx, mapping = self._locate_header(rows)
        if mapping is not None:
            header_cells = self._norm_cells(rows[header_idx])
            type_sig = self._column_types(rows[header_idx + 1 :], ncols)
            conf = self._confidence(mapping, header=True)
            return Detection(delimiter, header_idx, mapping, ncols, header_cells, type_sig, conf, rows)

        # No labelled header (e.g. Nedbank CSV export) - infer columns by type.
        mapping = self._infer_positional(rows)
        type_sig = self._column_types(rows, ncols)
        if mapping is None:
            return Detection(delimiter, -1, {}, ncols, [], type_sig, 0.0, rows)
        conf = self._confidence(mapping, header=False)
        return Detection(delimiter, -1, mapping, ncols, [], type_sig, conf, rows)

    def parse_with_profile(self, text: str, profile: dict) -> list[RawTxn]:
        """Parse using a previously learned/confirmed mapping, skipping guessing.

        For headered files we re-locate the header row by its remembered cells (a
        statement's preamble length can vary between exports), so the saved column
        indices still line up. Falls back to a fresh ``parse`` if the profile has
        no usable mapping.
        """
        mapping = {role: int(col) for role, col in (profile.get("mapping") or {}).items()}
        if not mapping:
            return self.parse(text)
        rows = self.sniff_rows(text)
        if not rows:
            return []
        header_cells = profile.get("headerCells") or []
        header_idx = self._find_header_row(rows, header_cells) if header_cells else -1
        return self._parse_rows(rows, header_idx, mapping)

    def _infer_positional(self, rows: list[list[str]]):
        """Headerless layout: classify each column as date / numeric / text by
        sampling, then map date=first date col, amount=first numeric, balance=
        second numeric (if any), description=first text col."""
        sample = [r for r in rows if len(r) >= 3][:60]
        if len(sample) < 3:
            return None
        ncols = max(len(r) for r in sample)
        is_date = [0] * ncols
        is_num = [0] * ncols
        is_text = [0] * ncols
        nonempty = [0] * ncols
        for r in sample:
            for c in range(ncols):
                v = (r[c] or "").strip() if c < len(r) else ""
                if not v:
                    continue
                nonempty[c] += 1
                if self.parse_date(v) is not None:
                    is_date[c] += 1
                elif self.is_numeric_token(v):
                    is_num[c] += 1
                else:
                    is_text[c] += 1

        date_col = max(range(ncols), key=lambda c: is_date[c])
        if is_date[date_col] < 3:
            return None

        def majority(score, c):
            return nonempty[c] and score[c] >= max(2, nonempty[c] * 0.5)

        numeric_cols = sorted(c for c in range(ncols) if c != date_col and majority(is_num, c))
        if not numeric_cols:
            return None
        amount_col = numeric_cols[0]
        balance_col = numeric_cols[1] if len(numeric_cols) >= 2 else None

        text_cols = [
            c for c in range(ncols)
            if c not in (date_col, amount_col) and c != balance_col and majority(is_text, c)
        ]
        mapping = {"date": date_col, "amount": amount_col}
        if balance_col is not None:
            mapping["balance"] = balance_col
        if text_cols:
            mapping["description"] = text_cols[0]
        return mapping

    def fingerprint_from_rows(self, rows: list[list[str]]) -> str:
        """Stable shape fingerprint for a reconstructed table (e.g. a PDF
        statement), used to key its learned profile. A statement has several tables
        (summaries, a debit-order list, the main ledger), so we key on the dominant
        date-led table's column count + per-column type signature. The role mapping
        itself comes from ``pdftable`` (PDF) - no mapping inference needed here."""
        rows = [r for r in rows if any((c or "").strip() for c in r)]
        dated = [r for r in rows if r and self.parse_date((r[0] or "").strip()) is not None]
        if len(dated) >= 3:
            from collections import Counter
            dominant = Counter(len(r) for r in dated).most_common(1)[0][0]
            main = [r for r in dated if abs(len(r) - dominant) <= 1]
        else:
            main = rows
        ncols = max((len(r) for r in main), default=0)
        type_sig = self._column_types(main, ncols)
        return Detection("pdf", -1, {}, ncols, [], type_sig, 0.0, main).fingerprint

    # ---- internals ---------------------------------------------------------

    def _parse_rows(self, rows: list[list[str]], header_idx: int, mapping: dict) -> list[RawTxn]:
        if not rows or not mapping:
            return []
        data_rows = rows[header_idx + 1 :] if header_idx >= 0 else rows
        out: list[RawTxn] = []
        for row in data_rows:
            txn = self._row_to_txn(row, mapping)
            if txn is not None:
                out.append(txn)
        return out

    @staticmethod
    def _norm_cells(row: list[str]) -> list[str]:
        return [(c or "").strip().lower() for c in row]

    def _column_types(self, rows: list[list[str]], ncols: int) -> list[str]:
        """Per-column dominant cell type over a sample - the headerless half of
        the shape fingerprint, and a quick sanity signal for headered files."""
        sample = [r for r in rows if any((c or "").strip() for c in r)][:60]
        sig: list[str] = []
        for c in range(ncols):
            d = n = t = 0
            for r in sample:
                v = (r[c] or "").strip() if c < len(r) else ""
                if not v:
                    continue
                if self.parse_date(v) is not None:
                    d += 1
                elif self.is_numeric_token(v):
                    n += 1
                else:
                    t += 1
            kind, best = max((("d", d), ("n", n), ("t", t)), key=lambda x: x[1])
            sig.append(kind if best else "?")
        return sig

    @staticmethod
    def _confidence(mapping: dict, *, header: bool) -> float:
        """Rough 0..1 trust in a detected mapping. A labelled header with date,
        an amount signal and a description is full confidence; positional
        inference is discounted (it's a guess from data shape)."""
        score = 0.0
        if "date" in mapping:
            score += 0.4
        if any(k in mapping for k in ("amount", "debit", "credit")):
            score += 0.4
        if "description" in mapping:
            score += 0.2
        if not header:
            score *= 0.7
        return round(score, 2)

    def _find_header_row(self, rows: list[list[str]], header_cells: list[str]) -> int:
        for idx, row in enumerate(rows[:15]):
            if self._norm_cells(row) == list(header_cells):
                return idx
        idx, _ = self._locate_header(rows)  # layout shifted - re-find by hints
        return idx

    def _hints(self) -> dict[str, list[str]]:
        merged = {role: list(hints) for role, hints in _ROLE_HINTS.items()}
        for role, hints in self.extra_hints.items():
            merged.setdefault(role, [])
            merged[role] = list(hints) + merged[role]
        return merged

    def _locate_header(self, rows: list[list[str]]):
        """Find the header row and a {role: column_index} mapping.

        We scan the first 15 rows (statements often have a title/account block on
        top) and pick the row that maps the most roles, requiring at least a date
        column plus some amount signal.
        """
        hints = self._hints()
        best = None
        best_score = 0
        for idx, row in enumerate(rows[:15]):
            mapping = self._map_columns(row, hints)
            score = len(mapping)
            has_amount = any(k in mapping for k in ("amount", "debit", "credit"))
            if "date" in mapping and has_amount and score > best_score:
                best, best_score = (idx, mapping), score
        if best is None:
            return -1, None
        return best

    @staticmethod
    def _map_columns(header: list[str], hints: dict[str, list[str]]):
        mapping: dict[str, int] = {}
        normalized = [f" {(c or '').strip().lower()} " for c in header]
        for role, keywords in hints.items():
            for col_idx, cell in enumerate(normalized):
                if col_idx in mapping.values():
                    continue
                if any(kw.strip() and kw in cell for kw in keywords):
                    mapping[role] = col_idx
                    break
        return mapping

    def _row_to_txn(self, row: list[str], mapping: dict[str, int]) -> RawTxn | None:
        def cell(role: str) -> str:
            idx = mapping.get(role)
            if idx is None or idx >= len(row):
                return ""
            return (row[idx] or "").strip()

        date = self.parse_date(cell("date"))
        if date is None:
            return None  # not a data row (subtotal, blank, footer, etc.)

        description = cell("description") or cell("reference")
        amount = self.parse_amount(cell("amount")) if "amount" in mapping else None
        debit = self.parse_amount(cell("debit")) if "debit" in mapping else None
        credit = self.parse_amount(cell("credit")) if "credit" in mapping else None
        balance = self.parse_amount(cell("balance")) if "balance" in mapping else None

        return self.make_txn(
            date,
            description,
            amount=amount,
            debit=debit,
            credit=credit,
            reference=cell("reference"),
            balance=balance,
            raw={"row": row},
        )
