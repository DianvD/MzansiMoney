"""Reconstruct a statement's transaction table from PDF word coordinates.

A statement table is laid out by horizontal position, so default text extraction
(draw order) scrambles it. Here we recover columns from the vertical whitespace
"streets" that run down the page between them, then emit a rows matrix - the same
``rows[][]`` shape a CSV produces, so the generic column-mapper and the whole dedup
spine handle PDF rows exactly like CSV rows.

Pure: takes word boxes (``{text, x0, x1, top, bottom}``), returns lists of strings.
Unit-tested offline in ``_pdftable_test.py`` with synthetic word lists.
"""
from __future__ import annotations

import re

# Loose "is this a date / an amount" tests - only used to pick the table's data
# lines for column detection; the real parsing is done later by the CSV parser.
_DATE_RE = re.compile(
    r"\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}|\d{1,2}[A-Za-z]{3,}\d{2,4}|\d{1,2}\s[A-Za-z]{3,}\s\d{2,4}"
)
_AMOUNT_RE = re.compile(r"^-?R?\s?\(?-?\d[\d ,.]*\)?\s?(?:cr|dr)?$", re.IGNORECASE)


def _looks_date(s: str) -> bool:
    return bool(_DATE_RE.search(s or ""))


def _looks_amount(s: str) -> bool:
    t = (s or "").strip()
    return len(t) >= 2 and bool(_AMOUNT_RE.match(t)) and any(c.isdigit() for c in t)


def _lines(words: list[dict], ytol: float = 3.0) -> list[list[dict]]:
    """Group words into visual lines by vertical position; each line sorted by x0."""
    lines: list[list[dict]] = []
    cur: list[dict] = []
    cur_top: float | None = None
    for w in sorted(words, key=lambda w: (w["top"], w["x0"])):
        if cur_top is None or abs(w["top"] - cur_top) <= ytol:
            cur.append(w)
            if cur_top is None:
                cur_top = w["top"]
        else:
            lines.append(sorted(cur, key=lambda w: w["x0"]))
            cur, cur_top = [w], w["top"]
    if cur:
        lines.append(sorted(cur, key=lambda w: w["x0"]))
    return lines


def _main_table_lines(lines: list[list[dict]]) -> list[list[dict]]:
    """The main ledger's rows: date-led lines sharing the same left margin. A
    statement has several date-bearing tables (summaries, debit-order list, the
    ledger); the ledger is the big block whose date sits at one consistent x. Using
    only these - across all pages, which share the ledger's x-layout - yields one
    stable set of columns instead of a different count per page."""
    from collections import Counter

    dated = [ln for ln in lines if ln and _looks_date(ln[0]["text"])]
    if len(dated) < 3:
        return [ln for ln in lines if sum(1 for w in ln if _looks_amount(w["text"])) >= 2]
    # The most common left margin (rounded) is the ledger's date column.
    margin = Counter(round(ln[0]["x0"] / 5) * 5 for ln in dated).most_common(1)[0][0]
    return [ln for ln in dated if abs(ln[0]["x0"] - margin) <= 6]


def _column_separators(lines: list[list[dict]], min_gap: float = 6.0, empty_frac: float = 0.05) -> list[float]:
    """x-positions of the vertical whitespace streets between columns: x-ranges
    covered by (almost) no word across the given lines."""
    if not lines:
        return []
    lo = int(min(w["x0"] for ln in lines for w in ln))
    hi = int(max(w["x1"] for ln in lines for w in ln)) + 1
    cover = [0] * (hi - lo + 1)
    for ln in lines:
        for w in ln:
            a, b = max(lo, int(w["x0"])) - lo, min(hi, int(w["x1"])) - lo
            for x in range(a, b + 1):
                cover[x] += 1
    thresh = int(len(lines) * empty_frac)
    seps: list[float] = []
    run_start: int | None = None
    for x in range(len(cover)):
        empty = cover[x] <= thresh
        if empty and run_start is None:
            run_start = x
        elif not empty and run_start is not None:
            if x - run_start >= min_gap:
                seps.append(lo + (run_start + x) / 2.0)
            run_start = None
    return seps


def _row_from_line(line: list[dict], seps: list[float]) -> list[str]:
    bounds = [-1e9, *seps, 1e9]
    cells: list[list[str]] = [[] for _ in range(len(bounds) - 1)]
    for w in line:
        c = (w["x0"] + w["x1"]) / 2.0
        for i in range(len(bounds) - 1):
            if bounds[i] <= c < bounds[i + 1]:
                cells[i].append(w["text"])
                break
    return [" ".join(parts).strip() for parts in cells]


def reconstruct_rows(pages: list[list[dict]]) -> list[list[str]]:
    """Turn per-page word boxes into a rows matrix. Column streets are computed
    once from all pages' data lines (x is stable across pages), then every line is
    split at them - so a row missing a column (e.g. only a debit, no credit) keeps
    an empty cell in the right place instead of shifting."""
    all_lines = [ln for words in pages if words for ln in _lines(words)]
    main = _main_table_lines(all_lines)
    if not main:
        return []
    # One set of column streets across all the ledger's rows (they share an
    # x-layout across pages) → every row is split into the same columns.
    seps = _column_separators(main)
    rows = [_row_from_line(ln, seps) for ln in main]
    return [r for r in rows if any(cell.strip() for cell in r)]


def _cell(r: list[str], c) -> str:
    if c is None:
        return ""
    return (r[c] or "").strip() if 0 <= c < len(r) else ""


def infer_roles(rows: list[list[str]], parser) -> dict | None:
    """Assign roles to the reconstructed columns. The running **balance** is the
    numeric column present on (almost) every row; the **amount** is the signed sum
    of the *other* numeric columns - which are mutually exclusive per row (Money In
    / Money Out / Fee), so the sum is just whichever applies, and fees are included
    instead of dropped (the bug that broke the balance chain)."""
    sample = [r for r in rows if any(c.strip() for c in r)][:120]
    if len(sample) < 2:
        return None
    ncols = max(len(r) for r in sample)
    date_h = [0] * ncols
    num_h = [0] * ncols
    text_h = [0] * ncols
    ne = [0] * ncols
    for r in sample:
        for c in range(ncols):
            v = _cell(r, c)
            if not v:
                continue
            ne[c] += 1
            if parser.parse_date(v) is not None:
                date_h[c] += 1
            elif parser.is_numeric_token(v):
                num_h[c] += 1
            else:
                text_h[c] += 1

    n = len(sample)
    date_col = max(range(ncols), key=lambda c: date_h[c])
    if date_h[date_col] < 3:
        return None

    def kind(h, c):
        return ne[c] and h[c] >= max(2, ne[c] * 0.6)

    numeric = [c for c in range(ncols) if c != date_col and kind(num_h, c)]
    text = [c for c in range(ncols) if c != date_col and c not in numeric and kind(text_h, c)]
    if not numeric:
        return None

    # Balance = the numeric column filled on most rows (the running total).
    balance = max(numeric, key=lambda c: ne[c])
    balance = balance if ne[balance] >= 0.7 * n else None
    amount_cols = [c for c in numeric if c != balance]
    if not amount_cols:
        return None  # only a balance column - can't recover per-txn amounts
    return {"date": date_col, "description": text[0] if text else None,
            "balance": balance, "amount_cols": amount_cols}


def resolve_roles(rows: list[list[str]], parser, override: dict | None = None) -> dict | None:
    """Inferred roles, optionally overridden by a user's confirmed columns. The
    override carries date/description/balance; the amount columns are then every
    other numeric column (so the user only has to get the few key columns right)."""
    roles = infer_roles(rows, parser)
    if roles is None:
        return None
    if not override:
        return roles
    out = dict(roles)
    for key in ("date", "description", "balance"):
        if key in override and override[key] is not None:
            out[key] = int(override[key])
    # Recompute amount columns = every numeric column that isn't the date/balance.
    ncols = max((len(r) for r in rows), default=0)
    sample = [r for r in rows if any(c.strip() for c in r)][:120]
    fixed = {out.get("date"), out.get("balance")}
    amount_cols = []
    for c in range(ncols):
        if c in fixed:
            continue
        hits = sum(1 for r in sample if parser.is_numeric_token(_cell(r, c)))
        ne = sum(1 for r in sample if _cell(r, c))
        if ne and hits >= max(2, ne * 0.6):
            amount_cols.append(c)
    if amount_cols:
        out["amount_cols"] = amount_cols
    return out


def txns_from_rows(rows: list[list[str]], parser, roles: dict) -> list:
    """Emit signed-amount RawTxns from a reconstructed table + roles."""
    out = []
    for r in rows:
        d = parser.parse_date(_cell(r, roles["date"]))
        if d is None:
            continue
        net = 0.0
        have = False
        for c in roles["amount_cols"]:
            v = parser.parse_amount(_cell(r, c))
            if v is not None:
                net += v
                have = True
        if not have or net == 0:
            continue
        bal = parser.parse_amount(_cell(r, roles["balance"])) if roles.get("balance") is not None else None
        txn = parser.make_txn(d, _cell(r, roles["description"]), amount=net, balance=bal, raw={"row": r})
        if txn:
            out.append(txn)
    return out


def column_labels(rows: list[list[str]], n: int = 40) -> list[str]:
    """A human label per column for the confirm UI - the first non-empty sample
    value in each column (so the user recognises 'the R-amounts column')."""
    ncols = max((len(r) for r in rows), default=0)
    labels = []
    for c in range(ncols):
        val = next((_cell(r, c) for r in rows if _cell(r, c)), "")
        labels.append((val[:n] or f"Column {c + 1}"))
    return labels


