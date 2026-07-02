import { useState } from "react";
import type { Bill } from "../types";
import { updateBill } from "../lib/data";
import { money, MASK, tsToDate, shortDate } from "../lib/format";
import { billStatus } from "../lib/bills";
import MerchantAvatar from "./MerchantAvatar";
import BillEditDialog from "./BillEditDialog";

interface Props {
  bill: Bill;
  hideAmounts: boolean;
  now: Date;
}

export default function BillPayCard({ bill, hideAmounts, now }: Props) {
  const [copying, setCopying] = useState<"accountNumber" | "reference" | null>(null);
  const [markingPaid, setMarkingPaid] = useState(false);
  const [paidError, setPaidError] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);

  const mask = (v: string) => (hideAmounts ? MASK : v);
  const payTo = bill.payTo ?? {};
  // Beneficiary falls back to the extracted institution name.
  const beneficiary = payTo.beneficiary || bill.institution;
  const status = billStatus(bill, now);
  const due = tsToDate(bill.dueDate);

  // Show the payment details block only when there are actual routing fields.
  // Beneficiary alone is surfaced in the header, not here.
  const hasPayTo = !!(
    payTo.bank ||
    payTo.accountNumber ||
    payTo.branchCode ||
    payTo.accountType ||
    payTo.reference
  );

  // What the payment is for: description first, then doc number, then category.
  const whatFor = [bill.description, bill.docNumber, bill.category].find(Boolean) ?? "";
  const noteText = bill.note ? ` · ${bill.note}` : "";

  async function copyToClipboard(key: "accountNumber" | "reference", value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopying(key);
      setTimeout(() => setCopying(null), 2000);
    } catch {
      // Clipboard API unavailable (non-HTTPS or blocked) — silently ignore.
    }
  }

  async function markPaid() {
    setMarkingPaid(true);
    setPaidError(null);
    try {
      await updateBill({ billId: bill.id, set: { paid: true } });
      // Firestore subscription will automatically move the bill to the Paid
      // section — no optimistic state needed.
    } catch (e) {
      setPaidError(e instanceof Error ? e.message : "Could not mark as paid.");
    } finally {
      setMarkingPaid(false);
    }
  }

  return (
    <>
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/80 p-4">
        {/* ── Header: avatar · beneficiary · due badge · amount ── */}
        <div className="flex items-start gap-3">
          <MerchantAvatar merchant={beneficiary} category={bill.category} size={40} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate text-sm font-semibold text-neutral-200">
                {beneficiary}
              </span>
              {due && (
                <span
                  className={`rounded-full px-2 py-0.5 text-xs ${
                    status === "overdue"
                      ? "bg-rose-900/40 text-rose-300"
                      : "bg-neutral-800 text-neutral-400"
                  }`}
                >
                  {status === "overdue"
                    ? `Overdue · ${shortDate(due)}`
                    : `Due ${shortDate(due)}`}
                </span>
              )}
            </div>
            {/* What for */}
            <div className="mt-0.5 truncate text-xs text-neutral-500">
              {whatFor}
              {noteText}
            </div>
          </div>
          {/* Amount — right-aligned, red when overdue */}
          <div
            className={`shrink-0 text-base font-bold tabular-nums ${
              status === "overdue" ? "text-rose-400" : "text-neutral-200"
            }`}
          >
            {mask(money(bill.amount))}
          </div>
        </div>

        {/* ── Payment details ── */}
        {hasPayTo ? (
          <div className="mt-3 space-y-2 rounded-xl border border-neutral-800 bg-neutral-950/60 px-3 py-2.5">
            {payTo.bank && <DetailRow label="Bank" value={payTo.bank} />}
            {payTo.accountNumber && (
              <CopyRow
                label="Account number"
                value={payTo.accountNumber}
                copied={copying === "accountNumber"}
                onCopy={() => copyToClipboard("accountNumber", payTo.accountNumber!)}
              />
            )}
            {payTo.branchCode && <DetailRow label="Branch code" value={payTo.branchCode} />}
            {payTo.accountType && <DetailRow label="Account type" value={payTo.accountType} />}
            {payTo.reference && (
              <CopyRow
                label="Reference"
                value={payTo.reference}
                copied={copying === "reference"}
                onCopy={() => copyToClipboard("reference", payTo.reference!)}
              />
            )}
          </div>
        ) : (
          /* Dashed affordance when no payment details have been set yet */
          <button
            onClick={() => setEditOpen(true)}
            className="mt-3 w-full rounded-xl border border-dashed border-neutral-700 py-2 text-xs text-neutral-500 transition-colors hover:border-indigo-700 hover:text-indigo-400"
          >
            No payment details — add them
          </button>
        )}

        {/* ── Actions ── */}
        <div className="mt-3 flex items-center gap-2">
          <button
            onClick={() => setEditOpen(true)}
            className="rounded-lg px-3 py-1.5 text-sm text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
          >
            Edit
          </button>
          <div className="flex-1" />
          {paidError && <span className="text-xs text-rose-400">{paidError}</span>}
          <button
            onClick={markPaid}
            disabled={markingPaid}
            className="rounded-lg bg-emerald-700 px-4 py-1.5 text-sm font-semibold text-white hover:bg-emerald-600 disabled:opacity-50"
          >
            {markingPaid ? "Marking…" : "Mark paid"}
          </button>
        </div>
      </div>

      {editOpen && <BillEditDialog bill={bill} onClose={() => setEditOpen(false)} />}
    </>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-28 shrink-0 text-xs text-neutral-500">{label}</span>
      <span className="flex-1 text-xs text-neutral-300">{value}</span>
    </div>
  );
}

function CopyRow({
  label,
  value,
  copied,
  onCopy,
}: {
  label: string;
  value: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-28 shrink-0 text-xs text-neutral-500">{label}</span>
      <span className="flex-1 font-mono text-xs text-neutral-300">{value}</span>
      <button
        onClick={onCopy}
        className={`shrink-0 rounded px-2 py-0.5 text-xs transition-colors ${
          copied
            ? "bg-emerald-900/40 text-emerald-400"
            : "bg-neutral-800 text-neutral-400 hover:bg-neutral-700 hover:text-neutral-200"
        }`}
      >
        {copied ? "Copied ✓" : "Copy"}
      </button>
    </div>
  );
}
