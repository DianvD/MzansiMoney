# RECOVERY.md - MzansiMoney data recovery & rollback system

> Status: **Phase 1 implemented** (per-import undo + ledger export + minimal integrity audit). Phases 2-3 are designed below, not yet built.
>
> Single user (`your-project-id`), region `africa-south1`, Firebase free-tier, no always-on server. Source of truth for the transaction shape is `functions/core/model.py`; mirror type changes in `web/src/types.ts`.

## 0. Design principles (mirror of the import path)

Recovery is the inverse of import and holds itself to the same bar `import_csv` does:

- **Dry-run first, write second.** Every destructive op has `dryRun` (default `true`) that returns exactly what *would* change, with counts, before anything is touched - the mirror of `previewOnly`.
- **Idempotent.** Re-running converges, never compounds.
- **Batch limits.** Reuse `_BATCH_LIMIT = 400` for all deletes/writes.
- **Backend-owned.** Clients are READ-ONLY on `transactions`/`documents`/`bills`. Every recovery mutation is a Cloud Function (Admin SDK). No new client-write rules on the ledger.
- **Never a footgun.** Default mode of every op is non-destructive; destruction requires an explicit, server-issued confirmation token that names exactly what will be deleted.
- **Audit everything.** Every committed action writes to `users/{uid}/recoveryLog`.

## 1. Threat model - how the numbers can silently skew

Ranked by likelihood × impact for this codebase. Dedup is strong, so the realistic threats are the seams *between* schemes/channels.

| # | Threat | Mechanism | Likelihood | Impact |
|---|--------|-----------|------------|--------|
| **T1** | Fingerprint-scheme mismatch across two imports of the same data | One import keys on a verified balance chain (`b:` ids), another of the same data imports without balance (`s:` ids) → same real txn, two doc ids → both survive | Medium | **High** - every overlapping txn double-counts |
| **T2** | Bad parse writes wrong rows | Mis-detected columns / parser bug emits wrong `signedAmount`/`date`; rows commit with *valid* fingerprints so a re-import won't catch them | Medium | **High** - silent skew, currently unrecoverable |
| **T3** | Overlapping statements, no balance | Both fall to the `s:` scheme; description drift across exports forks one real txn into two | Low-Medium | High |
| **T4** | Mid-write failure | Crash between 400-row batches leaves partial import, ledger stuck at `importing` | Low | Medium (self-heals on retry, if retried) |
| **T5** | Manual entry duplication | `add_transaction` doesn't dedup (by design); double-submit makes two docs | Low | Low (deletable) |
| **T6** | `set_category` merchant cascade over-writes unrelated txns | Low | Low-Medium (reversible) |
| **T7** | Operator error during recovery itself | Restore/undo targets the wrong thing | Low | **Catastrophic** - the whole safety model exists for this |

**Conclusion driving the phasing:** T1/T2 are the realistic high-impact threats. The document ledger already gives a tagged, auditable unit (every txn carries `documentId`/`importJobId` = source sha256), so **per-import undo is the highest-value, lowest-risk primitive** - a reverse of the existing write loop on a field that already exists.

## 2. The lever: imports are already auditable units

Each transaction doc carries (from `ingest.prepare_transactions`): `documentId` = `importJobId` = source `content_sha256`, plus `accountId`, `fingerprintScheme` (`balance|sequence|manual`), `sourceDocument`, `sourceInstitution`, `signedAmount`, `balanceAfter`, `dayIndex`, `date`, `description`, `category`. Each import is recorded at `users/{uid}/documents/{sha256}` with `status`, `transactionsWritten`, `filename`, `institution`, `account`, `logicalKey`, `periodStart/End`.

So **"undo import X"** ≡ delete all `transactions` where `documentId == X`, then mark the ledger doc `reverted`. Manual txns (`documentId == "manual"`) are never swept by an import-undo.

## 3. Architecture overview

```
Cloud Functions (functions/main.py):
  revert_import     - per-import undo (§4)             [Phase 1 ✓]
  export_ledger     - JSON snapshot to Storage (§6)    [Phase 1 ✓]
  audit_integrity   - read-only health report (§7)     [Phase 1 ✓ minimal]
  scan_duplicates   - cross-scheme dup detection (§5)  [Phase 2]
  repair_duplicates - apply a confirmed dup repair (§5)[Phase 2]
  restore_ledger    - restore from a snapshot (§6)     [Phase 3]

Firestore:
  users/{uid}/recoveryLog/{actionId}   audit trail (client-readable)
  users/{uid}/snapshots/{snapshotId}   snapshot manifests (metadata only)
  documents/{sha256}: + status "reverted"/"reverting", revertedAt, revertedTxnCount, revertReason

Cloud Storage:
  users/{uid}/snapshots/{snapshotId}.json   the export blob

firestore.rules: + recoveryLog & snapshots (read owner, write false).
  transactions/documents/bills rules UNCHANGED (client read-only).
```

All recovery ops are explicit, human-initiated callables - no scheduled/triggered functions needed (except an optional weekly auto-snapshot in Phase 3).

## 4. Primitive #1 - per-import undo (`revert_import`) - **Phase 1**

Removes exactly the transactions an import wrote (by `documentId`) and marks the ledger entry `reverted`, so the file can be cleanly re-imported (the txn docs are gone, and `status != "imported"` so `DocumentLedger.check` no longer short-circuits to `duplicate`).

```
revert_import(req) -> dict
  inputs:  documentId, dryRun=true, confirmToken?, reason="", revertBills=true
  dry-run: { status:"preview", documentId, filename, ledgerStatus,
             matchedCount, byScheme:{balance,sequence}, bills, sampleTxns[<=10],
             confirmToken, warnings[] }
  commit:  { status:"reverted", documentId, deleted, billsDeleted, recoveryLogId }
```

Algorithm: auth+ownership → load ledger doc → query `transactions where documentId == X` (single-field equality, no composite index) → **guard: reject `documentId == "manual"`** → dry-run returns counts/sample + a token → commit (valid token, live `matchedCount` unchanged) sets ledger `reverting`, deletes in 400-batches, sets `reverted` + audit. Works on `importing` status too (cleans up partial imports, T4).

## 5. Primitive #2 - duplicate scan + repair - **Phase 2**

Targets T1/T3. **Grouping key:** `(accountId, calendar-day(date), round(signedAmount,2), normalize_desc(description))` - the `s:` scheme's key minus `dayIndex`. A group with ≥2 docs of **differing ids** is a candidate. Discriminators:
- **Cross-scheme (T1):** members with both `balance` and `sequence` schemes for the same key → high confidence.
- **Same-scheme, cross-document (T3):** all `sequence`, different `documentId`, same key/ordinal → medium, needs per-group confirm.
- Two `balance` docs with different `balanceAfter` → **NOT a duplicate** (distinct lines; balance chain proves it).
- Two `manual` → low-confidence near-dup only; never auto-repair.

**Canonical winner:** keep the `balance`-scheme doc, remove others; if none, keep the most authoritative statement (earliest `periodStart`/most rows) or require the user to choose. `repair_duplicates` takes explicit echoed `keepId`/`removeIds`, re-verifies, deletes the extras - and **does not touch the ledger** (the source import's other rows are legitimate).

## 6. Primitive #3 - backup + restore - **`export_ledger` Phase 1, `restore_ledger` Phase 3**

**Storage choice: JSON blob in Cloud Storage** (`users/{uid}/snapshots/{id}.json`) + a small Firestore manifest (`snapshots/{id}`). Rejected a snapshot-*collection* (doubles doc count, burns quota). Snapshot captures the backend-owned ledger the user can't recreate: all `transactions`, `bills`, `documents`, and (cheap) `categoryRules`; excludes `secure/`.

Triggers: (1) manual "Back up now"; (2) **automatic pre-destructive-op** - `revert_import`/`repair_duplicates`/`restore_ledger` snapshot the current state before committing (makes every recovery action itself reversible); (3) optional weekly scheduled (Phase 3). Retention: last ~10 manual/pre-op + last 4 weekly.

```
export_ledger(req) -> { status:"exported", snapshotId, storagePath, counts, sizeBytes, createdAt }
restore_ledger(req): inputs snapshotId, mode("merge"|"replace"), scope[], dryRun=true, confirmToken?
  merge   (safe default): set snapshot docs by id; current docs absent from snapshot are LEFT ALONE.
  replace (dangerous): collection made to exactly match snapshot (deletes newer docs) - requires
          pre-restore auto-snapshot + destructiveCount + token echo.
```

Restore notes: default `scope` includes `documents` (else the ledger blocks clean re-import); store/restore concrete timestamps (never re-stamp `createdAt`); verify blob content hash before applying (fail closed).

## 7. Primitive #4 - integrity / audit (`audit_integrity`) - **Phase 1 (minimal)**

Read-only; makes skew **noticed early**. Phase 1 surfaces the two cheapest, highest-signal checks; Phases 2-3 add the rest.

```
audit_integrity(req) -> dict
  perImport[]:        documentId, filename, status, transactionsWritten (claimed),
                      liveTxnCount (actual count of documentId==X), mismatch  [Phase 1]
  stuckImports[]:     ledger status "importing"/"reverting"                   [Phase 1]
  overlappingPeriods[]: same accountId, overlapping [periodStart,periodEnd]   [Phase 3]
  duplicateGroups: n  (high-confidence, from §5 classifier)                   [Phase 2]
  balanceChain[]:     per account, does the running balance still reconcile?  [Phase 3]
```

Check #4 (balance reconciliation) reuses the same invariant `_check_balance_chain` enforces at import - factor it into a shared helper so import and audit share one implementation.

## 8. Safety model

- **Dry-run first** on every mutating callable; non-destructive ones (`scan_duplicates`, `audit_integrity`, `export_ledger`) need no token.
- **Confirmation tokens:** server-issued, short-lived (~5 min), single-op HMAC over `uid|op|targetSignature|expiry`. On commit the function recomputes the live `targetSignature`; if the world changed since the dry-run the token is void (`FAILED_PRECONDITION`). Stateless (no Firestore round-trip).
- **Mark-status-before-mutate** (`reverting`/`restoring`) mirrors import's `importing`-before-write, so a crashed op is recoverable and visible in the stuck-imports check.
- **Every destructive commit auto-snapshots first** and records `preOpSnapshotId` in `recoveryLog`.
- **Never** delete the ledger doc on revert; **never** touch the ledger on dup-repair; **never** re-stamp `createdAt` on restore.
- `recoveryLog` (client-readable, backend-write) records `op`, `at`, `reason`, `target`, `effect`, `preOpSnapshotId`, `confirmTokenDigest`.

## 9. UI surface

A single **Recovery / Health** area beside the **Import** page (recovery is the inverse of import). New `data.ts` callable wrappers mirror `callImport`; `subscribeRecoveryLog`/`subscribeSnapshots` mirror `subscribeBills`. The user sees: a Health summary (green/amber/red) with deep links; an Imports list with "Undo this import"; a duplicate-review screen; backups list with restore; and the recovery history. Every destructive action uses the same two-step dry-run → confirm modal the import preview already established.

## 10. Phased plan

- **Phase 0 (groundwork):** factor `_check_balance_chain` into a shared helper; add `recoveryLog`/`snapshots` rules; extend the ledger status vocabulary.
- **Phase 1 (minimal first slice - most safety for least risk):** `revert_import` + `export_ledger` + minimal `audit_integrity`. Neutralizes T2/T4 (likely + currently unrecoverable) using existing fields, gives a total fallback (export), and makes skew visible (audit). Makes the corruption scenario **survivable**: notice → snapshot → undo the bad import.
- **Phase 2:** `scan_duplicates` + `repair_duplicates` (T1/T3).
- **Phase 3:** `restore_ledger` (merge + replace, pre-op snapshot, token echo), retention, weekly snapshot, full Health view.

## 11. Alternatives considered

- **Soft-delete/tombstones** instead of hard-delete: rejected for the ledger - every read path (metrics, donut, net worth) would need to filter `deleted`, and quotas grow with garbage. Pre-op snapshot already provides the reversibility it would buy.
- **Firestore PITR / managed export:** paid/Blaze, project-wide, 7-day window - a disaster backstop, not the surgical per-import UX needed. Optionally enable later as defense-in-depth.
- **Event-sourcing / versioned txns:** over-engineering for a single-user free-tier app; the import path is already idempotent and the ledger already gives per-import grouping.
