"""Offline tests for payment-details extraction and bill-update validation.

Run: python _bills_test.py
No Firebase / emulator required.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from core.bills import validate_bill_update
from core.classify import extract_payment_details


# ---------------------------------------------------------------------------
# extract_payment_details
# ---------------------------------------------------------------------------

def test_realistic_sa_invoice_banking_block():
    """Multi-line banking details block as found on SA HOA / utility invoices."""
    text = (
        "Cape Hills Home Owners Association\n"
        "Invoice No: INV00667\n"
        "Due Date: 2026-07-01\n"
        "\nBANKING DETAILS\n"
        "Payable to: Cape Hills Body Corporate\n"
        "Bank: FNB\n"
        "Account No: 62 123 4567\n"
        "Branch Code: 250655\n"
        "Reference: INV00667\n"
    )
    r = extract_payment_details(text)
    assert r.get("beneficiary") == "Cape Hills Body Corporate", r
    assert r.get("bank") == "FNB", r
    assert r.get("accountNumber") == "621234567", r
    assert r.get("branchCode") == "250655", r
    assert r.get("reference") == "INV00667", r
    print("ok  realistic SA invoice banking block")


def test_plumber_style_informal_invoice():
    """Informal plumber invoice with 'Please pay into' wording and all fields."""
    text = (
        "Labour + materials - fix leaking pipe\n"
        "Total: R850.00\n"
        "\nPlease pay into:\n"
        "Payable to: John Smith Plumbing\n"
        "Bank: Standard Bank\n"
        "Account No: 1234567890\n"
        "Branch Code: 051001\n"
        "Account Type: Cheque\n"
        "Reference: JOB-2024-001\n"
    )
    r = extract_payment_details(text)
    assert r.get("beneficiary") == "John Smith Plumbing", r
    assert r.get("bank") == "Standard Bank", r
    assert r.get("accountNumber") == "1234567890", r
    assert r.get("branchCode") == "051001", r
    assert r.get("accountType") == "Cheque", r
    assert r.get("reference") == "JOB-2024-001", r
    print("ok  plumber-style informal invoice")


def test_no_banking_details_returns_empty():
    """Foreign-currency invoice without a banking section returns {}."""
    text = (
        "Anthropic, PBC\nInvoice\nInvoice number NZFUDSFJ-0010\n"
        "548 Market Street, San Francisco, CA\nsupport@anthropic.com\n"
        "Amount due $115.00 USD\nDue date: 2026-07-01\n"
    )
    r = extract_payment_details(text)
    assert r == {}, f"expected empty dict, got {r}"
    print("ok  invoice with no banking details returns {}")


def test_statement_full_of_numbers_no_false_positive():
    """Bank statement text with many numbers must NOT produce payment details."""
    text = (
        "Nedbank\nAccount summary\nAvailable balance 1000.00\n"
        "Opening balance 2500.00\nClosing balance 1000.00\n"
        "2026-06-01  Vodacom  -299.00  2201.00\n"
        "2026-06-02  Checkers  -192.26  2008.74\n"
        "2026-06-10  FNB ATM 12345678  -500.00  1508.74\n"
        "Account number: 9876543210\n"
        "Branch code 198765\n"
    )
    r = extract_payment_details(text)
    assert r == {}, f"statement must NOT yield payment details, got {r}"
    print("ok  statement full of numbers does not false-positive")


def test_spaced_account_number():
    """Account number with internal spaces (e.g. '40 5555 1234') is normalised."""
    text = (
        "BANKING DETAILS\n"
        "Bank: ABSA\n"
        "Acc No: 40 5555 1234\n"
        "Branch Code: 632005\n"
        "Reference: ABC-001\n"
    )
    r = extract_payment_details(text)
    assert r.get("accountNumber") == "4055551234", r
    assert r.get("bank") == "ABSA", r
    assert r.get("branchCode") == "632005", r
    assert r.get("reference") == "ABC-001", r
    print("ok  spaced account number normalised correctly")


def test_use_account_number_as_reference():
    """'Use your account number as reference' phrasing is detected."""
    text = (
        "BANKING DETAILS\n"
        "Bank: Capitec\n"
        "Account No: 1234567890\n"
        "Branch Code: 470010\n"
        "Please use your account number as reference when making payment.\n"
    )
    r = extract_payment_details(text)
    assert r.get("bank") == "Capitec", r
    assert r.get("accountNumber") == "1234567890", r
    assert r.get("reference") == "1234567890", r
    print("ok  'use your account number as reference' sets reference to account number")


# ---------------------------------------------------------------------------
# validate_bill_update
# ---------------------------------------------------------------------------

def test_validate_valid_full_payload():
    """Complete valid payload is accepted and all fields returned."""
    data = {
        "paid": True,
        "payTo": {
            "beneficiary": "John Smith",
            "bank": "FNB",
            "accountNumber": "1234567890",
            "branchCode": "250655",
            "accountType": "Cheque",
            "reference": "INV001",
        },
        "amount": 850.00,
        "dueDate": "2026-07-15",
        "note": "Approved by owner",
    }
    r = validate_bill_update(data)
    assert r["paid"] is True
    assert r["payTo"]["beneficiary"] == "John Smith"
    assert r["payTo"]["bank"] == "FNB"
    assert r["amount"] == 850.00
    assert r["dueDate"] == "2026-07-15"
    assert r["note"] == "Approved by owner"
    print("ok  valid full payload accepted")


def test_validate_unknown_key_rejected():
    """A top-level key outside the allowed set raises ValueError."""
    try:
        validate_bill_update({"paid": True, "hacker": "value"})
        raise AssertionError("should have raised ValueError")
    except ValueError as e:
        assert "hacker" in str(e), str(e)
    print("ok  unknown top-level key rejected")


def test_validate_unknown_payto_key_rejected():
    """An unknown key inside payTo raises ValueError."""
    try:
        validate_bill_update({"payTo": {"beneficiary": "John", "badKey": "x"}})
        raise AssertionError("should have raised ValueError")
    except ValueError as e:
        assert "badKey" in str(e), str(e)
    print("ok  unknown payTo key rejected")


def test_validate_control_char_stripped():
    """Control characters in string fields are silently removed."""
    r = validate_bill_update({"note": "hello\x00world\x1f"})
    assert "\x00" not in r["note"]
    assert "\x1f" not in r["note"]
    assert "helloworld" in r["note"]
    print("ok  control characters stripped from string fields")


def test_validate_bad_amount_rejected():
    """Zero, negative, infinity, NaN, and non-numeric amounts are rejected."""
    import math
    for bad in [0, -1, float("inf"), float("nan"), "not-a-number", None]:
        try:
            validate_bill_update({"amount": bad})
            raise AssertionError(f"should have raised ValueError for amount={bad!r}")
        except (ValueError, TypeError):
            pass
    print("ok  invalid amounts rejected")


def test_validate_bad_duedate_rejected():
    """Non-YYYY-MM-DD strings and impossible calendar dates are rejected."""
    for bad in ["2026/07/15", "15-07-2026", "not-a-date", "2026-13-01", "2026-07-32", 20260715]:
        try:
            validate_bill_update({"dueDate": bad})
            raise AssertionError(f"should have raised ValueError for dueDate={bad!r}")
        except (ValueError, TypeError):
            pass
    print("ok  invalid dueDate values rejected")


def test_validate_string_max_length():
    """Strings longer than 120 characters are truncated, not rejected."""
    long_note = "x" * 200
    r = validate_bill_update({"note": long_note})
    assert len(r["note"]) <= 120
    assert r["note"] == "x" * 120
    print("ok  string truncated to 120 chars")


if __name__ == "__main__":
    for _name, _fn in sorted(globals().items()):
        if _name.startswith("test_") and callable(_fn):
            _fn()
    print("\nALL BILLS TESTS PASSED")
