"""Amount parsing checks (grouping + multi-decimal). Run: python _parse_test.py"""
import time

from core.parsers.base import BaseParser

P = BaseParser.parse_amount
NUM = BaseParser.is_numeric_token


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


def test_is_numeric_token():
    # Correct classification (whole-number cells vs. text-with-a-number).
    for v in ("1234.56", "R 1 234,56", "(123.45)", "1 000 000", "123 CR", "-42.00", "R1000"):
        assert NUM(v), f"should be numeric: {v!r}"
    for v in ("INV00667", "EFT FROM J SMITH", "", "abc", "12x", "2025-03-01"):
        assert not NUM(v), f"should NOT be numeric: {v!r}"
    # ReDoS regression: a tiny crafted cell must not blow up (the old regex
    # backtracked catastrophically on "1" + many spaces + "x"). Bound the time.
    t = time.perf_counter()
    assert not NUM("1" + " " * 5000 + "x")
    dt = (time.perf_counter() - t) * 1000
    assert dt < 50, f"is_numeric_token too slow ({dt:.1f} ms) - possible ReDoS regression"
    print(f"ok  is_numeric_token classifies correctly and resists ReDoS ({dt:.3f} ms)")


if __name__ == "__main__":
    test_parse_amount()
    test_is_numeric_token()
    print("\nALL PARSE TESTS PASSED")
