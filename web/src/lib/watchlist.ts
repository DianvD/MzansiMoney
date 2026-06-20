import type { Bill, Transaction, WatchItem } from "../types";
import { monthKey, shortDate, tsToDate } from "./format";

export interface WatchResult {
  id: string;
  label: string;
  match: string;
  amount: number | null;
  source: "bill" | "transaction" | "fixed" | "none";
  note?: string; // e.g. "paid", or "last 02 May 2026" when no charge yet this month
}

/**
 * Resolve each pinned payment to its current amount. A payment can arrive as a
 * bill (Cape Town municipal, the levy) or a debit-order transaction (Kar
 * insurance), so we look in both:
 *   1. a matching bill - use its amount (the invoice for this cycle);
 *   2. else this month's matching transaction(s) - sum their magnitudes;
 *   3. else the most recent matching transaction, flagged as last-seen.
 * The point is the amount changes monthly and the owner wants to see *this* month's
 * figure without hunting for it.
 */
export function computeWatchlist(
  items: WatchItem[],
  bills: Bill[],
  txns: Transaction[],
  now: Date,
): WatchResult[] {
  const month = monthKey(now);
  return items.map((it) => {
    const base = { id: it.id, label: it.label, match: it.match };

    // A fixed standing amount wins - predictable payments (e.g. Axxess R899) that
    // don't arrive as a reliable invoice.
    if (typeof it.fixedAmount === "number" && Number.isFinite(it.fixedAmount)) {
      return { ...base, amount: round2(it.fixedAmount), source: "fixed" as const, note: "month-end" };
    }

    const kw = it.match.trim().toLowerCase();
    if (!kw) return { ...base, amount: null, source: "none" as const };

    const billHits = bills.filter((b) =>
      `${b.institution} ${b.category} ${b.description}`.toLowerCase().includes(kw),
    );
    if (billHits.length) {
      // Prefer an unpaid bill, then the latest by due/issue date.
      const pick = [...billHits].sort((a, b) => {
        if (a.paid !== b.paid) return a.paid ? 1 : -1;
        return dateVal(b) - dateVal(a);
      })[0];
      return { ...base, amount: pick.amount, source: "bill" as const, note: pick.paid ? "paid" : undefined };
    }

    const txHits = txns.filter((t) =>
      `${t.merchant} ${t.description}`.toLowerCase().includes(kw),
    );
    const thisMonth = txHits.filter((t) => {
      const d = tsToDate(t.date);
      return d && monthKey(d) === month;
    });
    if (thisMonth.length) {
      const amount = round2(thisMonth.reduce((s, t) => s + Math.abs(t.amount), 0));
      return { ...base, amount, source: "transaction" as const };
    }
    if (txHits.length) {
      const latest = txHits.reduce((a, b) =>
        (tsToDate(a.date)?.getTime() ?? 0) >= (tsToDate(b.date)?.getTime() ?? 0) ? a : b,
      );
      const d = tsToDate(latest.date);
      return {
        ...base,
        amount: round2(Math.abs(latest.amount)),
        source: "transaction" as const,
        note: d ? `last ${shortDate(d)}` : "last seen",
      };
    }
    return { ...base, amount: null, source: "none" as const };
  });
}

function dateVal(b: Bill): number {
  return (b.dueDate?.toMillis?.() ?? b.issueDate?.toMillis?.() ?? 0) as number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
