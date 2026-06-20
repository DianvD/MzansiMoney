import type { Transaction } from "../types";
import { monthKey, monthLabel, tsToDate } from "./format";

export interface MonthGroup {
  key: string;
  label: string;
  txns: Transaction[];
  inflow: number;
  outflow: number;
}

/** Group transactions into months (preserving the incoming newest-first order)
 * with per-month inflow/outflow totals - the financial-timeline view. */
export function groupByMonth(txns: Transaction[]): MonthGroup[] {
  const groups = new Map<string, MonthGroup>();
  for (const t of txns) {
    const d = tsToDate(t.date);
    if (!d) continue;
    const key = monthKey(d);
    let g = groups.get(key);
    if (!g) {
      g = { key, label: monthLabel(d), txns: [], inflow: 0, outflow: 0 };
      groups.set(key, g);
    }
    g.txns.push(t);
    if (t.direction === "credit") g.inflow += t.amount;
    else g.outflow += t.amount;
  }
  // Map preserves insertion order; txns arrive newest-first so months already
  // descend. Sort defensively by key desc.
  return [...groups.values()].sort((a, b) => (a.key < b.key ? 1 : -1));
}

export function searchTransactions(txns: Transaction[], q: string): Transaction[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return txns;
  return txns.filter((t) =>
    `${t.merchant} ${t.description} ${t.category} ${t.account}`.toLowerCase().includes(needle),
  );
}
