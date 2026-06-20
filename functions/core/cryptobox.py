"""Encrypted storage for the statement password (your account number).

The plaintext is AES-256-GCM encrypted with a server-only key (STATEMENT_KEY,
function env var - never in the repo or sent to the browser) and the ciphertext
is kept in a backend-only Firestore doc. So even someone with database read
access sees only ciphertext, and the browser can't read it at all (rules deny).
"""
from __future__ import annotations

import base64
import os
from typing import Optional

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from firebase_admin import firestore


def _key() -> Optional[bytes]:
    raw = os.environ.get("STATEMENT_KEY")
    if not raw:
        return None
    try:
        k = base64.b64decode(raw)
        return k if len(k) in (16, 24, 32) else None
    except Exception:
        return None


def encrypt(plaintext: str) -> Optional[dict]:
    key = _key()
    if not key:
        return None
    nonce = os.urandom(12)
    ct = AESGCM(key).encrypt(nonce, plaintext.encode("utf-8"), None)
    return {"nonce": base64.b64encode(nonce).decode(), "ct": base64.b64encode(ct).decode(), "v": 1}


def decrypt(blob: dict) -> Optional[str]:
    key = _key()
    if not key or not blob:
        return None
    try:
        nonce = base64.b64decode(blob["nonce"])
        ct = base64.b64decode(blob["ct"])
        return AESGCM(key).decrypt(nonce, ct, None).decode("utf-8")
    except Exception:
        return None


def _ref(db, uid: str):
    return db.collection("users").document(uid).collection("secure").document("statementPassword")


def store_statement_password(db, uid: str, password: str) -> None:
    blob = encrypt(password)
    if blob is None:
        raise RuntimeError("Encryption key not configured.")
    _ref(db, uid).set({**blob, "updatedAt": firestore.SERVER_TIMESTAMP})
    # A non-sensitive flag the client may read, just to show "set".
    db.collection("users").document(uid).collection("settings").document("security").set(
        {"statementPasswordSet": True}, merge=True
    )


def get_statement_password(db, uid: str) -> Optional[str]:
    snap = _ref(db, uid).get()
    return decrypt(snap.to_dict()) if snap.exists else None
