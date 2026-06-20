"""Home-loan parser + liability sign semantics. Run: python _homeloan_test.py

Guards the two things that make a bond statement different from a cheque export:
no balance column, and signs from the loan's (liability) perspective - a charge
increases what you owe, a payment reduces it.
"""
from core.categorize import home_loan_category
from core.ingest import prepare_transactions
from core.model import CREDIT, DEBIT, HOME_LOAN, RawTxn, normalize
from core.parsers import get_parser

# The real Nedbank home-loan export shape (date, value-date, description, amount),
# with metadata header lines that must be skipped.
SAMPLE = """Statement Enquiry :
Account Number : ,1234567890
Account Description :,HOMELOAN
03Jun2026,03Jun2026,INSURANCE,713.5
01Jun2026,01Jun2026,INTEREST,9915.15
01Jun2026,01Jun2026,PAYMENT - THANK YOU,-11418.97
30May2026,30May2026,ADMIN FEE,69
06May2026,05May2026,TRANSFER BY CLIENT,-10000
"""


def test_parser_skips_metadata_and_reads_signs():
    txns = get_parser("homeloan").parse(SAMPLE)
    assert len(txns) == 5, f"expected 5 data rows, got {len(txns)}"

    by_desc = {t.description: t for t in txns}
    # Charges -> debit (increase what you owe).
    for desc in ("INSURANCE", "INTEREST", "ADMIN FEE"):
        assert by_desc[desc].direction == DEBIT, f"{desc} should be a debit"
    # Money in -> credit (reduce what you owe).
    assert by_desc["PAYMENT - THANK YOU"].direction == CREDIT
    assert by_desc["TRANSFER BY CLIENT"].direction == CREDIT
    # No balance column in this export.
    assert all(t.balance is None for t in txns)
    print(f"ok  parser read {len(txns)} rows, skipped metadata, mapped signs")


def test_no_value_date_leaks_into_description():
    txns = get_parser("homeloan").parse(SAMPLE)
    # The second date column must not show up in the description.
    assert all("2026" not in t.description for t in txns), \
        "value-date column leaked into a description"
    print("ok  value-date column excluded from descriptions")


def test_signed_amount_is_change_in_owed():
    """signedAmount for a home loan = signed change to the outstanding balance:
    + when you owe more (interest), - when you owe less (payment)."""
    interest = normalize(
        RawTxn(date=_d(), description="INTEREST", amount=9915.15, direction=DEBIT),
        account="Home Loan", institution="Nedbank Home Loan",
        source_document="s", job_id="j", account_type=HOME_LOAN,
    )
    payment = normalize(
        RawTxn(date=_d(), description="PAYMENT", amount=11418.97, direction=CREDIT),
        account="Home Loan", institution="Nedbank Home Loan",
        source_document="s", job_id="j", account_type=HOME_LOAN,
    )
    assert interest["signedAmount"] == 9915.15, interest["signedAmount"]
    assert payment["signedAmount"] == -11418.97, payment["signedAmount"]
    assert interest["accountType"] == HOME_LOAN
    # A cheque account keeps the opposite (cash) convention.
    cash_in = normalize(
        RawTxn(date=_d(), description="SALARY", amount=100.0, direction=CREDIT),
        account="Cheque", institution="Nedbank", source_document="s", job_id="j",
    )
    assert cash_in["signedAmount"] == 100.0 and cash_in["accountType"] == "cash"
    print("ok  signedAmount encodes change-in-owed for the loan, cash unchanged")


def test_full_pipeline_categorizes_and_tags():
    raw = get_parser("homeloan").parse(SAMPLE)
    prep = prepare_transactions(
        raw, institution="Nedbank Home Loan", account="Home Loan",
        source_document="bond.csv", document_id="doc1", account_type=HOME_LOAN,
    )
    assert len(prep.transactions) == 5, "all 5 rows should survive (no balance collapse)"
    cats = {t.doc["description"]: t.doc["category"] for t in prep.transactions}
    assert cats["INTEREST"] == "Home Loan Interest"
    assert cats["INSURANCE"] == "Home Loan Insurance"
    assert cats["ADMIN FEE"] == "Home Loan Fees"
    assert cats["PAYMENT - THANK YOU"] == "Home Loan Payment"
    assert cats["TRANSFER BY CLIENT"] == "Home Loan Transfer"
    assert all(t.doc["accountType"] == HOME_LOAN for t in prep.transactions)
    # Net change in owed over the period = sum of signed amounts.
    net = round(sum(t.doc["signedAmount"] for t in prep.transactions), 2)
    assert net == round(713.5 + 9915.15 - 11418.97 + 69 - 10000, 2) == -10721.32, net
    print(f"ok  pipeline tagged + categorized 5 rows; net change in owed {net:+.2f}")


def test_category_helper():
    assert home_loan_category("INTEREST") == "Home Loan Interest"
    assert home_loan_category("ADMIN FEE") == "Home Loan Fees"
    assert home_loan_category("PAYMENT - THANK YOU") == "Home Loan Payment"
    assert home_loan_category("SOMETHING ELSE") == "Home Loan"
    print("ok  home_loan_category labels the known lines")


def _d():
    from datetime import datetime
    return datetime(2026, 6, 1)


if __name__ == "__main__":
    test_parser_skips_metadata_and_reads_signs()
    test_no_value_date_leaks_into_description()
    test_signed_amount_is_change_in_owed()
    test_full_pipeline_categorizes_and_tags()
    test_category_helper()
    print("\nALL HOME-LOAN TESTS PASSED")
