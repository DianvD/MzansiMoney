"""Recovery confirmation-token + serialization checks (offline).

The token is the safety latch on every destructive recovery op, so its binding
rules are explicit. Run: python _recovery_test.py
"""
from datetime import datetime, timezone

from core.recovery import json_default, make_token, verify_token


def test_token_binds_target():
    t = make_token("uid1", "revert_import", "doc123|10|0")
    assert verify_token(t, "uid1", "revert_import", "doc123|10|0")
    # A token is useless for a different user, op, or (crucially) a changed target.
    assert not verify_token(t, "uid2", "revert_import", "doc123|10|0")
    assert not verify_token(t, "uid1", "export_ledger", "doc123|10|0")
    assert not verify_token(t, "uid1", "revert_import", "doc123|11|0")  # live count drifted
    assert not verify_token("garbage", "uid1", "revert_import", "doc123|10|0")
    print("ok  token binds uid+op+target; tamper / count-drift rejected")


def test_token_expiry():
    expired = make_token("uid1", "revert_import", "x", ttl=-1)
    assert not verify_token(expired, "uid1", "revert_import", "x")
    print("ok  expired confirmation token rejected")


def test_json_default():
    dt = datetime(2026, 1, 2, 3, 4, 5, tzinfo=timezone.utc)
    assert json_default(dt) == dt.isoformat()
    assert json_default(b"\x00\xff") == "00ff"
    print("ok  snapshot serializer handles timestamps + bytes")


if __name__ == "__main__":
    test_token_binds_target()
    test_token_expiry()
    test_json_default()
    print("\nALL RECOVERY TESTS PASSED")
