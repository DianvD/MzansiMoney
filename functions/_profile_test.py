"""Adaptive parse-profile checks - shape fingerprint, detect, reuse, correction.

These are the heart of "it learns your bank the more you add", so the rules are
explicit and offline-testable (no Firestore). Run: python _profile_test.py
"""
from core.parsers.generic import GenericCsvParser
from core.profiles import (
    SOURCE_CONFIRMED,
    needs_confirmation,
    profile_from_detection,
    with_corrected_mapping,
)

P = GenericCsvParser()

# Same bank/shape, two different months of data (debit/credit columns, comma).
STMT_A1 = """Date,Description,Debit,Credit,Balance
2026-01-03,CHECKERS SANDTON,1250.45,,45249.55
2026-01-05,SALARY ACME,,45000.00,90249.55
2026-01-08,SHELL N1,800.00,,89449.55
"""
STMT_A2 = """Date,Description,Debit,Credit,Balance
2026-02-02,WOOLWORTHS,634.20,,12000.00
2026-02-04,UBER TRIP,89.00,,11911.00
2026-02-07,EFT FROM MOM,,500.00,12411.00
"""
# A different bank: semicolon-delimited, single signed Amount column.
STMT_B = """Date;Narrative;Amount;Balance
2026-01-03;PICK N PAY;-845.67;9000.00
2026-01-05;INTEREST;12.45;9012.45
2026-01-09;NETFLIX;-199.00;8813.45
"""
# Headerless (Nedbank-style): date, description, amount, balance - no header row.
STMT_C = """03Jan2026,CHECKERS SANDTON,-1250.45,45249.55
05Jan2026,SALARY ACME,45000.00,90249.55
08Jan2026,SHELL N1,-800.00,89449.55
10Jan2026,TAKEALOT,-1399.00,88050.55
"""
# A layout the auto-detector gets WRONG: "Reference" is claimed as the
# description, but the human-readable text is in "Narrative".
STMT_MISMAP = """Date,Reference,Narrative,Amount,Balance
2026-01-03,REF001,CHECKERS SANDTON,-1250.45,45249.55
2026-01-05,REF002,SALARY ACME,45000.00,90249.55
2026-01-08,REF003,SHELL N1,-800.00,89449.55
"""


def test_detect_headered():
    det = P.detect(STMT_A1)
    assert det.has_header, "labelled header should be found"
    for role in ("date", "description", "debit", "credit", "balance"):
        assert role in det.mapping, f"missing role {role}: {det.mapping}"
    assert det.confidence >= 0.9, det.confidence
    assert not needs_confirmation(det)
    print("ok  detect: headered debit/credit layout fully mapped, high confidence")


def test_detect_headerless():
    det = P.detect(STMT_C)
    assert not det.has_header, "no header row should be detected"
    assert {"date", "amount", "balance", "description"} <= set(det.mapping), det.mapping
    # Positional inference is a guess -> discounted -> flagged for a look.
    assert needs_confirmation(det), det.confidence
    print("ok  detect: headerless layout inferred positionally, flagged to confirm")


def test_fingerprint_stable_and_distinct():
    fa1, fa2 = P.detect(STMT_A1).fingerprint, P.detect(STMT_A2).fingerprint
    fb, fc = P.detect(STMT_B).fingerprint, P.detect(STMT_C).fingerprint
    assert fa1 == fa2, "same shape, different data must share a fingerprint"
    assert len({fa1, fb, fc}) == 3, "different layouts must get different fingerprints"
    assert fa1.startswith("shape:")
    print("ok  fingerprint: stable across months, distinct across banks/layouts")


def test_profile_roundtrip_matches_fresh_parse():
    det = P.detect(STMT_A1)
    profile = profile_from_detection(det, label="My Bank")
    fresh = P.parse(STMT_A1)
    reused = P.parse_with_profile(STMT_A1, profile)
    assert len(fresh) == len(reused) == 3
    assert [t.description for t in fresh] == [t.description for t in reused]
    # Reuse must also work on a *different* statement of the same shape.
    assert len(P.parse_with_profile(STMT_A2, profile)) == 3
    print("ok  profile: reusing a saved mapping reproduces the fresh parse")


def test_user_correction_sticks():
    det = P.detect(STMT_MISMAP)
    auto = P.parse_with_profile(STMT_MISMAP, profile_from_detection(det))
    # Auto-detect wrongly took the Reference column as the description.
    assert auto[0].description == "REF001", auto[0].description
    # User fixes it: description is column 2 (Narrative).
    corrected = with_corrected_mapping(
        profile_from_detection(det), {**det.mapping, "description": 2}
    )
    assert corrected["source"] == SOURCE_CONFIRMED
    fixed = P.parse_with_profile(STMT_MISMAP, corrected)
    assert fixed[0].description == "CHECKERS SANDTON", fixed[0].description
    print("ok  correction: a fixed column mapping changes the parse and is confirmed")


if __name__ == "__main__":
    test_detect_headered()
    test_detect_headerless()
    test_fingerprint_stable_and_distinct()
    test_profile_roundtrip_matches_fresh_parse()
    test_user_correction_sticks()
    print("\nALL PROFILE TESTS PASSED")
