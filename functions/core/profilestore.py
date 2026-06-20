"""Parse-profile store - the Firestore side of "remember each bank's layout".

Profiles live at ``users/{uid}/parseProfiles/{shapeFingerprint}``. Each holds a
column mapping (+ optional human label) so a file of a known shape is parsed the
same way every time instead of re-guessed. Written by the backend (the import
pipeline) only; the client reads them and proposes corrections through
``import_csv`` - mirroring how the rest of the ledger is backend-owned.

The fingerprint is built from column *shape* (see ``profiles.py``), never from
transaction values, so a profile carries no personal financial data.
"""
from __future__ import annotations

from typing import Optional

from firebase_admin import firestore


class ProfileStore:
    def __init__(self, db, uid: str):
        self._col = db.collection("users").document(uid).collection("parseProfiles")

    def get(self, fingerprint: str) -> Optional[dict]:
        if not fingerprint:
            return None
        snap = self._col.document(fingerprint).get()
        return snap.to_dict() if snap.exists else None

    def save(self, profile: dict) -> None:
        """Upsert a profile. ``createdAt``/``timesUsed`` are stamped once on first
        save; a confirmed (user-corrected) mapping overwrites an earlier guess."""
        fp = profile.get("fingerprint")
        if not fp:
            return
        ref = self._col.document(fp)
        payload = {**profile, "updatedAt": firestore.SERVER_TIMESTAMP}
        if not ref.get().exists:
            payload["createdAt"] = firestore.SERVER_TIMESTAMP
            payload["timesUsed"] = 0
        ref.set(payload, merge=True)

    def touch(self, fingerprint: str) -> None:
        """Record that a saved profile was reused (for a future 'manage layouts' view)."""
        if not fingerprint:
            return
        self._col.document(fingerprint).set(
            {"timesUsed": firestore.Increment(1), "lastUsedAt": firestore.SERVER_TIMESTAMP},
            merge=True,
        )
