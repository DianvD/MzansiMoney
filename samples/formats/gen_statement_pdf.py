"""Generate a SYNTHETIC bank-statement PDF fixture (fake data) for the PDF-import
e2e. Dev-only (needs reportlab, which is not a deploy dependency). Run:

    python samples/formats/gen_statement_pdf.py

Produces samples/formats/statement-synthetic.pdf - a text-based statement with a
Date / Description / Money In / Money Out / Balance table and a detectable account
number, so the importer recovers the table and keys the account on the number.
"""
import os

from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas

W, H = A4
OUT = os.path.join(os.path.dirname(__file__), "statement-synthetic.pdf")

# (date, description, money_in, money_out) - fake.
TXNS = [
    ("2025-02-01", "Salary Deposit Acme", 15000.00, None),
    ("2025-02-03", "Checkers Groceries", None, 612.30),
    ("2025-02-05", "Shell Fuel Constantia", None, 845.00),
    ("2025-02-08", "Netflix Subscription", None, 199.00),
    ("2025-02-11", "EFT From J Smith", 250.00, None),
    ("2025-02-15", "Woolworths Food", None, 433.91),
    ("2025-02-20", "Monthly Account Fee", None, 7.50),
    ("2025-02-22", "Interest Received", 12.45, None),
    ("2025-02-25", "Virgin Active Gym", None, 599.00),
    ("2025-02-28", "Refund Takealot", 320.00, None),
]


def amt(v: float) -> str:
    # SA grouping with a space (tests that split "15 000.00" rejoins on import).
    return f"{v:,.2f}".replace(",", " ")


def main():
    c = canvas.Canvas(OUT, pagesize=A4)
    c.setFont("Helvetica-Bold", 11)
    c.drawString(40, H - 40, "DEMO BANK - Account Statement (SYNTHETIC, fake data)")
    c.setFont("Helvetica", 9)
    c.drawString(40, H - 54, "Account Number: 9911223344")
    c.drawString(40, H - 66, "Statement Period: 01/02/2025 - 28/02/2025")

    y = H - 92
    c.setFont("Helvetica-Bold", 9)
    c.drawString(40, y, "Date")
    c.drawString(95, y, "Description")
    c.drawRightString(380, y, "Money In")
    c.drawRightString(470, y, "Money Out")
    c.drawRightString(560, y, "Balance")

    c.setFont("Helvetica", 9)
    bal = 5000.00
    y -= 16
    for date, desc, cin, cout in TXNS:
        bal += (cin or 0.0) - (cout or 0.0)
        c.drawString(40, y, date)
        c.drawString(95, y, desc)
        if cin:
            c.drawRightString(380, y, amt(cin))
        if cout:
            c.drawRightString(470, y, "-" + amt(cout))
        c.drawRightString(560, y, amt(bal))
        y -= 14

    c.save()
    print("wrote", OUT)


if __name__ == "__main__":
    main()
