"""Quick offline check of the parser + categorizer (no Firebase deps)."""
from core.parsers import get_parser
from core.categorize import categorize
from core.model import normalize

SAMPLE = """Account: 123456789
Statement period: 01/06/2026 - 30/06/2026

Date,Description,Debit,Credit,Balance
01/06/2026,SALARY ACME CORP,,45000.00,46500.00
02/06/2026,CHECKERS HYPER SANDTON CARD 1234,1250.45,,45249.55
03/06/2026,SHELL ULTRA CITY N1,800.00,,44449.55
05/06/2026,NETFLIX.COM 4829,199.00,,44250.55
07/06/2026,UBER EATS *MEAL,215.50,,44035.05
09/06/2026,STEAM PURCHASE GAMES,549.99,,43485.06
10/06/2026,TAKEALOT ORDER 998877,1399.00,,42086.06
,,,,
"""


def main():
    parser = get_parser("nedbank")
    txns = parser.parse(SAMPLE)
    print(f"parsed {len(txns)} transactions via {parser.institution}\n")
    for raw in txns:
        doc = normalize(raw, account="Cheque", institution=parser.institution,
                        source_document="sample.csv", job_id="job1")
        doc["category"] = categorize(doc["merchant"], doc["description"], doc["direction"])
        print(f"{raw.date.date()}  {doc['direction']:6}  R{doc['amount']:>9.2f}  "
              f"{doc['category']:18}  {doc['merchant']}")
    assert len(txns) == 7, "expected 7 data rows"
    print("\nOK")


if __name__ == "__main__":
    main()
