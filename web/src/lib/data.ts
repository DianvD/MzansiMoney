import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  setDoc,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import type { Timestamp } from "firebase/firestore";
import { db, functions } from "../firebase";
import type { Bill, Goal, HomeLoanSettings, Holding, RecurringLists, Transaction, WatchItem } from "../types";
import type { DashboardLayout } from "./dashboardLayout";

/** Live stream of a user's transactions, newest first. */
export function subscribeTransactions(
  uid: string,
  onData: (txns: Transaction[]) => void,
  onError: (err: Error) => void,
): () => void {
  const q = query(
    collection(db, "users", uid, "transactions"),
    orderBy("date", "desc"),
  );
  return onSnapshot(
    q,
    (snap) => {
      const txns = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<Transaction, "id">),
      }));
      onData(txns);
    },
    onError,
  );
}

export type ImportStatus = "imported" | "duplicate" | "needs_review" | "preview";

/** The column roles the parser maps. A file uses either `amount` (a single signed
 * column) or `debit`+`credit`; the others are optional. */
export type ColumnRole = "date" | "description" | "amount" | "debit" | "credit" | "balance";
export type ColumnMapping = Partial<Record<ColumnRole, number>>;

/** What the backend learned/reused for this file's layout (attached to a successful
 * import). `state` tells the UI how to phrase it. */
export interface ProfileSummary {
  state: "reused" | "learned" | "corrected";
  fingerprint: string;
  mapping: ColumnMapping;
  confidence: number;
  source: "auto" | "confirmed";
  label?: string;
  hasHeader?: boolean;
}

/** A few parsed rows the backend returns so the user can eyeball a layout. */
export interface PreviewSample {
  date: string;
  description: string;
  amount: number;
  balance: number | null;
}

export interface ImportResult {
  status: ImportStatus;
  institution?: string;
  imported: number;
  duplicatesInFile?: number;
  integrityOk?: boolean | null;
  integrityDetail?: string;
  reason?: string;
  existingId?: string;
  profile?: ProfileSummary | null;
  // Present when status === "preview" (how we'd read the file):
  fingerprint?: string;
  hasHeader?: boolean;
  confidence?: number;
  known?: boolean;
  label?: string;
  columns?: string[];
  ncols?: number;
  mapping?: ColumnMapping;
  sample?: PreviewSample[];
  autoOk?: boolean;
}

interface ImportArgs {
  csvText: string;
  institution?: string;
  account?: string;
  /** Account number, when known - keys the accountId so re-imports reconcile. */
  accountNumber?: string | null;
  sourceDocument?: string;
  force?: boolean;
  /** Detect + return how we'd read the file without writing anything. */
  previewOnly?: boolean;
  /** Proceed past the "please check the columns" gate (user accepted the layout). */
  confirm?: boolean;
  /** An explicit column mapping to apply and remember (a user correction). */
  profileMapping?: ColumnMapping;
  /** Optional human label to remember this layout by (e.g. "Capitec"). */
  profileLabel?: string;
}

const callImport = httpsCallable<ImportArgs, ImportResult>(functions, "import_csv");

export async function importCsv(args: ImportArgs): Promise<ImportResult> {
  const res = await callImport(args);
  return res.data;
}

// ---- documents (PDF) ----------------------------------------------------

export type DocStatus =
  | "imported"
  | "recorded"
  | "duplicate"
  | "needs_review"
  | "needs_password";

export interface DocImportResult {
  status: DocStatus | "preview";
  kind?: "bill" | "transactions" | "statement_txns" | "statement" | "foreign_invoice" | "statement_unparsed";
  institution?: string;
  docType?: string;
  docNumber?: string;
  amount?: number;
  imported?: number;
  integrityOk?: boolean | null;
  integrityDetail?: string;
  duplicatesInFile?: number;
  reason?: string;
  existingId?: string;
  profile?: ProfileSummary | null;
  // Present when status === "preview" (statement column confirm) - same shape as
  // the CSV preview, so the column-mapper component is reused as-is.
  fingerprint?: string;
  hasHeader?: boolean;
  confidence?: number;
  known?: boolean;
  label?: string;
  columns?: string[];
  ncols?: number;
  mapping?: ColumnMapping;
  sample?: PreviewSample[];
  autoOk?: boolean;
}

interface DocImportArgs {
  pdfBase64: string;
  filename: string;
  password?: string;
  force?: boolean;
  account?: string;
  accountNumber?: string | null;
  previewOnly?: boolean;
  confirm?: boolean;
  profileMapping?: ColumnMapping;
  profileLabel?: string;
}

const callImportDoc = httpsCallable<DocImportArgs, DocImportResult>(
  functions,
  "import_document",
);

export async function importDocument(args: DocImportArgs): Promise<DocImportResult> {
  const res = await callImportDoc(args);
  return res.data;
}

/** Read a File as base64 (no data: prefix), for the document import callable. */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.readAsDataURL(file);
  });
}

// ---- manual entry -------------------------------------------------------

interface AddTxnArgs {
  date: string; // YYYY-MM-DD
  description: string;
  amount: number;
  direction: "debit" | "credit";
  account?: string;
  category?: string;
}

const callAddTxn = httpsCallable<AddTxnArgs, { status: string; id: string; category: string }>(
  functions,
  "add_transaction",
);

export async function addTransaction(args: AddTxnArgs) {
  return (await callAddTxn(args)).data;
}

const callSetCategory = httpsCallable<
  { transactionId: string; category: string; applyToMerchant: boolean },
  { status: string; updated: number; learned: boolean }
>(functions, "set_category");

export async function setCategory(args: {
  transactionId: string;
  category: string;
  applyToMerchant: boolean;
}) {
  return (await callSetCategory(args)).data;
}

const callDeleteTxn = httpsCallable<{ transactionId: string }, { status: string }>(
  functions,
  "delete_transaction",
);

export async function deleteTransaction(transactionId: string) {
  return (await callDeleteTxn({ transactionId })).data;
}

const callSetStatementPw = httpsCallable<{ password: string }, { status: string }>(
  functions,
  "set_statement_password",
);

export async function setStatementPassword(password: string) {
  return (await callSetStatementPw({ password })).data;
}

// ---- holdings (assets/liabilities) & goals: client-owned, direct writes -----

function subscribeCollection<T>(
  uid: string,
  name: string,
  onData: (items: T[]) => void,
  onError: (err: Error) => void,
): () => void {
  return onSnapshot(
    query(collection(db, "users", uid, name)),
    (snap) => onData(snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) }) as T)),
    onError,
  );
}

export const subscribeHoldings = (uid: string, cb: (h: Holding[]) => void, err: (e: Error) => void) =>
  subscribeCollection<Holding>(uid, "holdings", cb, err);

export const subscribeGoals = (uid: string, cb: (g: Goal[]) => void, err: (e: Error) => void) =>
  subscribeCollection<Goal>(uid, "goals", cb, err);

export const addHolding = (uid: string, h: Omit<Holding, "id">) =>
  addDoc(collection(db, "users", uid, "holdings"), h);
export const saveHolding = (uid: string, id: string, h: Partial<Holding>) =>
  setDoc(doc(db, "users", uid, "holdings", id), h, { merge: true });
export const deleteHolding = (uid: string, id: string) =>
  deleteDoc(doc(db, "users", uid, "holdings", id));

export const addGoal = (uid: string, g: Omit<Goal, "id">) =>
  addDoc(collection(db, "users", uid, "goals"), g);
export const saveGoal = (uid: string, id: string, g: Partial<Goal>) =>
  setDoc(doc(db, "users", uid, "goals", id), g, { merge: true });
export const deleteGoal = (uid: string, id: string) =>
  deleteDoc(doc(db, "users", uid, "goals", id));

// ---- home-loan settings: client-owned, direct read/write -------------------

/** Live stream of the user's Home Loan settings (anchor balance). Emits null
 * until the user has set one. */
export function subscribeHomeLoanSettings(
  uid: string,
  onData: (s: HomeLoanSettings | null) => void,
  onError: (err: Error) => void,
): () => void {
  return onSnapshot(
    doc(db, "users", uid, "settings", "homeLoan"),
    (snap) => onData(snap.exists() ? (snap.data() as HomeLoanSettings) : null),
    onError,
  );
}

export const saveHomeLoanSettings = (uid: string, s: HomeLoanSettings) =>
  setDoc(doc(db, "users", uid, "settings", "homeLoan"), s, { merge: true });

// ---- dashboard watchlist (pinned payments): client-owned ------------------

export function subscribeWatchlist(
  uid: string,
  onData: (items: WatchItem[]) => void,
  onError: (err: Error) => void,
): () => void {
  return onSnapshot(
    doc(db, "users", uid, "settings", "watchlist"),
    (snap) => onData(((snap.data()?.items as WatchItem[]) ?? [])),
    onError,
  );
}

export const saveWatchlist = (uid: string, items: WatchItem[]) =>
  setDoc(doc(db, "users", uid, "settings", "watchlist"), { items }, { merge: true });

// ---- recurring classification lists: client-owned ---------------------------

export function subscribeRecurringLists(
  uid: string,
  onData: (lists: RecurringLists) => void,
  onError: (err: Error) => void,
): () => void {
  return onSnapshot(
    doc(db, "users", uid, "settings", "recurring"),
    (snap) => {
      const d = snap.data() as Partial<RecurringLists> | undefined;
      onData({
        important: d?.important ?? [],
        debitOrders: d?.debitOrders ?? [],
        subscriptions: d?.subscriptions ?? [],
        transfers: d?.transfers ?? [],
      });
    },
    onError,
  );
}

export const saveRecurringLists = (uid: string, lists: RecurringLists) =>
  setDoc(doc(db, "users", uid, "settings", "recurring"), lists, { merge: true });

// ---- UI prefs (nav order): client-owned ------------------------------------

export function subscribeNavOrder(
  uid: string,
  onData: (order: string[]) => void,
  onError: (err: Error) => void,
): () => void {
  return onSnapshot(
    doc(db, "users", uid, "settings", "ui"),
    (snap) => onData((snap.data()?.navOrder as string[]) ?? []),
    onError,
  );
}

export const saveNavOrder = (uid: string, navOrder: string[]) =>
  setDoc(doc(db, "users", uid, "settings", "ui"), { navOrder }, { merge: true });

// ---- multi-account prefs (selected/default account, label overrides) --------

export interface AccountPrefs {
  /** Which account the app is currently viewing: "all" or an accountId. */
  selectedAccountId: string;
  /** Where imports/bills land by default (an accountId), zero-friction. */
  defaultAccountId: string | null;
  /** Per-account custom display labels (accountId -> label). */
  labels: Record<string, string>;
}

export function subscribeAccountPrefs(
  uid: string,
  onData: (prefs: AccountPrefs) => void,
  onError: (err: Error) => void,
): () => void {
  return onSnapshot(
    doc(db, "users", uid, "settings", "ui"),
    (snap) => {
      const d = snap.data() ?? {};
      onData({
        selectedAccountId: (d.selectedAccountId as string) ?? "all",
        defaultAccountId: (d.defaultAccountId as string) ?? null,
        labels: (d.accountLabels as Record<string, string>) ?? {},
      });
    },
    onError,
  );
}

export const saveSelectedAccount = (uid: string, selectedAccountId: string) =>
  setDoc(doc(db, "users", uid, "settings", "ui"), { selectedAccountId }, { merge: true });

export const saveDefaultAccount = (uid: string, defaultAccountId: string) =>
  setDoc(doc(db, "users", uid, "settings", "ui"), { defaultAccountId }, { merge: true });

export const saveAccountLabel = (uid: string, accountId: string, label: string) =>
  setDoc(
    doc(db, "users", uid, "settings", "ui"),
    { accountLabels: { [accountId]: label } },
    { merge: true },
  );

// ---- branding / theming (skin, app name, Gmail label): client-owned ---------

export interface BrandingDoc {
  skinId?: string;        // a preset id, or "custom"
  name?: string;          // custom app name
  emoji?: string;         // custom logo mark
  paletteId?: string;     // custom accent palette
  gmailLabel?: string;    // the Gmail label the intake script reads
}

export function subscribeBranding(
  uid: string,
  onData: (b: BrandingDoc | null) => void,
  onError: (err: Error) => void,
): () => void {
  return onSnapshot(
    doc(db, "users", uid, "settings", "branding"),
    (snap) => onData(snap.exists() ? (snap.data() as BrandingDoc) : null),
    onError,
  );
}

export const saveBranding = (uid: string, b: BrandingDoc) =>
  setDoc(doc(db, "users", uid, "settings", "branding"), b, { merge: true });

// ---- dashboard layout (customizable cards): client-owned --------------------

export function subscribeDashboardLayout(
  uid: string,
  onData: (layout: Partial<DashboardLayout> | null) => void,
  onError: (err: Error) => void,
): () => void {
  return onSnapshot(
    doc(db, "users", uid, "settings", "ui"),
    (snap) => onData((snap.data()?.dashboardLayout as Partial<DashboardLayout>) ?? null),
    onError,
  );
}

export const saveDashboardLayout = (uid: string, dashboardLayout: DashboardLayout) =>
  setDoc(doc(db, "users", uid, "settings", "ui"), { dashboardLayout }, { merge: true });

// ---- recovery (Phase 1): undo an import, back up, health audit --------------

export interface AuditImport {
  documentId: string;
  filename?: string;
  institution?: string;
  account?: string;
  status?: string;
  transactionsWritten?: number | null;
  liveTxnCount: number;
  mismatch: boolean;
}
export interface AuditResult {
  status: "ok" | "warnings";
  perImport: AuditImport[];
  stuckImports: { documentId: string; filename?: string; status?: string }[];
  totalTxns: number;
}
const callAudit = httpsCallable<Record<string, never>, AuditResult>(functions, "audit_integrity");
export async function auditIntegrity(): Promise<AuditResult> {
  return (await callAudit({})).data;
}

export interface RevertPreview {
  status: "preview";
  documentId: string;
  filename?: string;
  ledgerStatus?: string;
  matchedCount: number;
  byScheme: Record<string, number>;
  bills: number;
  sampleTxns: { id: string; date: string; description: string; signedAmount: number }[];
  confirmToken: string;
  warnings: string[];
}
export interface RevertResult {
  status: "reverted";
  documentId: string;
  deleted: number;
  billsDeleted: number;
  preOpSnapshotId: string | null;
  recoveryLogId: string;
}
interface RevertArgs {
  documentId: string;
  dryRun?: boolean;
  confirmToken?: string;
  reason?: string;
  revertBills?: boolean;
}
const callRevert = httpsCallable<RevertArgs, RevertPreview | RevertResult>(functions, "revert_import");
export async function revertImport(args: RevertArgs): Promise<RevertPreview | RevertResult> {
  return (await callRevert(args)).data;
}

export interface ExportResult {
  status: "exported";
  snapshotId: string;
  counts: Record<string, number>;
  sizeBytes: number;
  createdAt: string;
}
const callExport = httpsCallable<{ reason?: string }, ExportResult>(functions, "export_ledger");
export async function exportLedger(reason = "manual"): Promise<ExportResult> {
  return (await callExport({ reason })).data;
}

export interface SnapshotManifest {
  id: string;
  snapshotId: string;
  reason: string;
  counts: Record<string, number>;
  sizeBytes: number;
  createdAt?: Timestamp;
}
export function subscribeSnapshots(
  uid: string,
  onData: (snaps: SnapshotManifest[]) => void,
  onError: (err: Error) => void,
): () => void {
  return onSnapshot(
    query(collection(db, "users", uid, "snapshots")),
    (snap) => onData(snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) }) as SnapshotManifest)),
    onError,
  );
}

export interface RecoveryLogEntry {
  id: string;
  op: string;
  at?: Timestamp;
  reason?: string;
  effect?: Record<string, number>;
  preOpSnapshotId?: string | null;
}
export function subscribeRecoveryLog(
  uid: string,
  onData: (entries: RecoveryLogEntry[]) => void,
  onError: (err: Error) => void,
): () => void {
  return onSnapshot(
    query(collection(db, "users", uid, "recoveryLog")),
    (snap) => onData(snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) }) as RecoveryLogEntry)),
    onError,
  );
}

export function subscribeBills(
  uid: string,
  onData: (bills: Bill[]) => void,
  onError: (err: Error) => void,
): () => void {
  // No orderBy: a Firestore orderBy would risk excluding bills whose dueDate is
  // null (no due date). Sort client-side, putting undated bills last.
  const q = query(collection(db, "users", uid, "bills"));
  return onSnapshot(
    q,
    (snap) => {
      const bills = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Bill, "id">) }));
      bills.sort((a, b) => {
        const da = a.dueDate?.toMillis() ?? Number.POSITIVE_INFINITY;
        const dbb = b.dueDate?.toMillis() ?? Number.POSITIVE_INFINITY;
        return da - dbb;
      });
      onData(bills);
    },
    onError,
  );
}
