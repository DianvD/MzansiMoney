"""Original-document retention.

The spec requires keeping the original financial documents. We store them in
Cloud Storage at ``users/{uid}/documents/{sha256}`` (the same key as the ledger
doc). Best-effort: if Storage isn't reachable (e.g. emulator not running), import
still succeeds and the document is recorded without a stored blob - the blob is an
archive, not part of the dedup or accounting path.

All blobs are encrypted at rest using AES-256-GCM (STATEMENT_KEY). Legacy blobs
uploaded before encryption was added remain readable via ``_maybe_decrypt``.

Client-side blob downloads: verified absent (no getDownloadURL / getBlob calls
in web/src). All Storage reads go through backend functions only.
"""
from __future__ import annotations

import os
from typing import Optional

from firebase_admin import storage

from .cryptobox import _MAGIC, decrypt_bytes, encrypt_bytes


def _maybe_decrypt(data: bytes) -> bytes:
    """Return plaintext from a storage blob.

    Encrypted blobs (start with MAGIC prefix) are decrypted.
    Legacy plaintext blobs (no prefix) are returned as-is to preserve
    backward compatibility with blobs uploaded before encryption was added.
    """
    if data.startswith(_MAGIC):
        return decrypt_bytes(data)
    return data


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
    """Store an encrypted copy of the original financial document.

    The original content_type is preserved in blob custom metadata so future
    readers can recover the format without inspecting the (now opaque) bytes.
    """
    try:
        blob = _bucket().blob(f"users/{uid}/documents/{content_hash}")
        if not blob.exists():
            encrypted = encrypt_bytes(data)
            # Stash original MIME type; the blob itself is opaque ciphertext.
            blob.metadata = {"originalContentType": content_type}
            blob.upload_from_string(encrypted, content_type="application/octet-stream")
        return blob.name
    except Exception:
        return None


def store_snapshot(uid: str, snapshot_id: str, text: str) -> Optional[str]:
    """Write an encrypted recovery snapshot blob (JSON ledger export).

    Unlike document archival, a failure here is significant - the caller treats
    a None return as a failed backup and aborts the destructive op that needed it.
    Encryption failures (e.g. STATEMENT_KEY missing) propagate as None here,
    which the caller treats as a backup failure.
    """
    try:
        blob = _bucket().blob(f"users/{uid}/snapshots/{snapshot_id}.json")
        encrypted = encrypt_bytes(text.encode("utf-8"))
        blob.upload_from_string(encrypted, content_type="application/octet-stream")
        return blob.name
    except Exception:
        return None
