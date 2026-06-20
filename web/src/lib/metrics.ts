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
 * Current balance, account-aware. For each account use its most recent
 * (by date) transaction that carries a running balance; if an account has no
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
    if (withBalance.length) {
      const latest = withBalance.reduce((a, b) =>
        (toDate(a.date)?.getTime() ?? 0) >= (toDate(b.date)?.getTime() ?? 0) ? a : b,
      );
      total += latest.balance as number;
    } else {
      total += list.reduce((s, t) => s + t.signedAmount, 0);
    }
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
