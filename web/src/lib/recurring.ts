import type { Transaction } from "../types";
import { monthKey, tsToDate } from "./format";

export interface Recurring {
  key: string;
  merchant: string;
  category: string;
  account: string;
  occurrences: { date: Date; amount: number }[]; // newest first
  count: number;
  lastDate: Date;
  typical: number; // median amount
  min: number;
  max: number;
  total: number;
  months: number;
}

export type RecurringKind = "important" | "debit" | "subscription" | "transfer" | "other";

export interface RecurringListInput {
  important: string[];
  debitOrders: string[];
  subscriptions: string[];
  transfers: string[];
}

export function matchesAny(merchant: string, kws: string[]): boolean {
  const low = (merchant || "").toLowerCase();
  return kws.some((k) => k.trim() && low.includes(k.trim().toLowerCase()));
}

/**
 * Sort detected recurring payments into buckets using the user's keyword lists.
 * Order matters - the first match wins: Important (surfaced) → Debit Orders
 * (mandates) → Subscriptions (cancellable) → Transfers (own-account moves) →
 * everything else.
 */
export function classifyRecurring(
  items: Recurring[],
  lists: RecurringListInput,
): Record<RecurringKind, Recurring[]> {
  const out: Record<RecurringKind, Recurring[]> = {
    important: [], debit: [], subscription: [], transfer: [], other: [],
  };
  for (const r of items) {
    if (matchesAny(r.merchant, lists.important)) out.important.push(r);
    else if (matchesAny(r.merchant, lists.debitOrders)) out.debit.push(r);
    else if (matchesAny(r.merchant, lists.subscriptions)) out.subscription.push(r);
    else if (matchesAny(r.merchant, lists.transfers)) out.transfer.push(r);
    else out.other.push(r);
  }
  return out;
}

/** The most recent occurrence's amount - what the row shows on its main line. */
export function latestAmount(r: Recurring): number {
  return r.occurrences[0]?.amount ?? r.typical;
}

function median(nums: number[]): number {
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Detect recurring debits (debit orders / subscriptions): a merchant you pay in
 * at least two distinct months. Card spend that recurs (e.g. weekly groceries)
 * shows here too, but the consistent-amount ones at the top are your real debit
 * orders.
 */
export function detectRecurring(txns: Transaction[]): Recurring[] {
  const groups = new Map<
    string,
    { merchant: string; category: string; account: string; occ: { date: Date; amount: number }[]; months: Set<string> }
  >();

  for (const t of txns) {
    if (t.direction !== "debit") continue;
    const d = tsToDate(t.date);
    if (!d) continue;
    const key = (t.merchant || "").toLowerCase().trim();
    if (!key) continue;
    let g = groups.get(key);
    if (!g) {
      g = { merchant: t.merchant, category: t.category, account: t.account, occ: [], months: new Set() };
      groups.set(key, g);
    }
    g.occ.push({ date: d, amount: t.amount });
    g.months.add(monthKey(d));
  }

  const out: Recurring[] = [];
  for (const [key, g] of groups) {
    if (g.months.size < 2) continue; // needs to recur across months
    const occ = g.occ.sort((a, b) => b.date.getTime() - a.date.getTime());
    const amounts = occ.map((o) => o.amount);
    out.push({
      key,
      merchant: g.merchant,
      category: g.category,
      account: g.account,
      occurrences: occ,
      count: occ.length,
      lastDate: occ[0].date,
      typical: median(amounts),
      min: Math.min(...amounts),
      max: Math.max(...amounts),
      total: amounts.reduce((s, a) => s + a, 0),
      months: g.months.size,
    });
  }
  return out.sort((a, b) => b.typical - a.typical);
}
