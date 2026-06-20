import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../auth";
import type { Transaction } from "../types";
import { computeHomeLoan, type MonthBreakdown } from "../lib/homeloan";
import { money } from "../lib/format";
import { saveHomeLoanSettings, subscribeHomeLoanSettings } from "../lib/data";
import type { HomeLoanSettings } from "../types";
import Panel from "../components/Panel";
import StatCard from "../components/StatCard";

interface Props {
  transactions: Transaction[]; // home-loan transactions only
  loading: boolean;
  hideAmounts: boolean;
}

export default function HomeLoan({ transactions, loading, hideAmounts }: Props) {
  const { user } = useAuth();
  const [settings, setSettings] = useState<HomeLoanSettings | null>(null);
  const mask = (v: string) => (hideAmounts ? "••••••" : v);

  useEffect(() => {
    if (!user) return;
    return subscribeHomeLoanSettings(user.uid, setSettings, () => {});
  }, [user]);

  const summary = useMemo(
    () => computeHomeLoan(transactions, settings),
    [transactions, settings],
  );

  if (loading) {
    return <div className="text-sm text-neutral-500">Loading…</div>;
  }

  if (!summary.hasData) {
    return (
      <Panel title="Home Loan">
        <div className="space-y-2 text-sm text-neutral-400">
          <p>No home-loan statement imported yet.</p>
          <p className="text-neutral-500">
            Go to <strong>Import</strong>, choose institution{" "}
            <strong>Nedbank Home Loan</strong>, and drop your bond statement CSV. It's
            kept separate from your cash accounts so interest never counts as income.
          </p>
        </div>
      </Panel>
    );
  }

  const thisMonth = summary.months[0];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Outstanding owed"
          value={summary.outstanding != null ? mask(money(summary.outstanding)) : "-"}
          accent="negative"
          hint={
            summary.outstanding == null
              ? "Set your current balance below"
              : summary.asOf
                ? `anchored ${summary.asOf}, incl. later activity`
                : undefined
          }
        />
        <StatCard
          label="Access bond available"
          value={summary.available != null ? mask(money(summary.available)) : "-"}
          accent="positive"
          hint={summary.available == null ? "Set below" : "adjusts on bond transfers"}
        />
        <StatCard
          label={thisMonth ? `Interest (${thisMonth.label})` : "Interest"}
          value={thisMonth ? mask(money(thisMonth.interest)) : "-"}
          accent="negative"
          hint={`${money(summary.totalInterest)} charged in total`}
        />
        <StatCard
          label={thisMonth ? `Paid in (${thisMonth.label})` : "Paid in"}
          value={thisMonth ? mask(money(thisMonth.paid + thisMonth.transfersIn)) : "-"}
          accent="positive"
        />
      </div>

      <AnchorEditor settings={settings} uid={user?.uid} />

      <Panel title="Monthly breakdown">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-neutral-800 text-left text-xs uppercase tracking-wider text-neutral-500">
                <th className="py-2 pr-3 font-medium">Month</th>
                <th className="py-2 px-3 text-right font-medium">Interest</th>
                <th className="py-2 px-3 text-right font-medium">Insurance</th>
                <th className="py-2 px-3 text-right font-medium">Fees</th>
                <th className="py-2 px-3 text-right font-medium">Paid in</th>
                <th className="py-2 px-3 text-right font-medium">Bond ±</th>
                <th className="py-2 pl-3 text-right font-medium">Owed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-800/70">
              {summary.months.map((m) => (
                <MonthRow key={m.key} m={m} mask={mask} />
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-neutral-500">
          "Bond ±" is money moved in/out of the access bond (a deposit reduces what
          you owe; a withdrawal increases it). "Owed" is the balance at month-end,
          rolled back from the current balance you set above.
        </p>
      </Panel>
    </div>
  );
}

function MonthRow({ m, mask }: { m: MonthBreakdown; mask: (v: string) => string }) {
  const bond = m.transfersIn - m.transfersOut; // + = net into bond (reduces owed)
  return (
    <tr className="text-neutral-200">
      <td className="py-2.5 pr-3 font-medium">{m.label}</td>
      <td className="py-2.5 px-3 text-right tabular-nums text-rose-300/90">
        {m.interest ? mask(money(m.interest)) : "-"}
      </td>
      <td className="py-2.5 px-3 text-right tabular-nums text-neutral-400">
        {m.insurance ? mask(money(m.insurance)) : "-"}
      </td>
      <td className="py-2.5 px-3 text-right tabular-nums text-neutral-400">
        {m.fees ? mask(money(m.fees)) : "-"}
      </td>
      <td className="py-2.5 px-3 text-right tabular-nums text-emerald-300/90">
        {m.paid ? mask(money(m.paid)) : "-"}
      </td>
      <td className="py-2.5 px-3 text-right tabular-nums">
        {bond ? (
          <span className={bond > 0 ? "text-emerald-300/90" : "text-amber-300/90"}>
            {mask(`${bond > 0 ? "+" : "−"}${money(Math.abs(bond)).replace(/^-/, "")}`)}
          </span>
        ) : (
          "-"
        )}
      </td>
      <td className="py-2.5 pl-3 text-right font-medium tabular-nums">
        {m.closingOwed != null ? mask(money(m.closingOwed)) : "-"}
      </td>
    </tr>
  );
}

const inputCls =
  "rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-200 outline-none focus:border-indigo-500";

function AnchorEditor({
  settings,
  uid,
}: {
  settings: HomeLoanSettings | null;
  uid: string | undefined;
}) {
  const [balance, setBalance] = useState("");
  const [available, setAvailable] = useState("");
  const [asOf, setAsOf] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setBalance(settings ? String(settings.currentBalance) : "");
    setAvailable(settings?.available != null ? String(settings.available) : "");
    setAsOf(settings?.asOf ?? "");
  }, [settings]);

  async function save() {
    if (!uid) return;
    const v = Number(balance);
    if (!Number.isFinite(v) || v < 0) return;
    const av = available.trim() === "" ? null : Number(available);
    await saveHomeLoanSettings(uid, {
      currentBalance: Math.round(v * 100) / 100,
      available: av != null && Number.isFinite(av) && av >= 0 ? Math.round(av * 100) / 100 : null,
      asOf: asOf || null,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <Panel title="Current balance">
      <p className="mb-3 text-sm text-neutral-400">
        The bond statement has no balance column, so enter what you owe on the "as
        of" date. Statement lines dated after it (interest, payments, a withdrawal)
        are then applied automatically, so the headline stays current on import.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="mb-1 block text-neutral-400">Outstanding balance (R)</span>
          <input
            type="number"
            min="0"
            step="0.01"
            value={balance}
            onChange={(e) => setBalance(e.target.value)}
            placeholder="e.g. 1850000"
            className={`${inputCls} w-44`}
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-neutral-400">Access bond available (R)</span>
          <input
            type="number"
            min="0"
            step="0.01"
            value={available}
            onChange={(e) => setAvailable(e.target.value)}
            placeholder="e.g. 260559.42"
            className={`${inputCls} w-44`}
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-neutral-400">As of</span>
          <input
            type="date"
            value={asOf}
            onChange={(e) => setAsOf(e.target.value)}
            className={`${inputCls} w-44`}
          />
        </label>
        <button
          onClick={() => void save()}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500"
        >
          Save
        </button>
        {saved && <span className="text-sm text-emerald-400">Saved ✓</span>}
      </div>
    </Panel>
  );
}
