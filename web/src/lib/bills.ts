import type { Bill } from "../types";
import { tsToDate } from "./format";

export type BillStatus = "overdue" | "upcoming" | "paid";

export function billStatus(bill: Bill, now: Date): BillStatus {
  if (bill.paid) return "paid";
  const due = tsToDate(bill.dueDate);
  if (due && due < startOfDay(now)) return "overdue";
  return "upcoming";
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function sumBills(bills: Bill[]): number {
  return bills.reduce((s, b) => s + (b.amount || 0), 0);
}

export function groupBills(bills: Bill[], now: Date): Record<BillStatus, Bill[]> {
  const out: Record<BillStatus, Bill[]> = { overdue: [], upcoming: [], paid: [] };
  for (const b of bills) out[billStatus(b, now)].push(b);
  return out;
}
