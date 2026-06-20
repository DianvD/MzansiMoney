// Derive the list of accounts straight from the transactions - no manual setup.
// Each cash transaction already carries an accountId (keyed on the account number
// when known, else institution+label), so distinct accountIds ARE the accounts.

import type { AccountType, Transaction } from "../types";
import { tsToDate } from "./format";

export const ALL_ACCOUNTS = "all";

export interface Account {
  accountId: string;
  /** Display label: a user override, else the imported account label, else institution. */
  label: string;
  institution: string;
  /** Raw account label as imported (used to reproduce the accountId on re-import). */
  account: string;
  accountNumber: string | null;
  accountType: AccountType;
  count: number;
  latestDate: Date | null;
  /** Most recent known running balance for the account (null if none carried one). */
  balance: number | null;
}

function topKey(counts: Record<string, number>): string {
  let best = "";
  let n = -1;
  for (const [k, c] of Object.entries(counts)) {
    if (k && c > n) {
      best = k;
      n = c;
    }
  }
  return best;
}

/** Group cash transactions into accounts. Home-loan txns are excluded - the bond
 * keeps its own dedicated page. `labels` are per-account display overrides. */
export function deriveAccounts(txns: Transaction[], labels: Record<string, string> = {}): Account[] {
  interface Acc {
    accountId: string;
    accountLabels: Record<string, number>;
    institutions: Record<string, number>;
    accountNumber: string | null;
    accountType: AccountType;
    count: number;
    latestMs: number;
    latestDate: Date | null;
    balanceMs: number;
    balance: number | null;
  }
  const map = new Map<string, Acc>();

  for (const t of txns) {
    if (t.accountType === "home_loan") continue;
    const id = t.accountId || "unknown";
    let a = map.get(id);
    if (!a) {
      a = {
        accountId: id,
        accountLabels: {},
        institutions: {},
        accountNumber: null,
        accountType: t.accountType ?? "cash",
        count: 0,
        latestMs: -Infinity,
        latestDate: null,
        balanceMs: -Infinity,
        balance: null,
      };
      map.set(id, a);
    }
    a.count++;
    if (t.account) a.accountLabels[t.account] = (a.accountLabels[t.account] ?? 0) + 1;
    if (t.sourceInstitution) a.institutions[t.sourceInstitution] = (a.institutions[t.sourceInstitution] ?? 0) + 1;
    if (t.accountNumber && !a.accountNumber) a.accountNumber = t.accountNumber;
    const d = tsToDate(t.date);
    const ms = d ? d.getTime() : -Infinity;
    if (ms > a.latestMs) {
      a.latestMs = ms;
      a.latestDate = d;
    }
    if (t.balance != null && ms > a.balanceMs) {
      a.balanceMs = ms;
      a.balance = t.balance;
    }
  }

  const accounts: Account[] = [...map.values()].map((a) => {
    const account = topKey(a.accountLabels);
    const institution = topKey(a.institutions);
    const label = labels[a.accountId] || account || institution || `Account ${a.accountId.slice(0, 8)}`;
    return {
      accountId: a.accountId,
      label,
      institution,
      account,
      accountNumber: a.accountNumber,
      accountType: a.accountType,
      count: a.count,
      latestDate: a.latestDate,
      balance: a.balance,
    };
  });

  // Most-used first; ties broken by most recent activity.
  accounts.sort((x, y) => y.count - x.count || (y.latestDate?.getTime() ?? 0) - (x.latestDate?.getTime() ?? 0));
  return accounts;
}

export function accountById(accounts: Account[], accountId: string): Account | undefined {
  return accounts.find((a) => a.accountId === accountId);
}
