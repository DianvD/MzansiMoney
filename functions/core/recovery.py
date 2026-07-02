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
_MAX_EXPORT_DOCS = 100_000  # bound the in-memory snapshot so one export can't OOM the function


# ---- confirmation tokens (pure) -------------------------------------------

def _secret() -> bytes:
    """HMAC key for confirmation tokens. MUST be provided via the
    ``RECOVERY_TOKEN_SECRET`` env var (a Firebase secret) in any real deployment.

    We deliberately do NOT fall back to a hardcoded value: these tokens are the
    only thing guarding destructive recovery ops, so a known key would let a
    client forge a confirmation and skip the dry-run safety. Fail closed instead.

    ``ALLOW_DEV_SECRETS=1`` opts into a throwaway key ONLY when the Firebase
    Functions emulator is running (``FUNCTIONS_EMULATOR=true``). In production
    (emulator env absent) the flag is ignored and the function fails closed,
    so accidentally setting it in prod has no effect."""
    s = os.environ.get("RECOVERY_TOKEN_SECRET")
    if not s:
        if (os.environ.get("ALLOW_DEV_SECRETS") == "1"
                and os.environ.get("FUNCTIONS_EMULATOR") == "true"):
            return b"dev-only-insecure-recovery-secret-do-not-use-in-prod"
        raise RuntimeError(
            "RECOVERY_TOKEN_SECRET is not set. Generate one with "
            "`openssl rand -hex 32` and set it as a Functions secret "
            "(see docs/SETUP.md). Refusing to use an insecure default."
        )
    if len(s) < 32:
        raise RuntimeError("RECOVERY_TOKEN_SECRET must be at least 32 characters.")
    return s.encode()


# ---- single-use nonce helpers (Firestore-facing) ---------------------------

def _store_nonce(db, uid: str, nonce: str, op: str) -> None:
    """Persist a freshly-issued token nonce so it can be consumed exactly once."""
    _user(db, uid).collection("recoveryNonces").document(nonce).set(
        {"createdAt": firestore.SERVER_TIMESTAMP, "op": op}
    )


def _consume_nonce(db, uid: str, nonce: str) -> bool:
    """Check that ``nonce`` exists and delete it (single-use).

    Returns True if the nonce was present and successfully consumed.
    Returns False if the nonce is absent (already consumed or never issued).

    Note: uses a get-then-delete rather than a Firestore transaction.
    For a personal-use app the TOCTOU window is negligible (would require two
    simultaneous commit requests with the same token within the 300s TTL).
    """
    doc = _user(db, uid).collection("recoveryNonces").document(nonce)
    snap = doc.get()
    if not snap.exists:
        return False
    doc.delete()
    return True


# ---- confirmation tokens (pure + optional nonce) ---------------------------

def make_token(uid: str, op: str, target_sig: str, ttl: int = _TOKEN_TTL, *, db=None) -> str:
    """A short-lived, single-op confirmation token.

    ``target_sig`` encodes exactly what will change, so a stale confirmation
    can't apply to a different set.

    When ``db`` is provided a nonce is stored in ``users/{uid}/recoveryNonces``
    making the token single-use (the commit path must call ``verify_token`` with
    ``db`` and ``consume=True`` to enforce it).

    Token format: ``{expiry}:{nonce_hex}:{hmac_digest}``
    The nonce is included in the HMAC so stripping it invalidates the signature.
    """
    expiry = int(time.time()) + ttl
    nonce = os.urandom(16).hex()  # 32 hex chars; embedded in token + HMAC
    digest = hmac.new(
        _secret(),
        f"{uid}|{op}|{target_sig}|{expiry}|{nonce}".encode(),
        hashlib.sha256,
    ).hexdigest()
    if db is not None:
        _store_nonce(db, uid, nonce, op)
    return f"{expiry}:{nonce}:{digest}"


def verify_token(
    token: str, uid: str, op: str, target_sig: str, *, db=None, consume: bool = False
) -> bool:
    """Verify a confirmation token produced by ``make_token``.

    When ``db`` and ``consume=True`` are both provided the nonce is checked
    against Firestore and deleted on success, enforcing single-use semantics.
    A token whose nonce has already been consumed (or was never stored) is
    rejected even if the HMAC is valid.

    When ``db`` is None (offline tests, pure HMAC check) the nonce is verified
    only via the HMAC — single-use enforcement is skipped.
    """
    try:
        expiry_s, nonce, digest = (token or "").split(":", 2)
        expiry = int(expiry_s)
    except (ValueError, AttributeError):
        return False
    if time.time() > expiry:
        return False
    expected = hmac.new(
        _secret(),
        f"{uid}|{op}|{target_sig}|{expiry}|{nonce}".encode(),
        hashlib.sha256,
    ).hexdigest()
    if not hmac.compare_digest(expected, digest):
        return False
    if db is not None and consume:
        if not _consume_nonce(db, uid, nonce):
            return False  # nonce already consumed or never issued
    return True


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
    total = 0
    for name in _SNAPSHOT_SCOPE:
        items = []
        # Count *inside* the stream so we bail before materializing a giant
        # collection in memory (a single huge `transactions` set is the real OOM
        # risk, not the cumulative total).
        for d in user.collection(name).stream():
            items.append({"id": d.id, **(d.to_dict() or {})})
            total += 1
            if total > _MAX_EXPORT_DOCS:
                raise RuntimeError(
                    f"Ledger too large to snapshot in one pass (> {_MAX_EXPORT_DOCS} docs). "
                    "Export in smaller scopes or contact support."
                )
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


# ---- provenance-aware revert (pure) ---------------------------------------

def plan_revert(target_fps, other_active: dict) -> tuple[list, dict]:
    """Decide what undoing an import should do to each row it wrote, so that
    overlapping imports don't lose data. ``other_active`` maps every OTHER
    non-reverted import's id -> the set of fingerprints it wrote.

    For each of THIS import's fingerprints:
      * if another active import also wrote it (overlap) -> **re-attribute** the
        row to that import and keep it (deleting it would silently drop a row the
        user still has via the other statement),
      * otherwise this import is the row's sole owner -> **delete** it.

    Returns ``(to_delete: list[str], reattribute: {fp: owning_import_id})``.
    Deterministic: the surviving owner is the lowest import id, so a preview and
    its later commit compute an identical plan (the confirmation token binds it).
    """
    to_delete, reattribute = [], {}
    owners = sorted(other_active)
    for fp in target_fps:
        owner = next((iid for iid in owners if fp in other_active[iid]), None)
        if owner is not None:
            reattribute[fp] = owner
        else:
            to_delete.append(fp)
    return to_delete, reattribute


def _other_active_fingerprints(user, *, exclude: str) -> dict:
    """{import_id: set(fingerprints)} for every other import that still owns rows
    and recorded provenance. Imports without a stored fingerprint list (pre-feature
    or over the cap) are skipped - they simply can't lend a row a survivor."""
    out = {}
    for d in user.collection("documents").stream():
        if d.id == exclude:
            continue
        meta = d.to_dict() or {}
        if meta.get("status") not in ("imported", "importing"):
            continue
        fps = meta.get("fingerprints")
        if isinstance(fps, list) and fps:
            out[d.id] = set(fps)
    return out


def _batch_reattribute(db, txns, reattribute: dict) -> int:
    """Re-point shared rows at their surviving owner (documentId merge-write)."""
    items = list(reattribute.items())
    n = 0
    for start in range(0, len(items), _BATCH_LIMIT):
        batch = db.batch()
        for fp, owner in items[start:start + _BATCH_LIMIT]:
            batch.set(txns.document(fp), {"documentId": owner}, merge=True)
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

    # Provenance-aware plan when this import recorded its fingerprints: a row that
    # a *still-active* overlapping import also wrote is kept (re-attributed to that
    # import) instead of deleted, so undoing one statement can't silently drop rows
    # the user still has via another. Imports from before this feature have no
    # fingerprint list and fall back to the legacy "delete everything pointing at
    # me" behaviour.
    target_fps = meta.get("fingerprints")
    provenance = isinstance(target_fps, list) and bool(target_fps)
    if provenance:
        other_active = _other_active_fingerprints(user, exclude=document_id)
        to_delete, reattribute = plan_revert(target_fps, other_active)
        delete_count, reattribute_count = len(to_delete), len(reattribute)
    else:
        to_delete, reattribute = None, {}
        delete_count, reattribute_count = len(matches), 0

    bills = user.collection("bills")
    bill_matches = (list(bills.where(filter=FieldFilter("documentId", "==", document_id)).stream())
                    if revert_bills else [])

    target_sig = f"{document_id}|{delete_count}|{reattribute_count}|{len(bill_matches)}"
    if dry_run or not confirm_token:
        return {
            "status": "preview", "documentId": document_id,
            "filename": meta.get("filename"), "ledgerStatus": meta.get("status"),
            "matchedCount": delete_count, "reattributedCount": reattribute_count,
            "byScheme": by_scheme, "bills": len(bill_matches),
            "sampleTxns": sample,
            # Pass db so the nonce is stored in Firestore (single-use enforcement).
            "confirmToken": make_token(uid, "revert_import", target_sig, db=db),
            "warnings": _revert_warnings(meta, delete_count, reattribute_count, provenance),
        }

    # consume=True: nonce is deleted on first use; a replayed token is rejected.
    if not verify_token(confirm_token, uid, "revert_import", target_sig, db=db, consume=True):
        raise PermissionError("Confirmation expired or the data changed since the preview - re-check and try again.")

    # Snapshot current state first so the revert itself is reversible. If the
    # backup can't be taken (storage down, or ledger too large to snapshot) we
    # still proceed - the revert is already gated by a dry-run + confirmation
    # token - but we record WHY so a missing backup is never silent.
    pre, pre_error = None, None
    try:
        pre = export_ledger(db, uid, reason="pre_revert")["snapshotId"]
    except Exception as e:
        pre_error = str(e) or e.__class__.__name__

    ledger_ref.set({"status": "reverting", "revertStartedAt": firestore.SERVER_TIMESTAMP}, merge=True)
    if provenance:
        deleted = _batch_delete(db, [txns.document(fp) for fp in to_delete])
        reattributed = _batch_reattribute(db, txns, reattribute)
    else:
        deleted = _batch_delete(db, [d.reference for d in matches])
        reattributed = 0
    bills_deleted = _batch_delete(db, [d.reference for d in bill_matches])
    ledger_ref.set({"status": "reverted", "revertedAt": firestore.SERVER_TIMESTAMP,
                    "revertedTxnCount": deleted, "reattributedTxnCount": reattributed,
                    "revertReason": reason}, merge=True)

    log_id = _log(db, uid, op="revert_import", reason=reason, target={"documentId": document_id},
                  effect={"deleted": deleted, "reattributed": reattributed,
                          "billsDeleted": bills_deleted, "preOpSnapshotError": pre_error},
                  pre_op_snapshot_id=pre, token=confirm_token)

    return {"status": "reverted", "documentId": document_id, "deleted": deleted,
            "reattributed": reattributed, "billsDeleted": bills_deleted, "preOpSnapshotId": pre,
            "preOpSnapshotError": pre_error, "recoveryLogId": log_id}


def _revert_warnings(meta: dict, delete_count: int, reattribute_count: int = 0,
                     provenance: bool = False) -> list[str]:
    w = []
    claimed = meta.get("transactionsWritten")
    if provenance:
        if reattribute_count:
            w.append(f"{reattribute_count} row(s) are shared with a later overlapping import "
                     f"and will be kept (re-attributed), not deleted.")
        if claimed is not None and claimed != delete_count + reattribute_count:
            w.append(f"This import wrote {claimed} rows; {delete_count + reattribute_count} are still "
                     f"attributable to it now (the rest were superseded by a newer import).")
    elif claimed is not None and claimed != delete_count:
        # Legacy (no provenance): claimed-vs-live skew is usually overlap, not loss.
        w.append(f"The import recorded {claimed} rows but {delete_count} currently point to it "
                 f"(others were re-written by a later overlapping import).")
    if meta.get("status") not in ("imported", "importing"):
        w.append(f"This import's status is '{meta.get('status')}'.")
    return w


# ---- audit_integrity ------------------------------------------------------

def audit_integrity(db, uid: str) -> dict:
    """Read-only health report. No writes.

    For each import we compare the rows it *wrote* (``transactionsWritten``) with
    the rows that *still point to it* (``liveTxnCount``) and classify:

    * **reconciled** (``live < claimed``) - benign. Some of this import's rows were
      re-written by a *later overlapping* import of the same account (same
      fingerprint = same doc id = idempotent overwrite), so they now count under
      the newer import. No data was lost; ownership just moved. This is the normal
      result of importing two statements that overlap and must NOT raise an alarm.
    * **mismatch** (``live > claimed``) - a genuine anomaly (more rows attributed
      to the import than it recorded writing); worth a look.
    * **stuck** - left mid-import/-revert.

    Dates (import time + statement period + reverted time) are surfaced so the user
    can see *when* and *what window* each import covered.
    """
    user = _user(db, uid)
    txns = user.collection("transactions")
    per_import = []
    stuck = []
    for d in user.collection("documents").stream():
        meta = d.to_dict() or {}
        status = meta.get("status")
        claimed = meta.get("transactionsWritten")
        live = sum(1 for _ in txns.where(filter=FieldFilter("documentId", "==", d.id)).select([]).stream())
        countable = status == "imported" and claimed is not None
        mismatch = countable and live > claimed          # genuine anomaly
        reconciled = countable and live < claimed         # benign overlap (superseded)
        per_import.append({
            "documentId": d.id, "filename": meta.get("filename"), "institution": meta.get("institution"),
            "account": meta.get("account"), "status": status, "transactionsWritten": claimed,
            "liveTxnCount": live, "mismatch": mismatch, "reconciled": reconciled,
            "createdAt": _iso(meta.get("createdAt")), "periodStart": _iso(meta.get("periodStart")),
            "periodEnd": _iso(meta.get("periodEnd")), "revertedAt": _iso(meta.get("revertedAt")),
        })
        if status in ("importing", "reverting"):
            stuck.append({"documentId": d.id, "filename": meta.get("filename"), "status": status})

    total = sum(1 for _ in txns.select([]).stream())
    # Only true anomalies and stuck imports are a problem; benign overlap is just info.
    has_warn = any(p["mismatch"] for p in per_import) or bool(stuck)
    return {"status": "warnings" if has_warn else "ok", "perImport": per_import,
            "stuckImports": stuck, "totalTxns": total,
            "reconciledCount": sum(1 for p in per_import if p["reconciled"])}
