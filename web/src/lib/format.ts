const zar = new Intl.NumberFormat("en-ZA", {
  style: "currency",
  currency: "ZAR",
  minimumFractionDigits: 2,
});

export function money(value: number): string {
  return zar.format(value);
}

/** Signed money with an explicit + for credits, used in the transaction list. */
export function signedMoney(value: number): string {
  const formatted = zar.format(Math.abs(value));
  if (value < 0) return `-${formatted}`;
  if (value > 0) return `+${formatted}`;
  return formatted;
}

/** Mask string for hidden balances - shared so it's consistent everywhere. */
export const MASK = "••••••";

/** Safely convert a Firestore Timestamp (or null/garbage) to a Date. */
export function tsToDate(ts: { toDate?: () => Date } | null | undefined): Date | null {
  try {
    return ts && typeof ts.toDate === "function" ? ts.toDate() : null;
  } catch {
    return null;
  }
}

const dateFmt = new Intl.DateTimeFormat("en-ZA", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

export function shortDate(d: Date): string {
  return dateFmt.format(d);
}

export function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

const monthFmt = new Intl.DateTimeFormat("en-ZA", { month: "long", year: "numeric" });

export function monthLabel(d: Date): string {
  return monthFmt.format(d);
}
