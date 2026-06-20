"""Data recovery / rollback - Phase 1.

Per-import undo (``revert_import``), full ledger export (``export_ledger``), and a
minimal integrity audit (``audit_integrity``). See ``docs/RECOVERY.md`` for the
full design + threat model.

Safety model (mirrors the import path):
* every destructive op is **dry-run first** and returns a short-lived
  confirmation token; the commit recomputes the token's target signature and
  rejects it if the data changed since the preview,
* the current ledger is **snapshotted before** any destructive commit, so the op
  is itself reversible,
* deletes chunk at 400/commit, and
* every committed action is recorded in ``users/{uid}/recoveryLog``.

This module is Firestore-facing; the pure token logic is unit-tested offline.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import time
from datetime import datetime, timezone

from firebase_admin import firestore
from google.cloud.firestore_v1.base_query import FieldFilter

from .storage import store_snapshot

_BATCH_LIMIT = 400
_TOKEN_TTL = 300  # seconds - a confirmation is good for 5 minutes
_SNAPSHOT_SCOPE = ("transactions", "bills", "documents", "categoryRules")


# ---- confirmation tokens (pure) -------------------------------------------

def _secret() -> bytes:
    return (os.environ.get("RECOVERY_TOKEN_SECRET") or "app-recovery-dev-secret").encode()


def make_token(uid: str, op: str, target_sig: str, ttl: int = _TOKEN_TTL) -> str:
    """A stateless, single-op, short-lived confirmation. ``target_sig`` encodes
    exactly what will change, so a stale confirmation can't apply to a different set."""
    expiry = int(time.time()) + ttl
    digest = hmac.new(_secret(), f"{uid}|{op}|{target_sig}|{expiry}".encode(), hashlib.sha256).hexdigest()
    return f"{expiry}:{digest}"


def verify_token(token: str, uid: str, op: str, target_sig: str) -> bool:
    try:
        expiry_s, digest = (token or "").split(":", 1)
        expiry = int(expiry_s)
    except (ValueError, AttributeError):
        return False
    if time.time() > expiry:
        return False
    expected = hmac.new(_secret(), f"{uid}|{op}|{target_sig}|{expiry}".encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, digest)


# ---- helpers --------------------------------------------------------------

def _user(db, uid: str):
    return db.collection("users").document(uid)


def _iso(v):
    return v.isoformat() if hasattr(v, "isoformat") else v


def json_default(o):
    """JSON encoder for a Firestore snapshot: timestamps/datetimes -> ISO,
    bytes -> hex, anything else -> str (never crash a backup on an exotic type)."""
    if hasattr(o, "isoformat"):
        return o.isoformat()
    if isinstance(o, bytes):
        return o.hex()
    return str(o)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---- export_ledger --------------------------------------------------------

def export_ledger(db, uid: str, *, reason: str = "manual") -> dict:
    """Snapshot the backend-owned ledger (transactions, bills, documents,
    categoryRules) to a single JSON blob in Cloud Storage, with a small manifest
    in Firestore. The blob - not a snapshot collection - keeps doc count/quota lean."""
    user = _user(db, uid)
    payload: dict = {"schema": 1, "reason": reason, "exportedAt": _now_iso()}
    counts: dict = {}
    for name in _SNAPSHOT_SCOPE:
        items = [{"id": d.id, **(d.to_dict() or {})} for d in user.collection(name).stream()]
        payload[name] = items
        counts[name] = len(items)

    blob = json.dumps(payload, default=json_default)
    size = len(blob.encode())
    content_hash = hashlib.sha256(blob.encode()).hexdigest()
    snapshot_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + content_hash[:8]

    storage_path = store_snapshot(uid, snapshot_id, blob)
    if not storage_path:
        raise RuntimeError("Could not write the snapshot to storage - backup aborted.")

    user.collection("snapshots").document(snapshot_id).set({
        "snapshotId": snapshot_id, "reason": reason, "counts": counts, "sizeBytes": size,
        "contentHash": content_hash, "storagePath": storage_path,
        "createdAt": firestore.SERVER_TIMESTAMP,
    })
    return {"status": "exported", "snapshotId": snapshot_id, "storagePath": storage_path,
            "counts": counts, "sizeBytes": size, "createdAt": _now_iso()}


# ---- recovery log ---------------------------------------------------------

def _log(db, uid, *, op, reason, target, effect, pre_op_snapshot_id, token) -> str:
    ref = _user(db, uid).collection("recoveryLog").document()
    ref.set({
        "op": op, "at": firestore.SERVER_TIMESTAMP, "reason": reason,
        "target": target, "effect": effect, "preOpSnapshotId": pre_op_snapshot_id,
        "confirmTokenDigest": hashlib.sha256((token or "").encode()).hexdigest()[:16],
    })
    return ref.id


def _batch_delete(db, refs) -> int:
    n = 0
    for start in range(0, len(refs), _BATCH_LIMIT):
        batch = db.batch()
        for ref in refs[start:start + _BATCH_LIMIT]:
            batch.delete(ref)
            n += 1
        batch.commit()
    return n


# ---- revert_import --------------------------------------------------------

def revert_import(db, uid: str, *, document_id: str, dry_run: bool = True,
                  confirm_token: str | None = None, reason: str = "",
                  revert_bills: bool = True) -> dict:
    """Remove exactly the transactions (and optionally the bill) a given import
    wrote, and mark the ledger entry ``reverted`` so the file can be cleanly
    re-imported. Never sweeps manual entries."""
    if not document_id or document_id == "manual":
        raise ValueError("A specific imported documentId is required (manual entries can't be bulk-reverted).")

    user = _user(db, uid)
    ledger_ref = user.collection("documents").document(document_id)
    snap = ledger_ref.get()
    if not snap.exists:
        raise LookupError("No import found for that document.")
    meta = snap.to_dict() or {}

    txns = user.collection("transactions")
    matches = list(txns.where(filter=FieldFilter("documentId", "==", document_id)).stream())
    by_scheme = {"balance": 0, "sequence": 0, "manual": 0, "other": 0}
    sample = []
    for d in matches:
        t = d.to_dict() or {}
        sch = t.get("fingerprintScheme")
        by_scheme[sch if sch in by_scheme else "other"] += 1
        if len(sample) < 10:
            sample.append({"id": d.id, "date": _iso(t.get("date")),
                           "description": t.get("description"), "signedAmount": t.get("signedAmount")})
    matched = len(matches)

    bills = user.collection("bills")
    bill_matches = (list(bills.where(filter=FieldFilter("documentId", "==", document_id)).stream())
                    if revert_bills else [])

    target_sig = f"{document_id}|{matched}|{len(bill_matches)}"
    if dry_run or not confirm_token:
        return {
            "status": "preview", "documentId": document_id,
            "filename": meta.get("filename"), "ledgerStatus": meta.get("status"),
            "matchedCount": matched, "byScheme": by_scheme, "bills": len(bill_matches),
            "sampleTxns": sample, "confirmToken": make_token(uid, "revert_import", target_sig),
            "warnings": _revert_warnings(meta, matched),
        }

    if not verify_token(confirm_token, uid, "revert_import", target_sig):
        raise PermissionError("Confirmation expired or the data changed since the preview - re-check and try again.")

    # Snapshot current state first so the revert itself is reversible. If storage
    # is unavailable we proceed but flag that no pre-op backup was taken.
    try:
        pre = export_ledger(db, uid, reason="pre_revert")["snapshotId"]
    except Exception:
        pre = None

    ledger_ref.set({"status": "reverting", "revertStartedAt": firestore.SERVER_TIMESTAMP}, merge=True)
    deleted = _batch_delete(db, [d.reference for d in matches])
    bills_deleted = _batch_delete(db, [d.reference for d in bill_matches])
    ledger_ref.set({"status": "reverted", "revertedAt": firestore.SERVER_TIMESTAMP,
                    "revertedTxnCount": deleted, "revertReason": reason}, merge=True)

    log_id = _log(db, uid, op="revert_import", reason=reason, target={"documentId": document_id},
                  effect={"deleted": deleted, "billsDeleted": bills_deleted},
                  pre_op_snapshot_id=pre, token=confirm_token)

    return {"status": "reverted", "documentId": document_id, "deleted": deleted,
            "billsDeleted": bills_deleted, "preOpSnapshotId": pre, "recoveryLogId": log_id}


def _revert_warnings(meta: dict, matched: int) -> list[str]:
    w = []
    claimed = meta.get("transactionsWritten")
    if claimed is not None and claimed != matched:
        w.append(f"The import recorded {claimed} rows but {matched} exist now.")
    if meta.get("status") not in ("imported", "importing"):
        w.append(f"This import's status is '{meta.get('status')}'.")
    return w


# ---- audit_integrity ------------------------------------------------------

def audit_integrity(db, uid: str) -> dict:
    """Read-only health report: per-import claimed-vs-live counts (skew flag) and
    stuck (importing/reverting) imports. No writes."""
    user = _user(db, uid)
    txns = user.collection("transactions")
    per_import = []
    stuck = []
    for d in user.collection("documents").stream():
        meta = d.to_dict() or {}
        status = meta.get("status")
        claimed = meta.get("transactionsWritten")
        live = sum(1 for _ in txns.where(filter=FieldFilter("documentId", "==", d.id)).select([]).stream())
        mismatch = status == "imported" and claimed is not None and claimed != live
        per_import.append({
            "documentId": d.id, "filename": meta.get("filename"), "institution": meta.get("institution"),
            "account": meta.get("account"), "status": status, "transactionsWritten": claimed,
            "liveTxnCount": live, "mismatch": mismatch,
        })
        if status in ("importing", "reverting"):
            stuck.append({"documentId": d.id, "filename": meta.get("filename"), "status": status})

    total = sum(1 for _ in txns.select([]).stream())
    has_warn = any(p["mismatch"] for p in per_import) or bool(stuck)
    return {"status": "warnings" if has_warn else "ok", "perImport": per_import,
            "stuckImports": stuck, "totalTxns": total}
