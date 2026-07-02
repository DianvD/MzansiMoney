"""App-lock PIN hashing checks (offline, pure - no Firebase).

The PIN hash is the secondary app-lock gate; verify the salted PBKDF2 round-trip,
the constant-time mismatch path, malformed records, and the exponential lockout.
Run: python _applock_test.py
"""
from core.applock import (
    evaluate,
    hash_pin,
    verify,
    _MAX_FAILS,
    _BASE_LOCKOUT_SECONDS,
    _MAX_LOCKOUT_SECONDS,
    _lockout_seconds,
)


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


def test_lockout_window_grows_exponentially():
    """Each lockout doubles the window until the 1-hour cap."""
    assert _lockout_seconds(0) == _BASE_LOCKOUT_SECONDS          # first lockout: 30s
    assert _lockout_seconds(1) == _BASE_LOCKOUT_SECONDS * 2      # second: 60s
    assert _lockout_seconds(2) == _BASE_LOCKOUT_SECONDS * 4      # third: 120s
    assert _lockout_seconds(10) == _MAX_LOCKOUT_SECONDS          # capped at 1h
    assert _lockout_seconds(100) == _MAX_LOCKOUT_SECONDS         # still capped
    print("ok  lockout window doubles each time; capped at _MAX_LOCKOUT_SECONDS")


def test_throttle_locks_after_repeated_misses():
    rec = hash_pin("1234")
    # Wrong PINs accumulate until the lockout trips.
    for i in range(1, _MAX_FAILS):
        result, update = evaluate(rec, "0000", now=1000)
        assert not result["ok"] and not result["locked"]
        assert update == {"failedCount": i}
        rec.update(update)
    # The _MAX_FAILS-th miss triggers a lockout; lockoutCount starts at 0 -> 1.
    result, update = evaluate(rec, "0000", now=1000)
    assert result["locked"] and result["lockedUntil"] == 1000 + _BASE_LOCKOUT_SECONDS
    # lockoutCount must be incremented and failedCount must reset to 0.
    assert update.get("lockoutCount") == 1
    assert update.get("failedCount") == 0
    rec.update(update)
    # While locked, even the CORRECT pin is refused until the window passes.
    assert not evaluate(rec, "1234", now=1000 + 5)[0]["ok"]
    # After the window, the correct pin works and resets ALL state.
    result, update = evaluate(rec, "1234", now=1000 + _BASE_LOCKOUT_SECONDS + 1)
    assert result["ok"]
    assert update == {"failedCount": 0, "lockoutCount": 0, "lockedUntil": 0}
    print("ok  lockout trips after repeated misses, blocks during window, resets on success")


if __name__ == "__main__":
    test_roundtrip()
    test_unique_salt()
    test_fails_closed_on_garbage()
    test_lockout_window_grows_exponentially()
    test_throttle_locks_after_repeated_misses()
    print("\nALL APPLOCK TESTS PASSED")
