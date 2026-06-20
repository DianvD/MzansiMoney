import { useState } from "react";
import Panel from "./Panel";
import { addTransaction } from "../lib/data";
import { CATEGORIES } from "../lib/categories";

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function ManualEntry() {
  const [date, setDate] = useState(today());
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [direction, setDirection] = useState<"debit" | "credit">("debit");
  const [account, setAccount] = useState("Cheque");
  const [category, setCategory] = useState("Uncategorized");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const value = Number(amount);
    if (!description.trim()) return setError("Description is required.");
    if (!Number.isFinite(value) || value <= 0) return setError("Amount must be greater than zero.");
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const res = await addTransaction({
        date,
        description: description.trim(),
        amount: value,
        direction,
        account: account.trim() || "Cheque",
        category: category === "Uncategorized" ? "" : category,
      });
      setMsg(`Added - categorized as ${res.category}.`);
      setDescription("");
      setAmount("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add transaction.");
    } finally {
      setBusy(false);
    }
  }

  const field = "w-full rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-neutral-200 outline-none focus:border-indigo-500";

  return (
    <Panel title="Add a transaction manually">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="text-sm">
          <span className="mb-1 block text-neutral-400">Date</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={field} />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-neutral-400">Amount (R)</span>
          <input type="number" inputMode="decimal" min="0" step="0.01" value={amount}
            onChange={(e) => setAmount(e.target.value)} placeholder="0.00" className={field} />
        </label>
        <label className="text-sm sm:col-span-2">
          <span className="mb-1 block text-neutral-400">Description</span>
          <input value={description} onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. Checkers groceries" className={field} />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-neutral-400">Type</span>
          <select value={direction} onChange={(e) => setDirection(e.target.value as "debit" | "credit")} className={field}>
            <option value="debit">Money out (debit)</option>
            <option value="credit">Money in (credit)</option>
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-neutral-400">Account</span>
          <input value={account} onChange={(e) => setAccount(e.target.value)} className={field} />
        </label>
        <label className="text-sm sm:col-span-2">
          <span className="mb-1 block text-neutral-400">Category</span>
          <select value={category} onChange={(e) => setCategory(e.target.value)} className={field}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{c === "Uncategorized" ? "Auto (let MzansiMoney decide)" : c}</option>
            ))}
          </select>
        </label>
      </div>

      <button disabled={busy} onClick={submit}
        className="mt-4 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50">
        {busy ? "Adding…" : "Add transaction"}
      </button>

      {msg && <div className="mt-3 text-sm text-emerald-400">{msg}</div>}
      {error && <div className="mt-3 text-sm text-rose-400">{error}</div>}
    </Panel>
  );
}
