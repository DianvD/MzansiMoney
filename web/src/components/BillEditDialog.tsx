import { useState, type ReactNode } from "react";
import type { Bill } from "../types";
import { updateBill } from "../lib/data";
import { tsToDate } from "../lib/format";
import { useBackdropDismiss } from "../lib/useBackdropDismiss";

interface Props {
  bill: Bill;
  onClose: () => void;
}

function dateToString(d: Date | null): string {
  if (!d) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function BillEditDialog({ bill, onClose }: Props) {
  const payTo = bill.payTo ?? {};
  const [beneficiary, setBeneficiary] = useState(payTo.beneficiary ?? "");
  const [bank, setBank] = useState(payTo.bank ?? "");
  const [accountNumber, setAccountNumber] = useState(payTo.accountNumber ?? "");
  const [branchCode, setBranchCode] = useState(payTo.branchCode ?? "");
  const [accountType, setAccountType] = useState(payTo.accountType ?? "");
  const [reference, setReference] = useState(payTo.reference ?? "");
  const [amount, setAmount] = useState(bill.amount > 0 ? String(bill.amount) : "");
  const [dueDate, setDueDate] = useState(dateToString(tsToDate(bill.dueDate)));
  const [note, setNote] = useState(bill.note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dismiss = useBackdropDismiss(onClose);

  async function save() {
    const amtNum = Number(amount);
    if (amount !== "" && (!Number.isFinite(amtNum) || amtNum <= 0)) {
      return setError("Amount must be a positive number.");
    }
    setBusy(true);
    setError(null);
    try {
      // payTo fields sent as-is: empty string clears a key per the backend contract.
      // amount and dueDate only sent when the user has entered a value so we don't
      // accidentally zero-out a field the user left blank.
      await updateBill({
        billId: bill.id,
        set: {
          payTo: { beneficiary, bank, accountNumber, branchCode, accountType, reference },
          note,
          ...(amount !== "" ? { amount: amtNum } : {}),
          ...(dueDate !== "" ? { dueDate } : {}),
        },
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save changes.");
    } finally {
      setBusy(false);
    }
  }

  const field =
    "w-full rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-200 outline-none focus:border-indigo-500";

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4"
      {...dismiss}
    >
      <div className="w-full max-w-sm rounded-t-2xl border border-neutral-800 bg-neutral-900 p-5 sm:rounded-2xl max-h-[90vh] overflow-y-auto">
        <div className="text-sm font-semibold text-neutral-200">Edit payment details</div>
        <div className="mt-0.5 truncate text-xs text-neutral-500">{bill.institution}</div>

        <div className="mt-4 space-y-3">
          <Field label="Pay to (beneficiary)">
            <input
              value={beneficiary}
              onChange={(e) => setBeneficiary(e.target.value)}
              placeholder={bill.institution}
              className={field}
            />
          </Field>
          <Field label="Bank">
            <input
              value={bank}
              onChange={(e) => setBank(e.target.value)}
              placeholder="e.g. Standard Bank"
              className={field}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Account number">
              <input
                value={accountNumber}
                onChange={(e) => setAccountNumber(e.target.value)}
                inputMode="numeric"
                className={field}
              />
            </Field>
            <Field label="Branch code">
              <input
                value={branchCode}
                onChange={(e) => setBranchCode(e.target.value)}
                inputMode="numeric"
                className={field}
              />
            </Field>
          </div>
          <Field label="Account type">
            <input
              value={accountType}
              onChange={(e) => setAccountType(e.target.value)}
              placeholder="e.g. Current"
              className={field}
            />
          </Field>
          <Field label="Reference">
            <input value={reference} onChange={(e) => setReference(e.target.value)} className={field} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Amount (R)">
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className={field}
              />
            </Field>
            <Field label="Due date">
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className={field}
              />
            </Field>
          </div>
          <Field label="Note">
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Optional note"
              className={field}
            />
          </Field>
        </div>

        {error && <div className="mt-3 text-sm text-rose-400">{error}</div>}

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm text-neutral-400 hover:text-neutral-200"
          >
            Cancel
          </button>
          <button
            disabled={busy}
            onClick={save}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-xs text-neutral-400">{label}</span>
      {children}
    </label>
  );
}
