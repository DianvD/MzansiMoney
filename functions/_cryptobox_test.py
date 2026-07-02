"""Cryptobox envelope encryption + storage fallback + recovery guards (offline).

Covers:
- encrypt_bytes / decrypt_bytes round-trip
- Legacy-plaintext fallback via _maybe_decrypt
- Magic-prefix rejection on garbage input
- ALLOW_DEV_SECRETS guard (emulator honored; prod fail-closed)
- Single-use nonce (second commit rejected)

Run: python _cryptobox_test.py
"""
import base64
import os

# Set a valid 32-byte AES-256 key so encrypt_bytes / decrypt_bytes work.
_TEST_KEY_BYTES = b"test-statement-key-32bytes-xxxxxx"[:32]
_TEST_KEY = base64.b64encode(_TEST_KEY_BYTES).decode()
os.environ.setdefault("STATEMENT_KEY", _TEST_KEY)

# Set a recovery secret so make_token / verify_token work in nonce tests.
os.environ.setdefault("RECOVERY_TOKEN_SECRET", "test-recovery-secret-0123456789abcdef")

from core.cryptobox import _MAGIC, decrypt_bytes, encrypt_bytes
from core.storage import _maybe_decrypt
from core.recovery import (
    _consume_nonce,
    _secret,
    _store_nonce,
    make_token,
    verify_token,
)


# ---- Fake Firestore for nonce tests -----------------------------------------
# Mirrors the path pattern: db.collection("users").document(uid)
#   .collection("recoveryNonces").document(nonce)

class _FakeSnap:
    def __init__(self, exists: bool):
        self.exists = exists


class _FakeDocRef:
    def __init__(self):
        self._exists = False

    def collection(self, name: str) -> "_FakeColl":
        if not hasattr(self, "_colls"):
            self._colls: dict = {}
        if name not in self._colls:
            self._colls[name] = _FakeColl()
        return self._colls[name]

    def set(self, d: dict) -> None:
        self._exists = True

    def get(self) -> _FakeSnap:
        return _FakeSnap(self._exists)

    def delete(self) -> None:
        self._exists = False


class _FakeColl:
    def __init__(self):
        self._docs: dict = {}

    def document(self, doc_id: str) -> _FakeDocRef:
        if doc_id not in self._docs:
            self._docs[doc_id] = _FakeDocRef()
        return self._docs[doc_id]


class _FakeDB:
    def __init__(self):
        self._users = _FakeColl()

    def collection(self, name: str) -> _FakeColl:
        if name == "users":
            return self._users
        raise ValueError(f"Unknown collection in fake: {name!r}")


# ---- Helpers ----------------------------------------------------------------

def _save_env(*keys: str) -> dict:
    """Return current values of keys, popping them from env."""
    saved = {}
    for k in keys:
        saved[k] = os.environ.pop(k, None)
    return saved


def _restore_env(saved: dict) -> None:
    for k, v in saved.items():
        if v is None:
            os.environ.pop(k, None)
        else:
            os.environ[k] = v


# ---- Tests ------------------------------------------------------------------

def test_encrypt_decrypt_round_trip():
    for data in [b"", b"hello world", b"\x00\xff" * 100, b"app data" * 50]:
        assert decrypt_bytes(encrypt_bytes(data)) == data
    print("ok  encrypt_bytes / decrypt_bytes round-trip (empty, short, binary, long)")


def test_encrypted_blob_starts_with_magic():
    ct = encrypt_bytes(b"payload")
    assert ct.startswith(_MAGIC), f"expected magic prefix, got {ct[:8]!r}"
    print("ok  encrypted blob carries the MZANSI1 magic prefix")


def test_decrypt_rejects_garbage_no_magic():
    bad_inputs = [
        b"",
        b"not encrypted at all",
        b"\x00" * 20,
        b"MZANSI0" + b"\x00" * 19,  # wrong version byte
    ]
    for bad in bad_inputs:
        try:
            decrypt_bytes(bad)
            assert False, f"should have raised ValueError for {bad!r}"
        except ValueError:
            pass
    print("ok  decrypt_bytes raises ValueError on inputs without MZANSI1 magic prefix")


def test_decrypt_rejects_truncated_envelope():
    """Envelope shorter than MAGIC + nonce + 1 tag byte must fail."""
    short = _MAGIC + b"\x00" * 5  # only 5 bytes of nonce; AES-GCM will reject
    try:
        decrypt_bytes(short)
        assert False, "should have raised (truncated)"
    except Exception:
        pass
    print("ok  truncated envelope raises rather than silently returning garbage")


def test_maybe_decrypt_legacy_plaintext_passthrough():
    """Plaintext data (no magic prefix) must pass through unchanged."""
    plain_json = b'{"schema":1,"transactions":[]}'
    assert _maybe_decrypt(plain_json) == plain_json
    plain_csv = b"date,description,amount\n2026-01-01,coffee,-4.50\n"
    assert _maybe_decrypt(plain_csv) == plain_csv
    print("ok  _maybe_decrypt returns legacy plaintext blobs unchanged")


def test_maybe_decrypt_encrypted_blob():
    """Encrypted blobs must be decrypted transparently."""
    original = b"sensitive ledger data"
    ct = encrypt_bytes(original)
    assert _maybe_decrypt(ct) == original
    print("ok  _maybe_decrypt decrypts MZANSI1-prefixed blobs")


def test_dev_secret_guard():
    """ALLOW_DEV_SECRETS=1 is only honored inside the Firebase emulator.

    In production (no FUNCTIONS_EMULATOR env) it must be ignored and the
    function must fail closed exactly as if the env var were absent.
    """
    saved = _save_env("RECOVERY_TOKEN_SECRET", "ALLOW_DEV_SECRETS", "FUNCTIONS_EMULATOR")
    try:
        # Case 1: emulator + flag -> dev key returned (local dev / CI path).
        os.environ["ALLOW_DEV_SECRETS"] = "1"
        os.environ["FUNCTIONS_EMULATOR"] = "true"
        key = _secret()
        assert b"dev-only" in key, f"unexpected dev key content: {key!r}"
        print("ok  ALLOW_DEV_SECRETS honored inside emulator")

        # Case 2: flag set but NOT in emulator -> must fail closed (prod safety).
        del os.environ["FUNCTIONS_EMULATOR"]
        try:
            _secret()
            assert False, "should have raised RuntimeError"
        except RuntimeError:
            pass
        print("ok  ALLOW_DEV_SECRETS ignored in prod (no FUNCTIONS_EMULATOR) -> fail closed")

        # Case 3: neither flag set -> fail closed.
        del os.environ["ALLOW_DEV_SECRETS"]
        try:
            _secret()
            assert False, "should have raised RuntimeError"
        except RuntimeError:
            pass
        print("ok  no secret configured at all -> fail closed")

    finally:
        _restore_env(saved)


def test_nonce_single_use():
    """A commit token may be used exactly once; a replay is rejected."""
    db = _FakeDB()
    uid = "uid-nonce-test"
    op = "revert_import"
    sig = "doc-abc|10|0|0"

    token = make_token(uid, op, sig, db=db)

    # First use: valid and nonce is consumed.
    assert verify_token(token, uid, op, sig, db=db, consume=True), \
        "first verify should succeed"

    # Second use: nonce was deleted; must be rejected even though HMAC is valid.
    assert not verify_token(token, uid, op, sig, db=db, consume=True), \
        "replay must be rejected after nonce is consumed"

    print("ok  single-use nonce: first commit accepted, replay rejected")


def test_nonce_not_consumed_on_dry_run_path():
    """make_token stores the nonce but verify_token WITHOUT consume leaves it intact,
    so multiple verify calls (e.g. audit) don't accidentally burn the nonce."""
    db = _FakeDB()
    uid = "uid-dry-test"
    op = "revert_import"
    sig = "doc-xyz|5|0|0"

    token = make_token(uid, op, sig, db=db)

    # verify without consume=True (read-only check): should not delete the nonce.
    assert verify_token(token, uid, op, sig, db=db, consume=False)
    # Nonce still present; consume succeeds on first real commit.
    assert verify_token(token, uid, op, sig, db=db, consume=True)
    # Now consumed; second attempt fails.
    assert not verify_token(token, uid, op, sig, db=db, consume=True)

    print("ok  verify without consume=True does not burn the nonce")


def test_nonce_without_db_pure_hmac():
    """Without a db the token is verified by HMAC only (offline / test path)."""
    token = make_token("uid1", "revert_import", "sig|1|0|0")
    # Pure HMAC check passes (no Firestore, no nonce).
    assert verify_token(token, "uid1", "revert_import", "sig|1|0|0")
    # Second call also passes (no nonce consumed).
    assert verify_token(token, "uid1", "revert_import", "sig|1|0|0")
    print("ok  pure HMAC verify (no db) still works for offline / test usage")


if __name__ == "__main__":
    test_encrypt_decrypt_round_trip()
    test_encrypted_blob_starts_with_magic()
    test_decrypt_rejects_garbage_no_magic()
    test_decrypt_rejects_truncated_envelope()
    test_maybe_decrypt_legacy_plaintext_passthrough()
    test_maybe_decrypt_encrypted_blob()
    test_dev_secret_guard()
    test_nonce_single_use()
    test_nonce_not_consumed_on_dry_run_path()
    test_nonce_without_db_pure_hmac()
    print("\nALL CRYPTOBOX TESTS PASSED")
