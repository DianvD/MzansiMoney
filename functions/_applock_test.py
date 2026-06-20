"""App-lock PIN hashing checks (offline, pure - no Firebase).

The PIN hash is the secondary app-lock gate; verify the salted PBKDF2 round-trip,
the constant-time mismatch path, and that malformed records fail closed.
Run: python _applock_test.py
"""
from core.applock import evaluate, hash_pin, verify, _MAX_FAILS, _LOCKOUT_SECONDS


def test_roundtrip():
    rec = hash_pin("1234")
    assert verify(rec, "1234")
    assert not verify(rec, "1235")
    print("ok  PIN hash round-trips; wrong PIN rejected")


def test_unique_salt():
    a, b = hash_pin("1234"), hash_pin("1234")
    assert a["salt"] != b["salt"] and a["hash"] != b["hash"]  # per-PIN random salt
    print("ok  each hash uses a fresh salt")


def test_fails_closed_on_garbage():
    assert not verify(None, "1234")
    assert not verify({}, "1234")
    assert not verify({"salt": "zz", "hash": "zz", "iterations": 1}, "1234")  # bad hex
    print("ok  missing / malformed records fail closed")


def test_throttle_locks_after_repeated_misses():
    rec = hash_pin("1234")
    # Wrong PINs accumulate until the lockout trips.
    for i in range(1, _MAX_FAILS):
        result, update = evaluate(rec, "0000", now=1000)
        assert not result["ok"] and not result["locked"]
        assert update == {"failedCount": i}
        rec.update(update)
    result, update = evaluate(rec, "0000", now=1000)  # the _MAX_FAILS-th miss
    assert result["locked"] and result["lockedUntil"] == 1000 + _LOCKOUT_SECONDS
    rec.update(update)
    # While locked, even the CORRECT pin is refused until the window passes.
    assert not evaluate(rec, "1234", now=1000 + 5)[0]["ok"]
    # After the window, the correct pin works and resets state.
    result, update = evaluate(rec, "1234", now=1000 + _LOCKOUT_SECONDS + 1)
    assert result["ok"] and update == {"failedCount": 0, "lockedUntil": 0}
    print("ok  lockout trips after repeated misses, blocks during window, resets on success")


if __name__ == "__main__":
    test_roundtrip()
    test_unique_salt()
    test_fails_closed_on_garbage()
    test_throttle_locks_after_repeated_misses()
    print("\nALL APPLOCK TESTS PASSED")
