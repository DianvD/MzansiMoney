import { useEffect, useMemo, useState } from "react";
import type { Bill, Transaction, WatchItem } from "../types";
import { useAuth } from "../auth";
import { computeMetrics } from "../lib/metrics";
import { billStatus, sumBills } from "../lib/bills";
import { computeWatchlist, type WatchResult } from "../lib/watchlist";
import { matchesAny } from "../lib/recurring";
import { moneyVibe } from "../lib/vibe";
import {
  subscribeWatchlist,
  saveWatchlist,
  subscribeRecurringLists,
  subscribeDashboardLayout,
  saveDashboardLayout,
} from "../lib/data";
import { reconcileLayout, type DashboardLayout } from "../lib/dashboardLayout";
import DashboardGrid from "../components/DashboardGrid";
import type { RecurringLists } from "../types";
import { money, shortDate, signedMoney, tsToDate } from "../lib/format";
import StatCard from "../components/StatCard";
import Panel from "../components/Panel";
import CategoryChart from "../components/CategoryChart";
import TransactionList from "../components/TransactionList";
import MerchantAvatar from "../components/MerchantAvatar";

interface Props {
  transactions: Transaction[];
  bills: Bill[];
  loading: boolean;
  billsLoading: boolean;
  hideAmounts: boolean;
  now: Date;
}

export default function Dashboard({ transactions, bills, loading, billsLoading, hideAmounts, now }: Props) {
  const { user } = useAuth();
  const [watchItems, setWatchItems] = useState<WatchItem[]>([]);
  useEffect(() => {
    if (!user) return;
    return subscribeWatchlist(user.uid, setWatchItems, () => {});
  }, [user]);
  const watch = useMemo(
    () => computeWatchlist(watchItems, bills, transactions, now),
    [watchItems, bills, transactions, now],
  );

  const [transfers, setTransfers] = useState<string[]>([]);
  useEffect(() => {
    if (!user) return;
    return subscribeRecurringLists(user.uid, (l: RecurringLists) => setTransfers(l.transfers), () => {});
  }, [user]);

  // Transfers between own accounts aren't spend/income - keep them out of the
  // month metrics (the balance still reflects the money moving).
  const m = useMemo(
    () => computeMetrics(transactions, now, (t) => matchesAny(t.merchant, transfers)),
    [transactions, now, transfers],
  );
  const unpaid = useMemo(() => bills.filter((b) => !b.paid), [bills]);
  const overdueCount = useMemo(
    () => bills.filter((b) => billStatus(b, now) === "overdue").length,
    [bills, now],
  );
  const unpaidTotal = sumBills(unpaid);
  const afterBills =
    m.currentBalance === null ? null : m.currentBalance - unpaidTotal;

  const mask = (v: string) => (hideAmounts ? "••••••" : v);

  // The vibe reacts to what's actually yours to spend (cash after bills), falling
  // back to the raw balance until bills load. Each tier has a pool of lines we
  // rotate through every few minutes (random start so it varies between visits).
  const vibeBasis = afterBills ?? m.currentBalance;
  const vibe = moneyVibe(vibeBasis, hideAmounts);
  const [vibeTick, setVibeTick] = useState(() => Math.floor(Math.random() * 997));
  useEffect(() => {
    const id = setInterval(() => setVibeTick((t) => t + 1), 4 * 60 * 1000);
    return () => clearInterval(id);
  }, []);
  const vibeLine = vibe.lines[vibeTick % vibe.lines.length];

  // Customizable card layout (order / width / hidden), persisted per user.
  const [layout, setLayout] = useState<DashboardLayout>(() => reconcileLayout(null));
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!user) return;
    return subscribeDashboardLayout(user.uid, (saved) => setLayout(reconcileLayout(saved)), () => {});
  }, [user]);
  function updateLayout(next: DashboardLayout) {
    setLayout(next);
    if (user) void saveDashboardLayout(user.uid, next);
  }

  function renderCard(id: string) {
    switch (id) {
      case "pinned":
        return <PinnedPayments results={watch} items={watchItems} uid={user?.uid} month={m.monthLabel} hideAmounts={hideAmounts} />;
      case "spending":
        return <StatCard label={`Spending · ${m.monthLabel}`} value={mask(money(m.spendThisMonth))} accent="negative" />;
      case "income":
        return <StatCard label={`Income · ${m.monthLabel}`} value={mask(money(m.incomeThisMonth))} accent="positive" />;
      case "net":
        return <StatCard label={`Net · ${m.monthLabel}`} value={mask(signedMoney(m.netThisMonth))} accent={m.netThisMonth >= 0 ? "positive" : "default"} />;
      case "categories":
        return (
          <Panel title={`Spending by category · ${m.monthLabel}`}>
            {hideAmounts ? (
              <div className="flex h-64 items-center justify-center text-sm text-neutral-600">Balances hidden</div>
            ) : (
              <CategoryChart data={m.categoryBreakdown} />
            )}
          </Panel>
        );
      case "recent":
        return (
          <Panel title="Recent transactions">
            <TransactionList transactions={transactions.slice(0, 7)} hideAmounts={hideAmounts} />
          </Panel>
        );
      case "bills":
        return (
          <Panel
            title="Upcoming bills"
            action={overdueCount > 0 ? (
              <span className="rounded-full bg-rose-950 px-2 py-0.5 text-xs font-medium text-rose-300">
                {overdueCount} overdue
              </span>
            ) : undefined}
          >
            {unpaid.length === 0 ? (
              <div className="py-6 text-center text-sm text-neutral-500">
                No bills due. Import an invoice PDF to track payables.
              </div>
            ) : (
              <ul className="divide-y divide-neutral-800">
                {unpaid.slice(0, 6).map((b) => {
                  const od = billStatus(b, now) === "overdue";
                  return (
                    <li key={b.id} className="flex items-center gap-4 py-3">
                      <MerchantAvatar merchant={b.institution} category={b.category} size={36} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-neutral-200">{b.institution}</div>
                        <div className="truncate text-xs text-neutral-500">
                          {b.category}
                          {(() => { const d = tsToDate(b.dueDate); return d ? ` · due ${shortDate(d)}` : " · no due date"; })()}
                        </div>
                      </div>
                      <div className={`shrink-0 text-sm font-semibold tabular-nums ${od ? "text-rose-400" : "text-neutral-200"}`}>
                        {mask(money(b.amount))}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
        );
      default:
        return null;
    }
  }

  if (loading) return <div className="py-20 text-center text-neutral-500">Loading…</div>;

  return (
    <div className="space-y-6">
      {/* Customize toggle - enters layout edit mode (drag / resize / hide cards). */}
      <div className="flex items-center justify-end">
        <button
          onClick={() => setEditing((v) => !v)}
          className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
            editing ? "bg-indigo-500/15 text-indigo-200" : "text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
          }`}
        >
          {editing ? "✓ Done" : "⚙ Customize"}
        </button>
      </div>

      {/* Balance hero - always pinned at the top, not part of the customizable grid. */}
      <div className={`overflow-hidden rounded-2xl border border-neutral-800 bg-gradient-to-br p-6 transition-colors ${vibe.gradient}`}>
        <div className="flex items-center justify-between">
          <div className="text-xs font-medium uppercase tracking-wider text-neutral-300/70">
            Current balance
          </div>
          <div className={`hidden text-xs font-semibold sm:block ${vibe.accent}`}>{vibeLine}</div>
        </div>
        <div className="mt-1.5 text-4xl font-semibold tabular-nums text-white">
          {mask(m.currentBalance === null ? "-" : money(m.currentBalance))}
        </div>
        {/* On small screens the vibe line sits under the number so it isn't cramped. */}
        <div className={`mt-1 text-sm font-medium sm:hidden ${vibe.accent}`}>{vibeLine}</div>
        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm text-neutral-400">
          <span>
            Cash after bills{" "}
            <span className={`font-medium ${afterBills !== null && afterBills < 0 ? "text-rose-300" : "text-neutral-100"}`}>
              {billsLoading ? "…" : mask(afterBills === null ? "-" : money(afterBills))}
            </span>
          </span>
          {unpaid.length > 0 && (
            <span>
              {unpaid.length} bill{unpaid.length > 1 ? "s" : ""} due{" "}
              <span className="font-medium text-neutral-100">{mask(money(unpaidTotal))}</span>
              {overdueCount > 0 && <span className="text-rose-400"> · {overdueCount} overdue</span>}
            </span>
          )}
        </div>
      </div>

      {editing && (
        <div className="rounded-xl border border-indigo-900/60 bg-indigo-950/20 px-4 py-2.5 text-xs text-indigo-300/80">
          Drag <span className="text-indigo-200">⠿</span> to reorder · tap the width chip ({"⅓ ½ ⅔ Full"}) to resize · <span className="text-indigo-200">✕</span> to hide. Changes save automatically.
        </div>
      )}

      <DashboardGrid layout={layout} editing={editing} onChange={updateLayout} renderCard={renderCard} />
    </div>
  );
}

function watchSubtitle(r: WatchResult, month: string): string {
  if (r.source === "none") return `not found yet · matches "${r.match}"`;
  if (r.source === "fixed") return `standing · ${r.note ?? "monthly"}`;
  if (r.source === "bill") return r.note ? `invoice · ${r.note}` : "invoice";
  // Transaction-sourced: just say where/when the amount came from - don't assume
  // it's a debit order (it may be a payment the owner makes by hand).
  return r.note ? `from transactions · ${r.note}` : `from transactions · ${month}`;
}

const wlInput =
  "rounded-lg border border-neutral-700 bg-neutral-800 px-2.5 py-1.5 text-sm text-neutral-200 outline-none focus:border-indigo-500";

/** The payments the owner pays by hand and re-checks each month (municipal, levy, car
 * insurance). Always visible with this month's amount, separate from the bills
 * total. Editable so the pinned set isn't hard-coded. */
function PinnedPayments({
  results,
  items,
  uid,
  month,
  hideAmounts,
}: {
  results: WatchResult[];
  items: WatchItem[];
  uid: string | undefined;
  month: string;
  hideAmounts: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState("");
  const [match, setMatch] = useState("");
  const mask = (v: string) => (hideAmounts ? "••••••" : v);

  const pinnedTotal = results.reduce((s, r) => s + (r.amount ?? 0), 0);

  async function add() {
    if (!uid || !label.trim() || !match.trim()) return;
    const id = `w_${label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
    await saveWatchlist(uid, [
      ...items.filter((i) => i.id !== id),
      { id, label: label.trim(), match: match.trim() },
    ]);
    setLabel(""); setMatch("");
  }
  async function remove(id: string) {
    if (!uid) return;
    await saveWatchlist(uid, items.filter((i) => i.id !== id));
  }

  return (
    <Panel
      title="Payments to check this month"
      action={
        <button
          onClick={() => setEditing((v) => !v)}
          className="text-xs font-medium text-indigo-300 hover:text-indigo-200"
        >
          {editing ? "Done" : "Edit"}
        </button>
      }
    >
      {results.length === 0 ? (
        <div className="py-4 text-sm text-neutral-500">
          Pin the payments you settle by hand (e.g. municipal, levy, car insurance) to
          see this month's amount at a glance. Tap <span className="text-indigo-300">Edit</span> to add one.
        </div>
      ) : (
        <ul className="divide-y divide-neutral-800">
          {results.map((r) => (
            <li key={r.id} className="flex items-center gap-3 py-2.5">
              <MerchantAvatar merchant={r.label} category="" size={34} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-neutral-200">{r.label}</div>
                <div className="truncate text-xs text-neutral-500">
                  {watchSubtitle(r, month)}
                </div>
              </div>
              <div className={`shrink-0 text-sm font-semibold tabular-nums ${r.amount == null ? "text-neutral-600" : "text-neutral-100"}`}>
                {r.amount == null ? "-" : mask(money(r.amount))}
              </div>
              {editing && (
                <button
                  onClick={() => void remove(r.id)}
                  className="shrink-0 text-neutral-600 hover:text-rose-400"
                  aria-label={`Remove ${r.label}`}
                >
                  ✕
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {results.length > 0 && (
        <div className="mt-2 flex justify-between border-t border-neutral-800 pt-2 text-xs text-neutral-500">
          <span>{results.filter((r) => r.amount != null).length} of {results.length} found</span>
          <span>Pinned total <span className="font-medium text-neutral-300">{mask(money(pinnedTotal))}</span></span>
        </div>
      )}

      {editing && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Label (e.g. Cape Town municipal)"
            className={`${wlInput} flex-1 min-w-[10rem]`}
          />
          <input
            value={match}
            onChange={(e) => setMatch(e.target.value)}
            placeholder="Match keyword (e.g. cape town)"
            className={`${wlInput} flex-1 min-w-[9rem]`}
          />
          <button
            onClick={() => void add()}
            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-500"
          >
            Add
          </button>
        </div>
      )}
    </Panel>
  );
}
