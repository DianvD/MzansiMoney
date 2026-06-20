"""Original-document retention.

The spec requires keeping the original financial documents. We store them in
Cloud Storage at ``users/{uid}/documents/{sha256}`` (the same key as the ledger
doc). Best-effort: if Storage isn't reachable (e.g. emulator not running), import
still succeeds and the document is recorded without a stored blob - the blob is an
archive, not part of the dedup or accounting path.
"""
from __future__ import annotations

import os
from typing import Optional

from firebase_admin import storage


def _bucket():
    try:
        return storage.bucket()  # default bucket if init configured one
    except Exception:
        project = (
            os.environ.get("GCLOUD_PROJECT")
            or os.environ.get("GOOGLE_CLOUD_PROJECT")
            or os.environ.get("FIREBASE_PROJECT")
        )
        if not project:
            raise
        # Firebase default bucket naming.
        return storage.bucket(f"{project}.appspot.com")


def store_original(
    uid: str, content_hash: str, data: bytes, content_type: str = "application/pdf"
) -> Optional[str]:
    try:
        blob = _bucket().blob(f"users/{uid}/documents/{content_hash}")
        if not blob.exists():
            blob.upload_from_string(data, content_type=content_type)
        return blob.name
    except Exception:
        return None


def store_snapshot(uid: str, snapshot_id: str, text: str) -> Optional[str]:
    """Write a recovery snapshot blob (JSON ledger export). Unlike document
    archival, a failure here is significant - the caller treats a None return as a
    failed backup and aborts the destructive op that needed it."""
    try:
        blob = _bucket().blob(f"users/{uid}/snapshots/{snapshot_id}.json")
        blob.upload_from_string(text, content_type="application/json")
        return blob.name
    except Exception:
        return None
