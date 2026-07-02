"""Recovery confirmation-token + plan_revert + serialization checks (offline).

The token is the safety latch on every destructive recovery op, so its binding
rules are explicit. Run: python _recovery_test.py
"""
import os
from datetime import datetime, timezone

# _secret() now fails closed when no key is configured; give the offline suite a
# deterministic test key (>= 32 chars) so token math stays exercised.
os.environ.setdefault("RECOVERY_TOKEN_SECRET", "test-recovery-secret-0123456789abcdef")

from core.recovery import json_default, make_token, plan_revert, verify_token


def test_token_binds_target():
    t = make_token("uid1", "revert_import", "doc123|10|0|0")
    assert verify_token(t, "uid1", "revert_import", "doc123|10|0|0")
    # A token is useless for a different user, op, or (crucially) a changed target.
    assert not verify_token(t, "uid2", "revert_import", "doc123|10|0|0")
    assert not verify_token(t, "uid1", "export_ledger", "doc123|10|0|0")
    assert not verify_token(t, "uid1", "revert_import", "doc123|11|0|0")  # live count drifted
    assert not verify_token("garbage", "uid1", "revert_import", "doc123|10|0|0")
    print("ok  token binds uid+op+target; tamper / count-drift rejected")


def test_token_expiry():
    expired = make_token("uid1", "revert_import", "x|0|0|0", ttl=-1)
    assert not verify_token(expired, "uid1", "revert_import", "x|0|0|0")
    print("ok  expired confirmation token rejected")


def test_json_default():
    dt = datetime(2026, 1, 2, 3, 4, 5, tzinfo=timezone.utc)
    assert json_default(dt) == dt.isoformat()
    assert json_default(b"\x00\xff") == "00ff"
    print("ok  snapshot serializer handles timestamps + bytes")


def test_plan_revert_no_overlap():
    """When no other import shares the fingerprints, all rows are deleted."""
    fps = ["fp1", "fp2", "fp3"]
    to_delete, reattribute = plan_revert(fps, other_active={})
    assert sorted(to_delete) == sorted(fps), to_delete
    assert reattribute == {}
    print("ok  plan_revert: sole-owner rows all queued for deletion")


def test_plan_revert_all_shared():
    """When every row is covered by another import, none are deleted."""
    fps = ["fp1", "fp2", "fp3"]
    other = {"import-B": {"fp1", "fp2", "fp3"}}
    to_delete, reattribute = plan_revert(fps, other_active=other)
    assert to_delete == [], to_delete
    assert set(reattribute.keys()) == {"fp1", "fp2", "fp3"}
    assert all(v == "import-B" for v in reattribute.values())
    print("ok  plan_revert: fully-shared rows all re-attributed, none deleted")


def test_plan_revert_partial_overlap():
    """Rows present in another import are re-attributed; exclusive rows are deleted."""
    fps = ["fp1", "fp2", "fp3", "fp4"]
    other = {"import-B": {"fp2", "fp4"}}
    to_delete, reattribute = plan_revert(fps, other_active=other)
    assert sorted(to_delete) == ["fp1", "fp3"]
    assert reattribute == {"fp2": "import-B", "fp4": "import-B"}
    print("ok  plan_revert: partial overlap -> some deleted, some re-attributed")


def test_plan_revert_deterministic_owner():
    """When multiple other imports share a row, the lexically-lowest id wins."""
    fps = ["fp1"]
    other = {"import-B": {"fp1"}, "import-A": {"fp1"}}
    _, reattribute = plan_revert(fps, other_active=other)
    assert reattribute["fp1"] == "import-A", "expected lowest import id to own the row"
    print("ok  plan_revert: lowest import-id wins when multiple share a fingerprint")


if __name__ == "__main__":
    test_token_binds_target()
    test_token_expiry()
    test_json_default()
    test_plan_revert_no_overlap()
    test_plan_revert_all_shared()
    test_plan_revert_partial_overlap()
    test_plan_revert_deterministic_owner()
    print("\nALL RECOVERY TESTS PASSED")
