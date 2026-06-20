import { useEffect, useState } from "react";
import Panel from "./Panel";
import { useAuth } from "../auth";
import {
  auditIntegrity,
  exportLedger,
  revertImport,
  subscribeRecoveryLog,
  subscribeSnapshots,
  type AuditResult,
  type RecoveryLogEntry,
  type RevertPreview,
  type SnapshotManifest,
} from "../lib/data";
import { shortDate, signedMoney, tsToDate } from "../lib/format";

/** Data health + recovery. Surfaces per-import count skew, lets the user undo a
 * single import (the inverse of the importer), and back the ledger up. The
 * destructive bit (undo) is always a dry-run preview -> explicit confirm, and the
 * backend snapshots the data before deleting anything. See docs/RECOVERY.md. */
export default function RecoveryPanel() {
  const { user } = useAuth();
  const [audit, setAudit] = useState<AuditResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<RevertPreview | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [snapshots, setSnapshots] = useState<SnapshotManifest[]>([]);
  const [log, setLog] = useState<RecoveryLogEntry[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!user || !open) return;
    const a = subscribeSnapshots(user.uid, setSnapshots, () => {});
    const b = subscribeRecoveryLog(user.uid, setLog, () => {});
    return () => { a(); b(); };
  }, [user, open]);

  async function loadAudit() {
    setLoading(true);
    setErr(null);
    try {
      setAudit(await auditIntegrity());
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Health check failed.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (open && !audit) void loadAudit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function backup() {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const r = await exportLedger("manual");
      setMsg(`Backed up ${r.counts.transactions} transactions (snapshot ${r.snapshotId}).`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Backup failed.");
    } finally {
      setBusy(false);
    }
  }

  async function startUndo(documentId: string) {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const res = await revertImport({ documentId });
      if (res.status === "preview") setPending(res);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not prepare the undo.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmUndo() {
    if (!pending) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await revertImport({
        documentId: pending.documentId,
        dryRun: false,
        confirmToken: pending.confirmToken,
        reason: "manual undo",
      });
      if (res.status === "reverted") {
        setMsg(`Removed ${res.deleted} transaction(s). The file can be re-imported cleanly.`);
        setPending(null);
        await loadAudit();
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Undo failed.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Panel title="Data health & recovery">
        <div className="text-sm text-neutral-400">
          Check that every import's numbers reconcile, undo a single import, or back up your ledger.
        </div>
        <button
          onClick={() => setOpen(true)}
          className="mt-3 rounded-lg bg-neutral-800 px-3 py-2 text-sm font-medium text-neutral-200 hover:bg-neutral-700"
        >
          Open
        </button>
      </Panel>
    );
  }

  return (
    <Panel
      title="Data health & recovery"
      action={
        <div className="flex items-center gap-2">
          <button onClick={() => void backup()} disabled={busy}
            className="rounded-lg border border-neutral-700 px-2.5 py-1 text-xs font-medium text-neutral-300 hover:bg-neutral-800 disabled:opacity-50">
            Back up now
          </button>
          <button onClick={() => void loadAudit()} disabled={loading}
            className="rounded-lg border border-neutral-700 px-2.5 py-1 text-xs font-medium text-neutral-300 hover:bg-neutral-800 disabled:opacity-50">
            {loading ? "Checking…" : "↻ Recheck"}
          </button>
        </div>
      }
    >
      {msg && <div className="mb-3 rounded-lg border border-emerald-900 bg-emerald-950/40 px-3 py-2 text-sm text-emerald-300">{msg}</div>}
      {err && <div className="mb-3 rounded-lg border border-rose-900 bg-rose-950/50 px-3 py-2 text-sm text-rose-300">{err}</div>}

      {/* Health summary */}
      {audit && (
        <div className={`mb-3 rounded-lg border px-3 py-2 text-sm ${
          audit.status === "ok"
            ? "border-emerald-900 bg-emerald-950/30 text-emerald-300"
            : "border-amber-900 bg-amber-950/40 text-amber-300"
        }`}>
          {audit.status === "ok"
            ? `✓ All ${audit.perImport.length} import(s) reconcile · ${audit.totalTxns} transactions.`
            : `⚠ Something needs a look - ${audit.stuckImports.length} stuck, ${audit.perImport.filter((p) => p.mismatch).length} count mismatch.`}
        </div>
      )}

      {/* Pending undo confirmation */}
      {pending && (
        <div className="mb-3 rounded-lg border border-amber-800 bg-amber-950/30 px-3 py-3 text-sm">
          <div className="font-medium text-amber-200">Undo this import?</div>
          <div className="mt-1 text-xs text-amber-300/80">
            Removes <strong>{pending.matchedCount}</strong> transaction(s)
            {pending.bills > 0 && <> and <strong>{pending.bills}</strong> bill(s)</>} from{" "}
            <strong>{pending.filename || pending.documentId.slice(0, 10)}</strong>. A backup is taken first, and the
            file can be re-imported afterwards.
          </div>
          {pending.warnings.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-xs text-amber-300/90">
              {pending.warnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          )}
          {pending.sampleTxns.length > 0 && (
            <div className="mt-2 max-h-28 overflow-y-auto rounded border border-amber-900/50 text-xs">
              {pending.sampleTxns.map((t) => (
                <div key={t.id} className="flex justify-between gap-2 px-2 py-1 text-neutral-300">
                  <span className="tabular-nums text-neutral-500">{(t.date || "").slice(0, 10)}</span>
                  <span className="flex-1 truncate">{t.description}</span>
                  <span className="tabular-nums">{signedMoney(t.signedAmount)}</span>
                </div>
              ))}
            </div>
          )}
          <div className="mt-3 flex gap-2">
            <button onClick={() => void confirmUndo()} disabled={busy}
              className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-500 disabled:opacity-50">
              {busy ? "Working…" : `Yes, remove ${pending.matchedCount}`}
            </button>
            <button onClick={() => setPending(null)} disabled={busy}
              className="rounded-lg border border-neutral-700 px-3 py-1.5 text-xs font-medium text-neutral-300 hover:bg-neutral-800 disabled:opacity-50">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Per-import table */}
      {audit && audit.perImport.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-neutral-800">
          <table className="w-full text-left text-xs">
            <thead className="bg-neutral-900/60 text-neutral-500">
              <tr>
                <th className="px-2 py-1.5 font-medium">Import</th>
                <th className="px-2 py-1.5 font-medium">Status</th>
                <th className="px-2 py-1.5 text-right font-medium">Rows</th>
                <th className="px-2 py-1.5"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-800">
              {audit.perImport.map((p) => (
                <tr key={p.documentId} className={p.mismatch ? "bg-amber-950/20" : ""}>
                  <td className="max-w-[12rem] truncate px-2 py-1.5 text-neutral-300">
                    {p.filename || p.documentId.slice(0, 10)}
                    <span className="block text-neutral-600">{p.institution}</span>
                  </td>
                  <td className="px-2 py-1.5 text-neutral-400">{p.status}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    <span className={p.mismatch ? "text-amber-400" : "text-neutral-300"}>{p.liveTxnCount}</span>
                    {p.mismatch && <span className="text-neutral-600"> / {p.transactionsWritten}</span>}
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    {p.status !== "reverted" && (p.liveTxnCount > 0 || p.status === "importing") && (
                      <button onClick={() => void startUndo(p.documentId)} disabled={busy}
                        className="rounded border border-neutral-700 px-2 py-0.5 text-neutral-300 hover:border-rose-700 hover:text-rose-300 disabled:opacity-50">
                        Undo
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Backups + history */}
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <div className="mb-1 text-xs font-medium uppercase tracking-wider text-neutral-500">Backups</div>
          {snapshots.length === 0 ? (
            <div className="text-xs text-neutral-600">No backups yet.</div>
          ) : (
            <ul className="space-y-1 text-xs text-neutral-400">
              {[...snapshots].sort((a, b) => (b.snapshotId).localeCompare(a.snapshotId)).slice(0, 6).map((s) => (
                <li key={s.id} className="flex justify-between gap-2">
                  <span className="truncate">{s.reason} · {s.counts?.transactions ?? 0} txns</span>
                  <span className="shrink-0 text-neutral-600">{fmtTs(s.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <div className="mb-1 text-xs font-medium uppercase tracking-wider text-neutral-500">Recovery history</div>
          {log.length === 0 ? (
            <div className="text-xs text-neutral-600">No recovery actions yet.</div>
          ) : (
            <ul className="space-y-1 text-xs text-neutral-400">
              {[...log].sort((a, b) => (tsToDate(b.at)?.getTime() ?? 0) - (tsToDate(a.at)?.getTime() ?? 0)).slice(0, 6).map((e) => (
                <li key={e.id} className="flex justify-between gap-2">
                  <span className="truncate">{e.op.replace("_", " ")} · {e.effect?.deleted ?? 0} removed</span>
                  <span className="shrink-0 text-neutral-600">{fmtTs(e.at)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Panel>
  );
}

function fmtTs(ts: SnapshotManifest["createdAt"]): string {
  const d = tsToDate(ts);
  return d ? shortDate(d) : "-";
}
