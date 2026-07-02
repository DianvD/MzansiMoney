import type { Timestamp } from "firebase/firestore";
import type { Transaction } from "../types";
import { monthKey } from "./format";

function toDate(ts: Timestamp | null | undefined): Date | null {
  try {
    return ts && typeof ts.toDate === "function" ? ts.toDate() : null;
  } catch {
    return null;
  }
}

/**
 * The current running balance for ONE account, given its balance-carrying
 * transactions. The current balance is the running balance on the
 * chronologically-last transaction - but dates are stored at day granularity, so
 * several transactions on the most recent day all tie on `getTime()`. Picking by
 * date alone then returns an arbitrary intra-day row (whichever sorts first),
 * which is off by exactly the amount(s) posted after it - e.g. a closing PayShap
 * fee makes the headline read R10 high.
 *
 * We break the same-day tie by following the running-balance chain: each row's
 * "balance before" (`balance - signedAmount`) equals the previous row's "balance
 * after". The end-of-day row is the one whose balance is never another same-day
 * row's starting point. That test fails when the day's chain is a CYCLE - e.g. a
 * debit and its same-day reversal (a R861 licence renewal + its R861 refund):
 * each row's balance is the other's start, so no row looks like an "end". For
 * that case we anchor on the previous day's closing balance and walk the day's
 * chain forward; the walk is order-independent, so Firestore's arbitrary
 * intra-day doc order can't skew the result. Only if the walk can't consume the
 * whole day (a missing row splits the chain, or a start value repeats) do we
 * fall back to a stable latest-day row - no worse than before.
 */
export function currentBalance(withBalance: Transaction[]): number | null {
  if (!withBalance.length) return null;
  const ms = (t: Transaction) => toDate(t.date)?.getTime() ?? 0;
  const maxMs = withBalance.reduce((m, t) => Math.max(m, ms(t)), -Infinity);
  const day = withBalance.filter((t) => ms(t) === maxMs);
  if (day.length === 1) return day[0].balance as number;
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const starts = new Set(day.map((t) => r2((t.balance as number) - t.signedAmount)));
  const ends = day.filter((t) => !starts.has(r2(t.balance as number)));
  if (ends.length === 1) return ends[0].balance as number;
  const anchor = currentBalance(withBalance.filter((t) => ms(t) < maxMs));
  if (anchor != null) {
    const walked = walkDayChain(day, r2(anchor), r2);
    if (walked != null) return walked;
  }
  return day[day.length - 1].balance as number;
}

/**
 * Walk one day's rows as a running-balance chain starting from `anchor` (the
 * previous day's closing balance). Returns the final balance only when every
 * row is consumed exactly once - a partial walk means the chain is genuinely
 * ambiguous and the caller should fall back.
 */
function walkDayChain(
  day: Transaction[],
  anchor: number,
  r2: (n: number) => number,
): number | null {
  const remaining = [...day];
  let cur = anchor;
  let last: number | null = null;
  while (remaining.length) {
    const idx = remaining.findIndex(
      (t) => r2((t.balance as number) - t.signedAmount) === cur,
    );
    if (idx === -1) return null;
    cur = r2(remaining.splice(idx, 1)[0].balance as number);
    last = cur;
  }
  return last;
}

/**
 * Current balance, account-aware. For each account use the running balance on its
 * chronologically-last transaction (see `currentBalance`); if an account has no
 * balances, fall back to the signed sum of its transactions. Then sum across
 * accounts - so the headline is correct once a second account exists.
 */
export function computeBalance(txns: Transaction[]): number | null {
  if (txns.length === 0) return null;
  const byAccount = new Map<string, Transaction[]>();
  for (const t of txns) {
    const key = t.accountId || t.account || "default";
    (byAccount.get(key) ?? byAccount.set(key, []).get(key)!).push(t);
  }
  let total = 0;
  for (const list of byAccount.values()) {
    const withBalance = list.filter(
      (t) => typeof t.balance === "number" && !Number.isNaN(t.balance),
    );
    const bal = currentBalance(withBalance);
    total += bal != null ? bal : list.reduce((s, t) => s + t.signedAmount, 0);
  }
  return total;
}

export interface DashboardMetrics {
  currentBalance: number | null;
  spendThisMonth: number;
  incomeThisMonth: number;
  netThisMonth: number;
  categoryBreakdown: { category: string; amount: number }[];
  monthLabel: string;
}

const COLLATOR = new Intl.DateTimeFormat("en-ZA", {
  month: "long",
  year: "numeric",
});

/**
 * Derive the headline dashboard numbers from the transaction list.
 *
 * Current balance prefers the running balance on the most recent transaction
 * that carries one (most accurate); it falls back to the net sum of all flows
 * when no balance column was imported.
 */
export function computeMetrics(
  txns: Transaction[],
  now: Date,
  isTransfer: (t: Transaction) => boolean = () => false,
): DashboardMetrics {
  const thisMonth = monthKey(now);

  let spend = 0;
  let income = 0;
  const byCategory = new Map<string, number>();

  for (const t of txns) {
    const d = toDate(t.date);
    if (!d || monthKey(d) !== thisMonth) continue;
    // A transfer between your own accounts isn't income or spending - it just
    // moves money (the balance already reflects it). Keep it out of both.
    if (isTransfer(t)) continue;
    if (t.direction === "credit") {
      income += t.amount;
    } else {
      spend += t.amount;
      byCategory.set(t.category, (byCategory.get(t.category) ?? 0) + t.amount);
    }
  }

  const currentBalance = computeBalance(txns);

  const categoryBreakdown = [...byCategory.entries()]
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => b.amount - a.amount);

  return {
    currentBalance,
    spendThisMonth: spend,
    incomeThisMonth: income,
    netThisMonth: income - spend,
    categoryBreakdown,
    monthLabel: COLLATOR.format(now),
  };
}
