import { useState } from "react";
import type { Transaction } from "../types";
import { CATEGORIES } from "../lib/categories";
import { deleteTransaction, setCategory } from "../lib/data";

interface Props {
  txn: Transaction;
  onClose: () => void;
}

export default function CategoryEditor({ txn, onClose }: Props) {
  const [category, setCat] = useState(txn.category || "Uncategorized");
  const [applyToMerchant, setApply] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [confirmDel, setConfirmDel] = useState(false);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await setCategory({ transactionId: txn.id, category, applyToMerchant });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update category.");
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await deleteTransaction(txn.id);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete transaction.");
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl border border-neutral-800 bg-neutral-900 p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-sm font-semibold text-neutral-200">Change category</div>
        <div className="mt-1 truncate text-xs text-neutral-500">{txn.merchant}</div>

        <select
          value={category}
          onChange={(e) => setCat(e.target.value)}
          className="mt-4 w-full rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-200 outline-none focus:border-indigo-500"
        >
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>

        <label className="mt-3 flex items-center gap-2 text-sm text-neutral-300">
          <input type="checkbox" checked={applyToMerchant} onChange={(e) => setApply(e.target.checked)} />
          Apply to all “{txn.merchant}” and learn for future imports
        </label>

        {error && <div className="mt-3 text-sm text-rose-400">{error}</div>}

        <div className="mt-5 flex items-center gap-2">
          {confirmDel ? (
            <button disabled={busy} onClick={remove}
              className="rounded-lg border border-rose-700 px-3 py-1.5 text-sm font-medium text-rose-300 hover:bg-rose-900/40 disabled:opacity-50">
              {busy ? "Deleting…" : "Confirm delete"}
            </button>
          ) : (
            <button onClick={() => setConfirmDel(true)}
              className="rounded-lg px-3 py-1.5 text-sm text-rose-400/80 hover:text-rose-300">
              Delete
            </button>
          )}
          <div className="ml-auto flex gap-2">
            <button onClick={onClose} className="rounded-lg px-3 py-1.5 text-sm text-neutral-400 hover:text-neutral-200">
              Cancel
            </button>
            <button
              disabled={busy}
              onClick={save}
              className="rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
