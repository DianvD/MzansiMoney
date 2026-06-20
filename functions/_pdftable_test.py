"""PDF table reconstruction + role inference (offline, no PDF needed).

Feeds synthetic word boxes (fake x/y coords) through the same path a real
statement takes, covering the Capitec-shaped case: Money In / Money Out / Fee +
Balance, where the amount is the signed sum of the non-balance numeric columns (so
fees are captured, not dropped). Run: python _pdftable_test.py
"""
from core import pdftable
from core.parsers.generic import GenericCsvParser
from core.ingest import prepare_transactions

P = GenericCsvParser()

# Column x-bands with clear whitespace streets between them.
COLS = {
    "date": (35, 75), "desc": (85, 300),
    "in": (385, 418), "out": (438, 472), "fee": (492, 518), "bal": (530, 562),
}


def _cell_words(value, col, top):
    x0, x1 = COLS[col]
    parts = value.split(" ")
    step = (x1 - x0) / max(1, len(parts))
    return [{"text": p, "x0": x0 + i * step, "x1": x0 + i * step + step * 0.85,
             "top": top, "bottom": top + 9} for i, p in enumerate(parts)]


def _row(top, date, desc, **amounts):
    ws = _cell_words(date, "date", top) + _cell_words(desc, "desc", top)
    for col, val in amounts.items():
        ws += _cell_words(val, col, top)
    return ws


# A statement: 3 credits, 3 debits, 2 fees - the running balance reconciles.
ROWS = [
    _row(112, "01/01/2025", "Salary Deposit", **{"in": "10 000.00", "bal": "10 000.00"}),
    _row(124, "02/01/2025", "Groceries Spar", **{"out": "-450.00", "bal": "9 550.00"}),
    _row(136, "03/01/2025", "Fuel Engen", **{"out": "-800.00", "bal": "8 750.00"}),
    _row(148, "04/01/2025", "Interest Received", **{"in": "5.00", "bal": "8 755.00"}),
    _row(160, "05/01/2025", "Bank Fee", **{"fee": "-7.50", "bal": "8 747.50"}),
    _row(172, "06/01/2025", "Restaurant", **{"out": "-250.00", "bal": "8 497.50"}),
    _row(184, "07/01/2025", "Refund", **{"in": "120.00", "bal": "8 617.50"}),
    _row(196, "08/01/2025", "Card Fee", **{"fee": "-2.00", "bal": "8 615.50"}),
]
PAGE = [w for row in ROWS for w in row]


def test_reconstruct_columns():
    rows = pdftable.reconstruct_rows([PAGE])
    assert len(rows) == 8, f"expected 8 ledger rows, got {len(rows)}"
    # Thousands-space amounts rejoin within their column.
    assert any("10 000.00" in c for c in rows[0]), rows[0]
    print("ok  reconstruct: 8 rows, columns recovered, split amounts rejoined")


def test_infer_roles():
    rows = pdftable.reconstruct_rows([PAGE])
    roles = pdftable.infer_roles(rows, P)
    assert roles is not None
    assert len(roles["amount_cols"]) == 3, f"in/out/fee should be 3 amount cols: {roles}"
    assert roles["balance"] is not None and roles["balance"] not in roles["amount_cols"]
    print("ok  infer_roles: balance = always-present column, amount = the other 3")


def test_extract_and_reconcile():
    rows = pdftable.reconstruct_rows([PAGE])
    roles = pdftable.resolve_roles(rows, P, None)
    txns = pdftable.txns_from_rows(rows, P, roles)
    assert len(txns) == 8, f"expected 8 transactions, got {len(txns)}"
    credits = [t for t in txns if t.direction == "credit"]
    debits = [t for t in txns if t.direction == "debit"]
    assert len(credits) == 3 and len(debits) == 5, f"{len(credits)}c/{len(debits)}d"
    # The R7.50 fee is captured as a debit (the bug was dropping it).
    assert any(abs(t.amount - 7.50) < 0.005 and t.direction == "debit" for t in txns)
    assert abs(txns[0].amount - 10000.0) < 0.005 and txns[0].direction == "credit"
    # Through the real spine, the balance chain verifies.
    prep = prepare_transactions(txns, institution="Test", account="Main",
                                source_document="s.pdf", document_id="t")
    assert prep.integrity_ok is True, prep.integrity_detail
    print("ok  extract: 3 credits / 5 debits (fees included), balance chain verifies")


if __name__ == "__main__":
    test_reconstruct_columns()
    test_infer_roles()
    test_extract_and_reconcile()
    print("\nALL PDF-TABLE TESTS PASSED")
