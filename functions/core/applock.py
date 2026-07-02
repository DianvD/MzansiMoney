"""Server-side app-lock PIN.

The app lock is a secondary, local-convenience gate in front of the UI (the real
first factor is the user's Google sign-in; the data is already protected by Auth
+ Firestore rules regardless of the PIN). We still manage the PIN **server-side**
so a compromised client token cannot overwrite the PIN or read its hash: the
record lives in the backend-only ``secure`` space (rules deny client read+write),
and verification happens in a Cloud Function via a constant-time compare.

Pure hashing (``hash_pin`` / ``verify``) is unit-tested offline.
"""
from __future__ import annotations

import hashlib
import hmac
import os
import time
from typing import Optional

from firebase_admin import firestore

_ITERATIONS = 210_000          # PBKDF2-HMAC-SHA256 work factor (matches the old client)
_SALT_BYTES = 16
_DIGEST = "sha256"
_MAX_FAILS = 5                 # consecutive wrong PINs before a (temporary) lockout
_BASE_LOCKOUT_SECONDS = 30     # first lockout window; doubles each subsequent lockout
_MAX_LOCKOUT_SECONDS = 3600    # cap the exponential growth at 1 hour


def _lockout_seconds(prior_lockouts: int) -> int:
    """Exponential back-off: 30s, 60s, 120s, 240s ... capped at 1h. ``prior_lockouts``
    is how many times this record has already locked out (0 for the first). This is
    what makes sustained online guessing of even a 6-digit PIN infeasible - the
    window keeps stretching instead of staying at a flat 30s forever."""
    return min(_BASE_LOCKOUT_SECONDS * (2 ** max(0, prior_lockouts)), _MAX_LOCKOUT_SECONDS)


def hash_pin(pin: str, *, iterations: int = _ITERATIONS) -> dict:
    """Derive a salted PBKDF2 hash record for a PIN. Salt is per-PIN random."""
    salt = os.urandom(_SALT_BYTES)
    dk = hashlib.pbkdf2_hmac(_DIGEST, pin.encode("utf-8"), salt, iterations)
    return {"salt": salt.hex(), "hash": dk.hex(), "iterations": iterations, "v": 1}


def verify(stored: Optional[dict], pin: str) -> bool:
    """Constant-time check of ``pin`` against a stored ``hash_pin`` record."""
    if not stored:
        return False
    try:
        salt = bytes.fromhex(stored["salt"])
        iterations = int(stored.get("iterations", _ITERATIONS))
        expected = bytes.fromhex(stored["hash"])
    except (KeyError, ValueError, TypeError):
        return False
    dk = hashlib.pbkdf2_hmac(_DIGEST, pin.encode("utf-8"), salt, iterations)
    return hmac.compare_digest(dk, expected)


def evaluate(rec: Optional[dict], pin: str, now: int) -> tuple:
    """Pure throttle + verify decision (no I/O, so it's unit-testable).

    Returns ``(result, update)`` where ``result`` is
    ``{ok, locked, lockedUntil}`` and ``update`` is the field delta to persist
    back to the record (or ``None`` if nothing changed). Each block of
    ``_MAX_FAILS`` consecutive misses triggers a lockout whose window grows
    exponentially with ``lockoutCount`` - which only resets on a successful
    unlock - so repeat offenders are throttled progressively, not just for a flat
    30s each time."""
    if not rec:
        return {"ok": False, "locked": False, "lockedUntil": 0}, None
    locked_until = int(rec.get("lockedUntil", 0) or 0)
    if now < locked_until:
        return {"ok": False, "locked": True, "lockedUntil": locked_until}, None
    if verify(rec, pin):
        # Reset ALL accumulated failure/lockout state on success.
        dirty = rec.get("failedCount") or rec.get("lockoutCount") or locked_until
        reset = {"failedCount": 0, "lockoutCount": 0, "lockedUntil": 0} if dirty else None
        return {"ok": True, "locked": False, "lockedUntil": 0}, reset
    fails = int(rec.get("failedCount", 0) or 0) + 1
    if fails >= _MAX_FAILS:
        prior = int(rec.get("lockoutCount", 0) or 0)
        until = now + _lockout_seconds(prior)
        # Clear the per-window miss counter but escalate lockoutCount so the NEXT
        # lockout window is longer; lockoutCount only clears on a successful unlock.
        return ({"ok": False, "locked": True, "lockedUntil": until},
                {"failedCount": 0, "lockoutCount": prior + 1, "lockedUntil": until})
    return {"ok": False, "locked": False, "lockedUntil": 0}, {"failedCount": fails}


def _ref(db, uid: str):
    return db.collection("users").document(uid).collection("secure").document("appLock")


def set_pin(db, uid: str, pin: str) -> None:
    # A fresh PIN clears any prior failure/lockout state.
    _ref(db, uid).set({**hash_pin(pin), "failedCount": 0, "lockoutCount": 0,
                       "lockedUntil": 0, "updatedAt": firestore.SERVER_TIMESTAMP})


def check_pin(db, uid: str, pin: str) -> dict:
    ref = _ref(db, uid)
    snap = ref.get()
    rec = snap.to_dict() if snap.exists else None
    result, update = evaluate(rec, pin, int(time.time()))
    if update is not None:
        ref.set(update, merge=True)
    return result


def has_pin(db, uid: str) -> bool:
    return _ref(db, uid).get().exists
