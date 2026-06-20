import { useState, useRef } from "react";
import Panel from "../components/Panel";
import ManualEntry from "../components/ManualEntry";
import RecoveryPanel from "../components/RecoveryPanel";
import {
  fileToBase64,
  importCsv,
  importDocument,
  type ColumnMapping,
  type ColumnRole,
  type DocImportResult,
  type ImportResult,
  type PreviewSample,
} from "../lib/data";
import { money, signedMoney } from "../lib/format";
import { isSpreadsheet, xlsxToCsv } from "../lib/xlsx";
import { splitCsv } from "../lib/csvchunk";
import type { Account } from "../lib/accounts";

const INSTITUTIONS = [
  { slug: "generic", label: "Auto-detect (generic)" },
  { slug: "nedbank", label: "Nedbank" },
  { slug: "homeloan", label: "Nedbank Home Loan" },
];

// The column roles a user can assign in the mapper. A file uses either a single
// signed Amount column OR separate Money out/Money in columns.
const ROLE_FIELDS: { role: ColumnRole; label: string; hint?: string }[] = [
  { role: "date", label: "Date" },
  { role: "description", label: "Description" },
  { role: "amount", label: "Amount (signed)", hint: "if one column holds + / −" },
  { role: "debit", label: "Money out", hint: "if split into two columns" },
  { role: "credit", label: "Money in" },
  { role: "balance", label: "Balance", hint: "optional, improves accuracy" },
];

type Outcome =
  | { kind: "csv"; file: string; res: ImportResult }
  | { kind: "doc"; file: string; res: DocImportResult };

/** The bits of a preview the column-mapper needs - shared by CSV and PDF. */
interface PreviewRes {
  columns?: string[];
  mapping?: ColumnMapping;
  sample?: PreviewSample[];
  hasHeader?: boolean;
  known?: boolean;
  label?: string;
}

interface PreviewState {
  kind: "csv" | "doc";
  file: string;
  csvText?: string;
  pdfBase64?: string;
  res: PreviewRes;
}

interface Resolve {
  force?: boolean;
  confirm?: boolean;
  profileMapping?: ColumnMapping;
  profileLabel?: string;
}

export default function Import({ accounts, defaultAccountId }: { accounts: Account[]; defaultAccountId: string | null }) {
  const [institution, setInstitution] = useState("generic");
  const [accountChoice, setAccountChoice] = useState<string>(""); // an accountId, or "new"
  const [newAccountLabel, setNewAccountLabel] = useState("Cheque");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [dragging, setDragging] = useState(false);
  const [password, setPassword] = useState("");
  const [progress, setProgress] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const lastCsv = useRef<{ csvText: string; file: string } | null>(null);
  const lastDoc = useRef<{ pdfBase64: string; file: string } | null>(null);

  // Which account a CSV import lands in. Defaults to your default account (zero
  // friction); pick another or create a new one. Home-loan imports are fixed.
  const effectiveChoice =
    accountChoice ||
    (defaultAccountId && accounts.some((a) => a.accountId === defaultAccountId) ? defaultAccountId : "new");

  function resolveAccount(): { account: string; accountNumber: string | null } {
    if (institution === "homeloan") return { account: "Home Loan", accountNumber: null };
    if (effectiveChoice === "new") return { account: newAccountLabel.trim() || "Cheque", accountNumber: null };
    const a = accounts.find((x) => x.accountId === effectiveChoice);
    return a ? { account: a.account || a.label, accountNumber: a.accountNumber } : { account: "Cheque", accountNumber: null };
  }

  function isPdf(file: File) {
    return file.type === "application/pdf" || /\.pdf$/i.test(file.name);
  }

  async function runCsv(csvText: string, file: string, opts: Resolve = {}) {
    const acct = resolveAccount();
    const chunks = splitCsv(csvText);
    const single = chunks.length === 1;
    // The first call decides whether we can proceed automatically. We DON'T force
    // the first chunk, so an unknown/uncertain layout can surface a column preview
    // instead of silently guessing; later chunks are forced (overlap is handled by
    // the balance-aware dedup) and reuse the now-known layout.
    const first = await importCsv({
      csvText: chunks[0],
      institution,
      account: acct.account,
      accountNumber: acct.accountNumber,
      sourceDocument: single ? file : `${file} [1/${chunks.length}]`,
      force: opts.force ?? false,
      confirm: opts.confirm,
      profileMapping: opts.profileMapping,
      profileLabel: opts.profileLabel,
    });

    if (first.status === "preview") {
      setPreview({ kind: "csv", file, csvText, res: first });
      return;
    }
    if (single) {
      setOutcome({ kind: "csv", file, res: first });
      return;
    }

    // Chunked: import the rest with the same (now-known) layout.
    let imported = first.status === "imported" ? first.imported : 0;
    let dupes = first.duplicatesInFile || 0;
    let inst = first.institution || "";
    try {
      for (let i = 1; i < chunks.length; i++) {
        setProgress(`Importing part ${i + 1} of ${chunks.length}…`);
        const res = await importCsv({
          csvText: chunks[i],
          institution,
          account: acct.account,
          accountNumber: acct.accountNumber,
          sourceDocument: `${file} [${i + 1}/${chunks.length}]`,
          force: true,
          confirm: true,
          profileMapping: opts.profileMapping,
        });
        if (res.status === "imported") {
          imported += res.imported;
          dupes += res.duplicatesInFile || 0;
          inst = res.institution || inst;
        }
      }
    } finally {
      setProgress(null);
    }
    setOutcome({
      kind: "csv",
      file,
      res: { status: "imported", imported, institution: inst, duplicatesInFile: dupes, profile: first.profile },
    });
  }

  async function runDoc(
    pdfBase64: string,
    file: string,
    opts: { password?: string; force?: boolean; confirm?: boolean; profileMapping?: ColumnMapping; profileLabel?: string } = {},
  ) {
    const acct = resolveAccount();
    const res = await importDocument({
      pdfBase64, filename: file, account: acct.account, accountNumber: acct.accountNumber, ...opts,
    });
    if (res.status === "preview") {
      setPreview({ kind: "doc", file, pdfBase64, res });
      return;
    }
    setOutcome({ kind: "doc", file, res });
    if (res.status !== "needs_password") setPassword("");
  }

  async function handleFile(file: File) {
    setBusy(true);
    setError(null);
    setOutcome(null);
    setPreview(null);
    setPassword("");
    try {
      if (isPdf(file)) {
        const b64 = await fileToBase64(file);
        lastDoc.current = { pdfBase64: b64, file: file.name };
        await runDoc(b64, file.name);
      } else {
        const text = isSpreadsheet(file) ? await xlsxToCsv(file) : await file.text();
        lastCsv.current = { csvText: text, file: file.name };
        await runCsv(text, file.name);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed.");
    } finally {
      setBusy(false);
    }
  }

  async function retry(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed.");
    } finally {
      setBusy(false);
    }
  }

  // Open the column editor on demand - e.g. the import looked confident but read a
  // column wrong, so the user wants to fix and re-import. Works for CSV and PDF.
  async function openColumnEditor() {
    const acct = resolveAccount();
    if (lastCsv.current) {
      const { csvText, file } = lastCsv.current;
      await retry(async () => {
        const res = await importCsv({
          csvText, institution, account: acct.account, accountNumber: acct.accountNumber,
          sourceDocument: file, previewOnly: true,
        });
        if (res.status === "preview") setPreview({ kind: "csv", file, csvText, res });
      });
    } else if (lastDoc.current) {
      const { pdfBase64, file } = lastDoc.current;
      await retry(async () => {
        const res = await importDocument({
          pdfBase64, filename: file, account: acct.account, accountNumber: acct.accountNumber, previewOnly: true,
        });
        if (res.status === "preview") setPreview({ kind: "doc", file, pdfBase64, res });
      });
    }
  }

  // Re-run the preview with a candidate mapping so the sample table updates live.
  async function refreshSample(mapping: ColumnMapping): Promise<PreviewSample[]> {
    if (!preview) return [];
    const acct = resolveAccount();
    if (preview.kind === "doc") {
      const res = await importDocument({
        pdfBase64: preview.pdfBase64!, filename: preview.file,
        account: acct.account, accountNumber: acct.accountNumber, previewOnly: true, profileMapping: mapping,
      });
      return res.sample ?? [];
    }
    const res = await importCsv({
      csvText: preview.csvText!, institution, account: acct.account, accountNumber: acct.accountNumber,
      sourceDocument: preview.file, previewOnly: true, profileMapping: mapping,
    });
    return res.sample ?? [];
  }

  function importWithColumns(mapping: ColumnMapping, label: string) {
    if (!preview) return;
    const { kind, file, csvText, pdfBase64 } = preview;
    setPreview(null);
    if (kind === "doc") {
      void retry(() => runDoc(pdfBase64!, file, { confirm: true, profileMapping: mapping, profileLabel: label }));
    } else {
      void retry(() => runCsv(csvText!, file, { confirm: true, profileMapping: mapping, profileLabel: label }));
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Panel title="Import transactions & documents">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="text-sm">
            <span className="mb-1 block text-neutral-400">Institution (CSV)</span>
            <select
              value={institution}
              onChange={(e) => setInstitution(e.target.value)}
              className="w-full rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-neutral-200 outline-none focus:border-indigo-500"
            >
              {INSTITUTIONS.map((i) => (
                <option key={i.slug} value={i.slug}>{i.label}</option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-neutral-400">Account (CSV)</span>
            {institution === "homeloan" ? (
              <input value="Home Loan" disabled
                className="w-full rounded-lg border border-neutral-700 bg-neutral-800/50 px-3 py-2 text-neutral-400 outline-none" />
            ) : (
              <select
                value={effectiveChoice}
                onChange={(e) => setAccountChoice(e.target.value)}
                className="w-full rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-neutral-200 outline-none focus:border-indigo-500"
              >
                {accounts.map((a) => (
                  <option key={a.accountId} value={a.accountId}>
                    {a.label}{a.accountId === defaultAccountId ? " (default)" : ""}
                  </option>
                ))}
                <option value="new">+ New account…</option>
              </select>
            )}
          </label>
        </div>

        {institution !== "homeloan" && effectiveChoice === "new" && (
          <label className="mt-3 block text-sm">
            <span className="mb-1 block text-neutral-400">New account name</span>
            <input
              value={newAccountLabel}
              onChange={(e) => setNewAccountLabel(e.target.value)}
              placeholder="e.g. Capitec · Main"
              className="w-full rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-neutral-200 outline-none focus:border-indigo-500"
            />
          </label>
        )}

        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const file = e.dataTransfer.files?.[0];
            if (file) void handleFile(file);
          }}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              inputRef.current?.click();
            }
          }}
          role="button"
          tabIndex={0}
          aria-label="Import a CSV or PDF file: drop here or activate to choose a file"
          className={`mt-5 flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-12 text-center transition focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
            dragging ? "border-indigo-500 bg-indigo-500/10" : "border-neutral-700 hover:border-neutral-600"
          }`}
        >
          <div className="text-sm font-medium text-neutral-300">
            {busy ? (progress ?? "Working…") : "Drop a bank CSV / Excel, or a PDF (invoice / statement)"}
          </div>
          <div className="mt-1 text-xs text-neutral-500">
            CSV & Excel → transactions · invoice PDF → bill. Everything is deduplicated.
          </div>
          <input
            ref={inputRef}
            type="file"
            accept=".csv,text/csv,.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,.pdf,application/pdf"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFile(file);
              e.target.value = "";
            }}
          />
        </div>

        {error && (
          <div className="mt-4 rounded-lg border border-rose-900 bg-rose-950/50 px-4 py-3 text-sm text-rose-300">
            {error}
          </div>
        )}

        {preview && (
          <ColumnMapper
            key={preview.file}
            preview={preview}
            busy={busy}
            onCancel={() => setPreview(null)}
            onRefresh={refreshSample}
            onImport={importWithColumns}
          />
        )}

        {!preview && outcome && <OutcomeView
          outcome={outcome}
          busy={busy}
          password={password}
          setPassword={setPassword}
          onForceCsv={() => lastCsv.current && retry(() => runCsv(lastCsv.current!.csvText, lastCsv.current!.file, { force: true, confirm: true }))}
          onForceDoc={() => lastDoc.current && retry(() => runDoc(lastDoc.current!.pdfBase64, lastDoc.current!.file, { force: true, confirm: true }))}
          onUnlock={() => lastDoc.current && retry(() => runDoc(lastDoc.current!.pdfBase64, lastDoc.current!.file, { password }))}
          onFixColumns={openColumnEditor}
        />}
      </Panel>

      <ManualEntry />

      <RecoveryPanel />
    </div>
  );
}

function box(color: string) {
  return `mt-4 rounded-lg border px-4 py-3 text-sm ${color}`;
}

/** Lets the user confirm/fix which column is which before importing an unfamiliar
 * layout, then remembers the choice for next time. */
function ColumnMapper({
  preview,
  busy,
  onCancel,
  onRefresh,
  onImport,
}: {
  preview: PreviewState;
  busy: boolean;
  onCancel: () => void;
  onRefresh: (mapping: ColumnMapping) => Promise<PreviewSample[]>;
  onImport: (mapping: ColumnMapping, label: string) => void;
}) {
  const res = preview.res;
  const columns = res.columns ?? [];
  const [mapping, setMapping] = useState<ColumnMapping>({ ...(res.mapping ?? {}) });
  const [label, setLabel] = useState(res.label ?? "");
  const [sample, setSample] = useState<PreviewSample[]>(res.sample ?? []);
  const [refreshing, setRefreshing] = useState(false);

  function setRole(role: ColumnRole, value: string) {
    setMapping((m) => {
      const next = { ...m };
      if (value === "") delete next[role];
      else next[role] = Number(value);
      return next;
    });
  }

  async function refresh() {
    setRefreshing(true);
    try {
      setSample(await onRefresh(mapping));
    } finally {
      setRefreshing(false);
    }
  }

  const hasDate = mapping.date != null;
  const hasMoney = mapping.amount != null || mapping.debit != null || mapping.credit != null;
  const canImport = hasDate && hasMoney && !busy;

  return (
    <div className={box("border-indigo-900 bg-indigo-950/30 text-indigo-100")}>
      <div className="font-medium text-indigo-200">
        {res.known ? "Check this layout" : "New layout - check the columns"}
      </div>
      <div className="mt-1 text-xs text-indigo-300/80">
        {res.hasHeader
          ? "I matched these columns by their headings. Fix any that are wrong - I'll remember it for next time."
          : "This file has no column headings, so I guessed by position. Confirm or fix the columns - I'll remember it."}
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {ROLE_FIELDS.map(({ role, label: rl, hint }) => (
          <label key={role} className="text-xs">
            <span className="mb-1 block text-indigo-300/80">
              {rl}{hint && <span className="text-indigo-400/50"> · {hint}</span>}
            </span>
            <select
              value={mapping[role] ?? ""}
              onChange={(e) => setRole(role, e.target.value)}
              className="w-full rounded-lg border border-indigo-800 bg-neutral-900 px-2.5 py-1.5 text-sm text-neutral-200 outline-none focus:border-indigo-500"
            >
              <option value="">(none)</option>
              {columns.map((c, i) => (
                <option key={i} value={i}>{c || `Column ${i + 1}`}</option>
              ))}
            </select>
          </label>
        ))}
      </div>

      <div className="mt-4">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-xs text-indigo-300/80">Preview ({sample.length} rows)</span>
          <button
            onClick={() => void refresh()}
            disabled={refreshing}
            className="text-xs font-medium text-indigo-300 hover:text-indigo-200 disabled:opacity-50"
          >
            {refreshing ? "Refreshing…" : "↻ Refresh preview"}
          </button>
        </div>
        <div className="overflow-x-auto rounded-lg border border-indigo-900/60">
          <table className="w-full text-left text-xs">
            <thead className="bg-indigo-950/60 text-indigo-300/70">
              <tr>
                <th className="px-2 py-1.5 font-medium">Date</th>
                <th className="px-2 py-1.5 font-medium">Description</th>
                <th className="px-2 py-1.5 text-right font-medium">Amount</th>
                <th className="px-2 py-1.5 text-right font-medium">Balance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-indigo-900/40">
              {sample.length === 0 ? (
                <tr><td colSpan={4} className="px-2 py-3 text-center text-indigo-300/50">No rows parsed - check the Date and Amount columns.</td></tr>
              ) : sample.map((r, i) => (
                <tr key={i} className="text-neutral-200">
                  <td className="whitespace-nowrap px-2 py-1.5 tabular-nums">{r.date}</td>
                  <td className="max-w-[14rem] truncate px-2 py-1.5">{r.description}</td>
                  <td className={`px-2 py-1.5 text-right tabular-nums ${r.amount < 0 ? "text-rose-300" : "text-emerald-300"}`}>{signedMoney(r.amount)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-neutral-400">{r.balance == null ? "-" : money(r.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-2">
        <label className="flex-1 text-xs">
          <span className="mb-1 block text-indigo-300/80">Name this layout (optional)</span>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. Capitec cheque"
            className="w-full rounded-lg border border-indigo-800 bg-neutral-900 px-2.5 py-1.5 text-sm text-neutral-200 outline-none focus:border-indigo-500"
          />
        </label>
        <button
          onClick={() => onImport(mapping, label)}
          disabled={!canImport}
          className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          Import with these columns
        </button>
        <button
          onClick={onCancel}
          disabled={busy}
          className="rounded-lg border border-indigo-800 px-3 py-2 text-sm font-medium text-indigo-200 hover:bg-indigo-900/40 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
      {!hasDate && <div className="mt-2 text-xs text-amber-300">Pick the Date column to continue.</div>}
      {hasDate && !hasMoney && <div className="mt-2 text-xs text-amber-300">Pick an Amount, or Money out / Money in columns.</div>}
    </div>
  );
}

function ProfileNote({ profile }: { profile: ImportResult["profile"] }) {
  if (!profile) return null;
  const text =
    profile.state === "reused" ? "Reused a saved layout"
    : profile.state === "corrected" ? "Saved your column fix - future imports use it"
    : "Learned this layout - future imports are automatic";
  return (
    <div className="mt-1 text-xs text-emerald-300/70">
      {text}{profile.label ? ` · “${profile.label}”` : ""}.
    </div>
  );
}

function OutcomeView(props: {
  outcome: Outcome;
  busy: boolean;
  password: string;
  setPassword: (v: string) => void;
  onForceCsv: () => void;
  onForceDoc: () => void;
  onUnlock: () => void;
  onFixColumns: () => void;
}) {
  const { outcome, busy, password, setPassword, onForceCsv, onForceDoc, onUnlock, onFixColumns } = props;

  if (outcome.res.status === "duplicate")
    return <div className={box("border-neutral-700 bg-neutral-800/50 text-neutral-300")}>
      Skipped - already imported. {outcome.res.reason}
    </div>;

  if (outcome.res.status === "needs_review")
    return <div className={box("border-amber-900 bg-amber-950/40 text-amber-300")}>
      <div>{outcome.res.reason}</div>
      <button disabled={busy} onClick={outcome.kind === "csv" ? onForceCsv : onForceDoc}
        className="mt-2 rounded-lg border border-amber-700 px-3 py-1.5 text-xs font-medium text-amber-200 hover:bg-amber-900/40 disabled:opacity-50">
        Import anyway
      </button>
    </div>;

  if (outcome.kind === "doc") {
    const res = outcome.res;
    if (res.status === "needs_password")
      return <div className={box("border-indigo-900 bg-indigo-950/40 text-indigo-200")}>
        <div>{res.reason}</div>
        <div className="mt-2 flex gap-2">
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
            placeholder="Password (e.g. account number)"
            className="flex-1 rounded-lg border border-indigo-800 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-200 outline-none focus:border-indigo-500" />
          <button disabled={busy || !password} onClick={onUnlock}
            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-50">
            Unlock & import
          </button>
        </div>
        <div className="mt-1 text-xs text-indigo-300/70">Sent once to unlock - never stored.</div>
      </div>;
    if (res.status === "recorded")
      return <div className={box("border-neutral-700 bg-neutral-800/50 text-neutral-300")}>
        Recorded <strong>{res.docType?.replace("_", " ")}</strong> from {res.institution}. {res.reason}
      </div>;
    if (res.status === "imported" && res.kind === "statement_txns")
      return <div className={box("border-emerald-900 bg-emerald-950/40 text-emerald-300")}>
        Imported <strong>{res.imported}</strong> transactions from the <strong>{res.institution}</strong> statement PDF.
        {!!res.duplicatesInFile && ` ${res.duplicatesInFile} duplicate row(s) skipped.`}
        <ProfileNote profile={res.profile} />
        {res.integrityOk === false && (
          <div className="mt-1 text-amber-400">⚠ Balance check failed: {res.integrityDetail}. Review this statement.</div>
        )}
        <button
          onClick={onFixColumns}
          disabled={busy}
          className="mt-2 block text-xs font-medium text-emerald-300/80 underline-offset-2 hover:text-emerald-200 hover:underline disabled:opacity-50"
        >
          Columns look wrong? Adjust them →
        </button>
      </div>;
    if (res.status === "imported")
      return <div className={box("border-emerald-900 bg-emerald-950/40 text-emerald-300")}>
        Added bill: <strong>{res.institution}</strong>
        {res.docNumber ? ` (${res.docNumber})` : ""} - {res.amount != null ? money(res.amount) : ""}.
      </div>;
    return null;
  }

  const res = outcome.res;
  if (res.status === "imported")
    return <div className={box("border-emerald-900 bg-emerald-950/40 text-emerald-300")}>
      Imported <strong>{res.imported}</strong> transactions from <strong>{outcome.file}</strong> via {res.institution}.
      {!!res.duplicatesInFile && ` ${res.duplicatesInFile} duplicate row(s) skipped.`}
      <ProfileNote profile={res.profile} />
      {res.integrityOk === false && (
        <div className="mt-1 text-amber-400">⚠ Balance check failed: {res.integrityDetail}. Review this statement.</div>
      )}
      <button
        onClick={onFixColumns}
        disabled={busy}
        className="mt-2 text-xs font-medium text-emerald-300/80 underline-offset-2 hover:text-emerald-200 hover:underline disabled:opacity-50"
      >
        Columns look wrong? Adjust them →
      </button>
    </div>;

  return null;
}
