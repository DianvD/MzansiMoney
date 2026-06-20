"""Home-loan (bond) statement parser.

A bond statement is NOT a cash account, so it gets its own parser and the
``home_loan`` account type. Two things make it different from a cheque export:

  1. **No balance column.** The export is ``date, value-date, description,
     amount`` with no running balance, so the outstanding balance owed is
     anchored separately (the user enters today's balance; the view rolls the
     flows backward from it).
  2. **Signs are from the loan's perspective.** In the amount column a *positive*
     value is a charge that increases what you owe (INTEREST, INSURANCE, ADMIN
     FEE); a *negative* value reduces it (PAYMENT, or a TRANSFER BY CLIENT into
     the bond). We map charges -> DEBIT and reductions -> CREDIT, and
     ``model.normalize`` (home_loan) turns that into a signed change-in-owed.

Real sample (account 1234567890)::

    Account Number : ,1234567890
    Account Description :,HOMELOAN
    03Jun2026,03Jun2026,INSURANCE,713.5
    01Jun2026,01Jun2026,INTEREST,9915.15
    01Jun2026,01Jun2026,PAYMENT - THANK YOU,-11418.97
    06May2026,05May2026,TRANSFER BY CLIENT,-10000
"""
from __future__ import annotations

from ..model import RawTxn
from .base import BaseParser


class HomeLoanParser(BaseParser):
    institution = "Nedbank Home Loan"
    account_type = "home_loan"

    def parse(self, text: str) -> list[RawTxn]:
        out: list[RawTxn] = []
        for row in self.sniff_rows(text):
            # A data row starts with a transaction date; metadata lines
            # ("Account Number : , ...") have no parseable date and are skipped.
            date = self.parse_date((row[0] or "").strip()) if row else None
            if date is None:
                continue

            # Amount = the last purely-numeric cell. Description = the remaining
            # text cells (skips the second 'value date' column and the amount).
            amount = None
            amount_idx = None
            for i in range(len(row) - 1, 0, -1):
                if self.is_numeric_token(row[i]):
                    amount = self.parse_amount(row[i])
                    amount_idx = i
                    break
            if amount is None or amount == 0:
                continue

            desc_parts = [
                (row[i] or "").strip()
                for i in range(1, len(row))
                if i != amount_idx
                and (row[i] or "").strip()
                and self.parse_date((row[i] or "").strip()) is None
            ]
            description = " ".join(desc_parts).strip()

            # Charge (positive) increases what you owe -> debit on the loan.
            # Reduction (negative) -> credit on the loan.
            if amount > 0:
                txn = self.make_txn(date, description, debit=amount, raw={"row": row})
            else:
                txn = self.make_txn(date, description, credit=abs(amount), raw={"row": row})
            if txn is not None:
                out.append(txn)
        return out
