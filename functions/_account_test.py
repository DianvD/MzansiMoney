"""Account identity by number. Run: python _account_test.py

The bug this guards: the same bank account imported under two different typed
labels used to become two accounts (double-counting the balance). Identity is now
the account NUMBER, so the label is cosmetic and can't fork an account.
"""
from datetime import datetime

from core.identity import account_id, extract_account_number
from core.ingest import prepare_transactions
from core.model import RawTxn


def test_extract_account_number():
    assert extract_account_number("Statement_9876543210_01Jan2025-18Jun2026.csv") == "9876543210"
    assert extract_account_number("Statement_1234567890_01Jun2025-18Jun2026.csv") == "1234567890"
    # Statement body wins over the filename.
    assert extract_account_number("x.csv", "Account Number : ,1234567890") == "1234567890"
    # Nothing to find.
    assert extract_account_number("random.csv", "no number here") is None
    print("ok  account number recovered from filename + body")


def test_account_id_is_number_not_label():
    a = account_id("Nedbank", "Cheque", "9876543210")
    b = account_id("Nedbank", "MiGoals Plus (Salary)", "9876543210")
    c = account_id("Nedbank", "typo account name", " 9876543210 ")  # spaces tolerated
    assert a == b == c == "nedbank-9876543210", (a, b, c)
    # Without a number we still fall back to the institution+label slug.
    assert account_id("Nedbank", "Cheque") == "nedbank-cheque"
    print("ok  account_id keys on the number; label is cosmetic")


def test_same_number_diff_label_dedups():
    """Same rows, same number, DIFFERENT labels -> identical fingerprints (so a
    re-import under a new label reconciles instead of duplicating)."""
    rows = [
        RawTxn(date=datetime(2026, 3, 20), description="Checkers", amount=192.26,
               direction="debit", balance=3855.67),
        RawTxn(date=datetime(2026, 3, 21), description="Salary", amount=20000.0,
               direction="credit", balance=23855.67),
    ]
    p1 = prepare_transactions(rows, institution="Nedbank", account="Cheque",
                              source_document="s.csv", document_id="d1", account_number="9876543210")
    p2 = prepare_transactions(rows, institution="Nedbank", account="MiGoals Plus (Salary)",
                              source_document="s.csv", document_id="d2", account_number="9876543210")
    f1 = sorted(t.fingerprint for t in p1.transactions)
    f2 = sorted(t.fingerprint for t in p2.transactions)
    assert f1 == f2, "same account+rows under different labels should share fingerprints"
    assert all(t.doc["accountId"] == "nedbank-9876543210" for t in p1.transactions)
    assert all(t.doc["accountNumber"] == "9876543210" for t in p1.transactions)
    # A genuinely different account number must NOT collide.
    p3 = prepare_transactions(rows, institution="Nedbank", account="Cheque",
                              source_document="s.csv", document_id="d3", account_number="9999999999")
    assert sorted(t.fingerprint for t in p3.transactions) != f1
    print("ok  same number dedups across labels; different number stays distinct")


if __name__ == "__main__":
    test_extract_account_number()
    test_account_id_is_number_not_label()
    test_same_number_diff_label_dedups()
    print("\nALL ACCOUNT-IDENTITY TESTS PASSED")
