import type { Timestamp } from "firebase/firestore";

export type Direction = "debit" | "credit";

/** Cash (cheque/savings) vs a home-loan liability. Older transactions predate the
 * field, so treat a missing value as "cash". */
export type AccountType = "cash" | "home_loan";

/** The canonical transaction, mirroring the backend ``model.normalize`` output. */
export interface Transaction {
  id: string;
  date: Timestamp;
  description: string;
  merchant: string;
  amount: number;
  // Signed effect on the account headline. Cash: credits +, debits -. Home loan:
  // debits + (owe more), credits - (owe less) - i.e. signed change in owed.
  signedAmount: number;
  direction: Direction;
  accountType?: AccountType;
  category: string;
  account: string; // display label (cosmetic)
  accountId: string; // identity - derived from the account number when known
  accountNumber?: string | null;
  reference: string;
  balance: number | null;
  sourceDocument: string;
  sourceInstitution: string;
  importJobId: string;
}

/** A payable derived from an invoice/pro-forma. */
export interface Bill {
  id: string;
  institution: string;
  docNumber: string | null;
  account: string | null;
  description: string;
  amount: number;
  currency: string;
  issueDate: Timestamp | null;
  dueDate: Timestamp | null;
  docType: string;
  category: string;
  paid: boolean;
  paidTransactionId: string | null;
  documentId: string;
  sourceDocument: string;
}

/** A manually-declared asset or liability for net worth. */
export interface Holding {
  id: string;
  type: "asset" | "liability";
  name: string;
  value: number;
}

/** A savings goal. */
export interface Goal {
  id: string;
  name: string;
  target: number;
  current: number;
}

/** A pinned recurring payment to keep visible on the dashboard with its current
 * amount. `match` is a keyword found against a bill's institution/category or a
 * transaction's merchant/description - so it works whether the payment arrives as
 * an invoice PDF (Cape Town, levy) or a debit order (Kar insurance). Stored at
 * users/{uid}/settings/watchlist as { items: WatchItem[] }. */
export interface WatchItem {
  id: string;
  label: string;
  match: string;
  /** A known fixed monthly amount (e.g. Axxess R899 at month-end). When set it's
   * used directly instead of searching bills/transactions - for predictable
   * standing payments that don't arrive as a reliable invoice. */
  fixedAmount?: number | null;
}

/** Editable keyword lists that sort detected recurring payments into Debit Orders
 * (company-controlled mandates) vs Subscriptions (automatic but you cancel them).
 * Anything recurring that matches neither falls under "Other recurring". Stored at
 * users/{uid}/settings/recurring. */
export interface RecurringLists {
  /** Surfaced above the rest - recurring items the owner wants to keep an eye on. */
  important: string[];
  debitOrders: string[];
  subscriptions: string[];
  /** Money moved between his own accounts (e.g. cheque → home loan). Not spending -
   * excluded from the dashboard spend total and category donut. */
  transfers: string[];
}

/** Client-owned settings for the Home Loan view. The bond CSV carries no balance
 * column, so the user anchors the outstanding balance once and the view rolls the
 * statement flows backward from it. Stored at users/{uid}/settings/homeLoan. */
export interface HomeLoanSettings {
  /** Current outstanding balance owed (the headline figure). */
  currentBalance: number;
  /** Access-bond available to withdraw (the prepaid surplus), as the bank reports
   * it. Not derivable from the CSV - entered by the user. */
  available?: number | null;
  /** ISO date (YYYY-MM-DD) the figures are accurate as of - informational. */
  asOf: string | null;
}
