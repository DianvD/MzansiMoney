"""Classifier + bill dedup checks (offline). Run: python _classify_test.py

Uses real example PDFs when present (gitignored in examples/), and always runs
the synthetic bill-fingerprint checks.
"""
from datetime import date
from pathlib import Path

from core.bills import bill_fingerprint, classified_to_bill
from core.classify import (BANK_STATEMENT, INVOICE, MUNICIPAL, PROFORMA,
                           STATEMENT, classify)

EX = Path(__file__).resolve().parent / "examples"


def test_bill_fingerprint_stable_and_distinct():
    a1 = bill_fingerprint("Vodacom", "H3-1VTXTF", "I8601853-5", None, 846.43)
    a2 = bill_fingerprint("Vodacom", "h3-1vtxtf", "I8601853-5", None, 846.43)  # case-insensitive
    assert a1 == a2, "same invoice number must give the same bill id"
    b = bill_fingerprint("Cape Hills HOA", "INV00667", None, None, 1230.12)
    assert a1 != b, "different invoices must differ"
    # No doc number -> fall back to institution/account/due/amount.
    c1 = bill_fingerprint("City of Cape Town", None, "237833688", date(2026, 7, 1), 867.41)
    c2 = bill_fingerprint("City of Cape Town", None, "237833688", date(2026, 7, 1), 867.41)
    assert c1 == c2
    print("ok  bill fingerprints stable + distinct")


def test_classify_invoice_creates_bill():
    text = ("Vodacom Tax invoice\nInvoice number: H3-1VTXTF\n"
            "Account number: I8601853-5\nDue date: 30/06/2026\nThis Invoice Amount 736.03 110.40 846.43\n")
    c = classify(text, "inv.pdf")
    assert c.doc_type == INVOICE and c.institution == "Vodacom", (c.doc_type, c.institution)
    assert c.doc_number == "H3-1VTXTF"
    assert c.is_bill
    fp, bill = classified_to_bill(c, document_id="doc1", source_document="inv.pdf")
    assert fp.startswith("bill:") and bill["amount"] == 846.43 and bill["paid"] is False
    print("ok  invoice classified + bill built")


def test_classify_statement_not_a_bill():
    text = ("Cape Hills Home Owners Association STATEMENT\n"
            "Date Source Description Debit Credit Cumulative\n"
            "2026-04-01 Balance b/f 0 1577.81 -1 577.81\nTotal due 1230.12\n")
    c = classify(text, "CustomerStatement-1781729505.pdf")
    assert c.doc_type == STATEMENT, c.doc_type
    assert not c.is_bill, "statements must NOT mint bills"
    print("ok  statement classified, not a bill")


def test_issuer_not_customer_address():
    """The issuer at the top of the document must win, not an institution name that
    appears only in the customer's billing address or in debit-line descriptions."""
    # Vodacom invoice: Nedbank appears in the postal address only - must not win.
    vodacom_inv = (
        "Vodacom Tax Invoice\nInvoice number: H3-1VTXTF\n"
        "Vodacom (Pty) Ltd, VAT No. 4560000237\n"
        "Bill to:\n15 Main Road\nNedbank Centre, Cape Town\n8001\nAmount due R 846.43\n"
    )
    c = classify(vodacom_inv, "Invoice-H3-1VTXTF.pdf")
    assert c.institution == "Vodacom", f"issuer should be Vodacom, got {c.institution}"

    # A bank statement lists merchant names (Vodacom) in its transaction rows; the
    # bank's own masthead must win, not a debit line.
    stmt = (
        "Nedbank\nAccount summary\nAvailable balance 1000.00\n"
        "Account holder: A du Plessis\n15 Main Road, Cape Town\n"
        "01 Jun  Vodacom prepaid  -299.00\n02 Jun  Checkers  -192.26\n"
    )
    c = classify(stmt, "statement.pdf")
    assert c.institution == "Nedbank", f"statement issuer should be Nedbank, got {c.institution}"
    print("ok  issuer detected from masthead, not the customer address / debit lines")


def test_currency_detection():
    usd = classify("Anthropic, PBC\nInvoice\nAmount due $115.00 USD\n", "i.pdf")
    assert usd.currency == "USD" and usd.total == 115.00, (usd.currency, usd.total)
    zar = classify("Vodacom Tax invoice\nAmount due R 846.43\n", "i.pdf")
    assert zar.currency == "ZAR" and zar.total == 846.43, (zar.currency, zar.total)
    print("ok  currency read from the amount-due context (USD vs ZAR)")


def test_real_examples_if_present():
    """Classify any PDFs found in examples/ and report results - no specific files required."""
    if not EX.exists():
        print("--  examples/ not present, skipping real-file classification")
        return
    from core.pdf import extract_text
    pdfs = list(EX.glob("*.pdf")) + list(EX.glob("*.PDF"))
    if not pdfs:
        print("--  examples/ present but no PDFs found, skipping")
        return
    for p in pdfs[:5]:  # limit to avoid long test runs
        try:
            c = classify(extract_text(p.read_bytes()).text, p.name)
            print(f"--  {p.name}: {c.doc_type} {c.institution or '?'} {c.currency} {c.total}")
        except Exception as e:
            print(f"--  {p.name}: classification failed ({e})")


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
    print("\nALL CLASSIFY/BILL TESTS PASSED")
