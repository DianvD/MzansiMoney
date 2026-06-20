"""Document ledger - "have we already ingested this?" (Layer 1 dedup).

Every ingestion attempt is recorded at ``users/{uid}/documents/{sha256}`` so the
doc id itself is the exact-bytes key. Before importing, ``check`` tests four
signals in order of strength and returns one of:

* ``new``          - go ahead and import.
* ``duplicate``    - already have it; skip silently.
* ``needs_review`` - looks like the same statement via a different file; do NOT
  auto-import, surface to the user.

Single-field equality queries only, so no composite indexes are required.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from firebase_admin import firestore
from google.cloud.firestore_v1.base_query import FieldFilter

NEW = "new"
DUPLICATE = "duplicate"
NEEDS_REVIEW = "needs_review"


@dataclass
class DedupResult:
    decision: str
    reason: str
    existing_id: Optional[str] = None


class DocumentLedger:
    def __init__(self, db, uid: str):
        self._col = db.collection("users").document(uid).collection("documents")

    def check(
        self,
        *,
        content_hash: str,
        gmail_message_id: Optional[str] = None,
        doc_number: Optional[str] = None,
        institution: Optional[str] = None,
        logical_key: Optional[str] = None,
    ) -> DedupResult:
        # 1) Exact same bytes already imported.
        snap = self._col.document(content_hash).get()
        if snap.exists and (snap.to_dict() or {}).get("status") == "imported":
            return DedupResult(DUPLICATE, "Identical file already imported.", content_hash)

        # 2) Same Gmail attachment already pulled.
        if gmail_message_id:
            hit = self._first("gmailMessageId", gmail_message_id, exclude=content_hash)
            if hit:
                return DedupResult(DUPLICATE, "This email attachment was already imported.", hit)

        # 3) Same biller document number (e.g. invoice INV00667) already present -
        #    this is what stops an invoice being counted again via a statement.
        if doc_number:
            for ref in self._many("docNumber", doc_number, exclude=content_hash):
                data = ref.to_dict() or {}
                if not institution or data.get("institution") == institution:
                    return DedupResult(
                        DUPLICATE,
                        f"Document {doc_number} was already imported.",
                        ref.id,
                    )

        # 4) Same logical statement (institution/account/period/type), different bytes.
        if logical_key:
            for ref in self._many("logicalKey", logical_key, exclude=content_hash):
                if (ref.to_dict() or {}).get("status") in ("imported", "needs_review"):
                    return DedupResult(
                        NEEDS_REVIEW,
                        "A statement for the same account and period is already present "
                        "(different file). Review before importing to avoid double counting.",
                        ref.id,
                    )

        return DedupResult(NEW, "No matching document.")

    def register(self, content_hash: str, meta: dict) -> None:
        payload = {**meta, "contentHash": content_hash, "updatedAt": firestore.SERVER_TIMESTAMP}
        self._col.document(content_hash).set(payload, merge=True)

    def record_duplicate_attempt(self, existing_id: str) -> None:
        """Audit a rejected duplicate WITHOUT touching the original's status -
        overwriting status here is what silently re-opens the door to dupes."""
        self._col.document(existing_id).set(
            {
                "duplicateAttempts": firestore.Increment(1),
                "lastDuplicateAt": firestore.SERVER_TIMESTAMP,
            },
            merge=True,
        )

    # ---- helpers -----------------------------------------------------------

    def _first(self, field: str, value, *, exclude: str) -> Optional[str]:
        for ref in self._many(field, value, exclude=exclude):
            return ref.id
        return None

    def _many(self, field: str, value, *, exclude: str, limit: int = 5):
        docs = self._col.where(filter=FieldFilter(field, "==", value)).limit(limit).get()
        return [d for d in docs if d.id != exclude]
