import { useMemo, useState } from "react";
import type { Transaction } from "../types";
import { groupByMonth, searchTransactions } from "../lib/timeline";
import { money } from "../lib/format";
import { Icon } from "../components/icons";
import Panel from "../components/Panel";
import TransactionList from "../components/TransactionList";
import CategoryEditor from "../components/CategoryEditor";

interface Props {
  transactions: Transaction[];
  loading: boolean;
  hideAmounts: boolean;
}

export default function Transactions({ transactions, loading, hideAmounts }: Props) {
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<Transaction | null>(null);
  // Manual open/close overrides per month; default is computed (current + last
  // month open, the rest collapsed - unless a search is active).
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const filtered = useMemo(() => searchTransactions(transactions, q), [transactions, q]);
  const months = useMemo(() => groupByMonth(filtered), [filtered]);
  const mask = (v: string) => (hideAmounts ? "••••••" : v);
  const searching = q.trim().length > 0;

  if (loading) return <div className="py-20 text-center text-neutral-500">Loading…</div>;

  return (
    <div className="space-y-6">
      <div className="relative">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search transactions - merchant, category, account…"
          aria-label="Search transactions"
          className="w-full rounded-xl border border-neutral-800 bg-neutral-900/60 px-4 py-3 text-sm text-neutral-200 outline-none focus:border-indigo-500"
        />
        {q && (
          <button
            onClick={() => setQ("")}
            aria-label="Clear search"
            className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-neutral-300"
          >
            ✕
          </button>
        )}
      </div>

      {transactions.length === 0 ? (
        <Panel title="Transactions">
          <div className="py-10 text-center text-sm text-neutral-500">
            No transactions yet. Import a CSV on the Import tab.
          </div>
        </Panel>
      ) : months.length === 0 ? (
        <Panel title="Transactions">
          <div className="py-10 text-center text-sm text-neutral-500">
            No transactions match “{q}”.
          </div>
        </Panel>
      ) : (
        months.map((g, i) => {
          const open = overrides[g.key] ?? (searching || i < 2);
          return (
            <section
              key={g.key}
              className="rounded-2xl border border-neutral-800 bg-neutral-900/60 p-5"
            >
              <button
                onClick={() => setOverrides((o) => ({ ...o, [g.key]: !open }))}
                aria-expanded={open}
                className="flex w-full items-center justify-between gap-3 text-left"
              >
                <span className="flex items-center gap-2">
                  <Icon
                    name="chevron"
                    size={16}
                    className={`text-neutral-500 transition-transform ${open ? "" : "-rotate-90"}`}
                  />
                  <span className="text-sm font-semibold text-neutral-300">{g.label}</span>
                  <span className="text-xs text-neutral-500">
                    {g.txns.length} txn{g.txns.length === 1 ? "" : "s"}
                  </span>
                </span>
                <span className="flex gap-3 text-xs tabular-nums">
                  <span className="text-emerald-400">+{mask(money(g.inflow))}</span>
                  <span className="text-neutral-400">−{mask(money(g.outflow))}</span>
                </span>
              </button>
              {open && (
                <div className="mt-4">
                  <TransactionList transactions={g.txns} hideAmounts={hideAmounts} onEditCategory={setEditing} />
                </div>
              )}
            </section>
          );
        })
      )}

      {editing && <CategoryEditor txn={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
