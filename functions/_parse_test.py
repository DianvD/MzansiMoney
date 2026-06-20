"""Amount parsing checks (grouping + multi-decimal). Run: python _parse_test.py"""
from core.parsers.base import BaseParser

P = BaseParser.parse_amount


def test_parse_amount():
    cases = {
        "-899.0": -899.0,
        "-550.23": -550.23,
        "24341.870000": 24341.87,   # bank running balance with 6 dp (the real-file bug)
        "1,234.56": 1234.56,
        "1 234,56": 1234.56,         # SA style: space thousands, comma decimal
        "1.234.567,89": 1234567.89,
        "1,234": 1234.0,             # thousands, no cents
        "R 2 543,60": 2543.60,
        "(123.45)": -123.45,         # parentheses = negative
        "100.00 Cr": 100.0,
        "50.00 Dr": -50.0,
        "0.0": 0.0,
    }
    for s, expected in cases.items():
        got = P(s)
        assert got is not None and abs(got - expected) < 0.005, f"{s!r}: {got} != {expected}"
    print(f"ok  parse_amount handles {len(cases)} grouping/decimal formats")


if __name__ == "__main__":
    test_parse_amount()
    print("\nALL PARSE TESTS PASSED")
