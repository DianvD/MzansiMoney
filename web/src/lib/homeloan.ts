import type { HomeLoanSettings, Transaction } from "../types";
import { monthKey, monthLabel, tsToDate } from "./format";

/**
 * Home-loan math. A bond statement has no balance column, so the user anchors the
 * current outstanding balance and we roll the flows backward from it.
 *
 * For a home-loan transaction ``signedAmount`` is the signed change to the
 * balance *owed*: + for a charge (interest/insurance/fee), − for money in
 * (payment, or a deposit into the access bond). So the balance owed after the
 * newest transaction is the anchor, and owed *before* a transaction = owed after
 * it − its signedAmount. Walking oldest→newest, the running balance starts at
 * ``anchor − Σ signed`` and ends at the anchor.
 */

export interface MonthBreakdown {
  key: string;
  label: string;
  interest: number;
  insurance: number;
  fees: number;
  paid: number; // money paid in (magnitude), reduces owed
  transfersIn: number; // deposits into the bond / access-bond top-ups (magnitude)
  transfersOut: number; // access-bond withdrawals (magnitude), increases owed
  other: number; // signed, anything uncategorized
  netChange: number; // signed change to owed over the month (+ = owe more)
  closingOwed: number | null; // balance owed at month end, if anchored
}

export interface HomeLoanSummary {
  hasData: boolean;
  hasAnchor: boolean;
  outstanding: number | null; // current balance owed (the anchor)
  available: number | null; // access-bond available to withdraw (user-entered)
  asOf: string | null;
  openingOwed: number | null; // owed before the first transaction in the data
  totalInterest: number;
  totalInsurance: number;
  totalFees: number;
  totalPaid: number;
  totalIn: number; // payments + transfers in
  totalOut: number; // access-bond withdrawals
  months: MonthBreakdown[]; // newest first
}

/** A pure access-bond movement (deposit/withdrawal) - the only kind of line whose
 * effect on "available to withdraw" is unambiguous. A normal monthly payment may
 * be part-scheduled/part-extra, which we can't split without the amortisation
 * schedule, so it does NOT move available. */
function isBondTransfer(t: Transaction): boolean {
  const s = `${t.category} ${t.description}`.toLowerCase();
  return s.includes("transfer") || s.includes("withdrawal");
}

function bucket(t: Transaction): keyof Pick<
  MonthBreakdown,
  "interest" | "insurance" | "fees"
> | "in" | "out" | "other" {
  const c = (t.category || "").toLowerCase();
  const d = (t.description || "").toLowerCase();
  if (c.includes("interest") || d.includes("interest")) return "interest";
  if (c.includes("insurance") || d.includes("insurance")) return "insurance";
  if (c.includes("fee") || d.includes("admin") || d.includes("fee")) return "fees";
  // Money in (signed < 0 reduces owed) vs a withdrawal (signed > 0 increases owed).
  if (t.signedAmount < 0) return "in";
  if (t.signedAmount > 0) return "out";
  return "other";
}

export function computeHomeLoan(
  txns: Transaction[],
  settings: HomeLoanSettings | null,
): HomeLoanSummary {
  const sorted = [...txns].sort(
    (a, b) => (tsToDate(a.date)?.getTime() ?? 0) - (tsToDate(b.date)?.getTime() ?? 0),
  );

  const hasAnchor =
    !!settings && typeof settings.currentBalance === "number" &&
    Number.isFinite(settings.currentBalance);
  const anchor = hasAnchor ? (settings as HomeLoanSettings).currentBalance : null;

  // The anchor is the balance owed AS OF settings.asOf. Statement lines dated
  // after that date are applied forward, so the headline tracks reality without
  // re-typing: a withdrawal (+owed) or extra payment (-owed) moves it on import.
  // With no asOf we treat the anchor as the balance after the newest line.
  const asOfCutoff = settings?.asOf
    ? Date.parse(`${settings.asOf}T23:59:59`)
    : null;
  const signedUpToAnchor =
    anchor != null
      ? sorted
          .filter((t) => asOfCutoff == null || (tsToDate(t.date)?.getTime() ?? 0) <= asOfCutoff)
          .reduce((s, t) => s + t.signedAmount, 0)
      : 0;
  // Balance owed just before the first transaction in the dataset.
  const openingOwed = anchor != null ? round2(anchor - signedUpToAnchor) : null;

  const order: string[] = [];
  const byMonth = new Map<string, MonthBreakdown>();
  let running = openingOwed; // walks forward to the anchor

  const totals = { interest: 0, insurance: 0, fees: 0, paid: 0, in: 0, out: 0 };

  for (const t of sorted) {
    const d = tsToDate(t.date);
    if (!d) continue;
    const key = monthKey(d);
    let m = byMonth.get(key);
    if (!m) {
      m = {
        key, label: monthLabel(d),
        interest: 0, insurance: 0, fees: 0, paid: 0,
        transfersIn: 0, transfersOut: 0, other: 0, netChange: 0, closingOwed: null,
      };
      byMonth.set(key, m);
      order.push(key);
    }

    const b = bucket(t);
    const mag = t.amount;
    if (b === "interest") { m.interest += mag; totals.interest += mag; }
    else if (b === "insurance") { m.insurance += mag; totals.insurance += mag; }
    else if (b === "fees") { m.fees += mag; totals.fees += mag; }
    else if (b === "in") {
      // Distinguish an explicit transfer/deposit from an ordinary monthly payment.
      const isTransfer = (t.category || t.description || "").toLowerCase().includes("transfer");
      if (isTransfer) { m.transfersIn += mag; } else { m.paid += mag; totals.paid += mag; }
      totals.in += mag;
    }
    else if (b === "out") { m.transfersOut += mag; totals.out += mag; }
    else { m.other += t.signedAmount; }

    m.netChange += t.signedAmount;
    if (running != null) { running = round2(running + t.signedAmount); m.closingOwed = running; }
  }

  // Round month aggregates for display stability.
  for (const m of byMonth.values()) {
    m.interest = round2(m.interest); m.insurance = round2(m.insurance);
    m.fees = round2(m.fees); m.paid = round2(m.paid);
    m.transfersIn = round2(m.transfersIn); m.transfersOut = round2(m.transfersOut);
    m.other = round2(m.other); m.netChange = round2(m.netChange);
  }

  const months = order.map((k) => byMonth.get(k)!).reverse(); // newest first

  // After the forward walk, ``running`` is the balance owed after the newest line
  // - i.e. the live current balance, anchor adjusted for post-asOf activity.
  const outstandingLive = anchor != null ? round2(running ?? anchor) : null;

  // Access-bond available, auto-adjusted for explicit bond transfers dated after
  // the anchor: a deposit (signed < 0) frees up redraw (+), a withdrawal
  // (signed > 0) consumes it (−). availableChange = −signedAmount. Only transfers
  // move it; ordinary payments/interest don't (see isBondTransfer).
  const availAnchor =
    settings && typeof settings.available === "number" && Number.isFinite(settings.available)
      ? settings.available
      : null;
  const transferSignedAfterAnchor =
    availAnchor != null && asOfCutoff != null
      ? sorted
          .filter((t) => isBondTransfer(t) && (tsToDate(t.date)?.getTime() ?? 0) > asOfCutoff)
          .reduce((s, t) => s + t.signedAmount, 0)
      : 0;
  const availableLive =
    availAnchor != null ? round2(availAnchor - transferSignedAfterAnchor) : null;

  return {
    hasData: sorted.length > 0,
    hasAnchor,
    outstanding: outstandingLive,
    available: availableLive,
    asOf: settings?.asOf ?? null,
    openingOwed,
    totalInterest: round2(totals.interest),
    totalInsurance: round2(totals.insurance),
    totalFees: round2(totals.fees),
    totalPaid: round2(totals.paid),
    totalIn: round2(totals.in),
    totalOut: round2(totals.out),
    months,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
