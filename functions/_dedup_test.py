"""Dedup correctness checks (pure, no Firebase). Run: python _dedup_test.py"""
from datetime import datetime

from core.ingest import prepare_transactions
from core.model import RawTxn


def tx(day, amount, direction, desc, balance=None):
    return RawTxn(
        date=datetime(2026, 6, day),
        description=desc,
        amount=amount,
        direction=direction,
        balance=balance,
    )


def prep(rows, doc="docA", account="Cheque"):
    return prepare_transactions(
        rows, institution="Nedbank", account=account,
        source_document="f.csv", document_id=doc,
    )


def test_identical_duplicates_both_survive_no_balance():
    # Two genuinely identical R50 coffees, same day, no balance column.
    rows = [tx(15, 50, "debit", "WOOLWORTHS COFFEE"), tx(15, 50, "debit", "WOOLWORTHS COFFEE")]
    p = prep(rows)
    assert len(p.transactions) == 2, "must keep BOTH real duplicates, not collapse them"
    assert p.duplicates_in_file == 0
    assert len({t.fingerprint for t in p.transactions}) == 2
    print("ok  identical no-balance duplicates both survive")


def test_identical_amounts_disambiguated_by_balance():
    rows = [tx(15, 50, "debit", "WOOLWORTHS", balance=950.0),
            tx(15, 50, "debit", "WOOLWORTHS", balance=900.0)]
    p = prep(rows)
    assert len(p.transactions) == 2
    assert len({t.fingerprint for t in p.transactions}) == 2
    print("ok  identical amounts disambiguated by running balance")


def test_reimport_same_file_is_idempotent():
    rows = [tx(1, 45000, "credit", "SALARY", balance=45000.0),
            tx(2, 1250.45, "debit", "CHECKERS", balance=43749.55),
            tx(2, 50, "debit", "COFFEE"), tx(2, 50, "debit", "COFFEE")]
    a = {t.fingerprint for t in prep(rows, doc="docA").transactions}
    b = {t.fingerprint for t in prep(rows, doc="docB").transactions}
    assert a == b, "same rows must yield same fingerprints regardless of document id"
    print(f"ok  re-import idempotent ({len(a)} stable fingerprints)")


def test_overlapping_statements_reconcile_via_balance():
    # Same real transaction appears in two overlapping statements (same balance).
    shared = dict(balance=43749.55)
    a = prep([tx(2, 1250.45, "debit", "CHECKERS HYPER", **shared)], doc="june").transactions[0]
    b = prep([tx(2, 1250.45, "debit", "CHECKERS HYPER", **shared)], doc="q2").transactions[0]
    assert a.fingerprint == b.fingerprint, "overlap must reconcile to one id"
    print("ok  overlapping statements reconcile to a single transaction")


def test_constant_balance_does_not_collapse():
    # Balance column is constant (closing balance repeated, or mis-mapped). Two
    # distinct same-day, same-amount debits must NOT collapse - the chain check
    # fails so we fall back to the non-collapsing scheme.
    rows = [tx(15, 50, "debit", "COFFEE", balance=1000.0),
            tx(15, 50, "debit", "COFFEE", balance=1000.0)]
    p = prep(rows)
    assert len(p.transactions) == 2, "constant balance must not collapse distinct rows"
    assert p.has_balance is False, "balance must not be trusted when chain fails"
    print("ok  constant/broken balance falls back, no collapse")


def test_balance_chain_integrity():
    good = [tx(1, 45000, "credit", "SALARY", balance=45000.0),
            tx(2, 1000, "debit", "RENT", balance=44000.0),
            tx(3, 500, "debit", "FOOD", balance=43500.0)]
    p = prep(good)
    assert p.integrity_ok is True, p.integrity_detail

    broken = [tx(1, 45000, "credit", "SALARY", balance=45000.0),
              tx(2, 1000, "debit", "RENT", balance=43000.0)]  # should be 44000
    p2 = prep(broken)
    assert p2.integrity_ok is False
    print(f"ok  balance-chain integrity (good=pass, broken=flagged: {p2.integrity_detail})")


def test_different_accounts_dont_collide():
    a = prep([tx(2, 50, "debit", "COFFEE")], account="Cheque").transactions[0]
    b = prep([tx(2, 50, "debit", "COFFEE")], account="Savings").transactions[0]
    assert a.fingerprint != b.fingerprint
    print("ok  identical txns in different accounts stay distinct")


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
    print("\nALL DEDUP TESTS PASSED")
