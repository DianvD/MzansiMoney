import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../auth";
import type { Goal, Holding, Transaction } from "../types";
import { computeBalance } from "../lib/metrics";
import { money } from "../lib/format";
import {
  addGoal, addHolding, deleteGoal, deleteHolding,
  saveGoal, saveHolding, subscribeGoals, subscribeHoldings,
} from "../lib/data";
import Panel from "../components/Panel";
import StatCard from "../components/StatCard";

interface Props {
  transactions: Transaction[];
  hideAmounts: boolean;
}

export default function Wealth({ transactions, hideAmounts }: Props) {
  const { user } = useAuth();
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const mask = (v: string) => (hideAmounts ? "••••••" : v);

  useEffect(() => {
    if (!user) return;
    const u1 = subscribeHoldings(user.uid, setHoldings, () => {});
    const u2 = subscribeGoals(user.uid, setGoals, () => {});
    return () => { u1(); u2(); };
  }, [user]);

  const cash = computeBalance(transactions) ?? 0;
  const assets = useMemo(() => holdings.filter((h) => h.type === "asset"), [holdings]);
  const liabilities = useMemo(() => holdings.filter((h) => h.type === "liability"), [holdings]);
  const assetTotal = assets.reduce((s, h) => s + (h.value || 0), 0);
  const liabTotal = liabilities.reduce((s, h) => s + (h.value || 0), 0);
  const netWorth = cash + assetTotal - liabTotal;

  if (!user) return null;
  const uid = user.uid;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Net worth" value={mask(money(netWorth))}
          accent={netWorth < 0 ? "negative" : "positive"} />
        <StatCard label="Cash (from accounts)" value={mask(money(cash))} />
        <StatCard label="Assets" value={mask(money(assetTotal))} accent="positive" />
        <StatCard label="Liabilities" value={mask(money(liabTotal))} accent="negative" />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <HoldingSection
          title="Assets" type="asset" items={assets} uid={uid} hideAmounts={hideAmounts}
          placeholder="e.g. Car, Property, Savings" />
        <HoldingSection
          title="Liabilities" type="liability" items={liabilities} uid={uid} hideAmounts={hideAmounts}
          placeholder="e.g. Car loan, Credit card" />
      </div>

      <GoalsSection goals={goals} uid={uid} hideAmounts={hideAmounts} />
    </div>
  );
}

const inputCls =
  "rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-200 outline-none focus:border-indigo-500";

function HoldingSection({ title, type, items, uid, hideAmounts, placeholder }: {
  title: string; type: "asset" | "liability"; items: Holding[]; uid: string;
  hideAmounts: boolean; placeholder: string;
}) {
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const mask = (v: string) => (hideAmounts ? "••••••" : v);

  async function add() {
    const v = Number(value);
    if (!name.trim() || !Number.isFinite(v) || v <= 0) return;
    await addHolding(uid, { type, name: name.trim(), value: Math.round(v * 100) / 100 });
    setName(""); setValue("");
  }

  return (
    <Panel title={title}>
      <ul className="divide-y divide-neutral-800">
        {items.map((h) => (
          <li key={h.id} className="flex items-center gap-3 py-2.5">
            <span className="flex-1 truncate text-sm text-neutral-200">{h.name}</span>
            <input
              type="number" defaultValue={h.value} min="0" step="0.01"
              onBlur={(e) => {
                const v = Number(e.target.value);
                if (Number.isFinite(v) && v >= 0 && v !== h.value) void saveHolding(uid, h.id, { value: v });
              }}
              className={`${inputCls} w-28 text-right tabular-nums`}
              aria-label={`${h.name} value`}
            />
            <button onClick={() => void deleteHolding(uid, h.id)}
              className="text-neutral-600 hover:text-rose-400" aria-label={`Delete ${h.name}`}>✕</button>
          </li>
        ))}
        {items.length === 0 && <li className="py-3 text-sm text-neutral-600">None yet.</li>}
      </ul>
      <div className="mt-3 flex gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={placeholder}
          className={`${inputCls} flex-1`} />
        <input value={value} onChange={(e) => setValue(e.target.value)} type="number" min="0" step="0.01"
          placeholder="R" className={`${inputCls} w-24`} />
        <button onClick={() => void add()}
          className="rounded-lg bg-indigo-600 px-3 text-sm font-semibold text-white hover:bg-indigo-500">Add</button>
      </div>
      <div className="mt-2 text-right text-xs text-neutral-500">
        Total {mask(money(items.reduce((s, h) => s + (h.value || 0), 0)))}
      </div>
    </Panel>
  );
}

function GoalsSection({ goals, uid, hideAmounts }: { goals: Goal[]; uid: string; hideAmounts: boolean }) {
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const mask = (v: string) => (hideAmounts ? "••••••" : v);

  async function add() {
    const t = Number(target);
    if (!name.trim() || !Number.isFinite(t) || t <= 0) return;
    await addGoal(uid, { name: name.trim(), target: Math.round(t * 100) / 100, current: 0 });
    setName(""); setTarget("");
  }

  return (
    <Panel title="Savings goals">
      <ul className="space-y-4">
        {goals.map((g) => {
          const pct = g.target > 0 ? Math.min(100, Math.round((g.current / g.target) * 100)) : 0;
          return (
            <li key={g.id}>
              <div className="flex items-center gap-3">
                <span className="flex-1 truncate text-sm font-medium text-neutral-200">{g.name}</span>
                <input
                  type="number" defaultValue={g.current} min="0" step="0.01"
                  onBlur={(e) => {
                    const v = Number(e.target.value);
                    if (Number.isFinite(v) && v >= 0 && v !== g.current) void saveGoal(uid, g.id, { current: v });
                  }}
                  className={`${inputCls} w-28 text-right tabular-nums`} aria-label={`${g.name} current amount`}
                />
                <span className="w-32 text-right text-xs text-neutral-500">/ {mask(money(g.target))}</span>
                <button onClick={() => void deleteGoal(uid, g.id)}
                  className="text-neutral-600 hover:text-rose-400" aria-label={`Delete ${g.name}`}>✕</button>
              </div>
              <div className="mt-1.5 flex items-center gap-2">
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-neutral-800">
                  <div className="h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
                </div>
                <span className="w-10 text-right text-xs tabular-nums text-neutral-400">{pct}%</span>
              </div>
            </li>
          );
        })}
        {goals.length === 0 && <li className="text-sm text-neutral-600">No goals yet. Add one below.</li>}
      </ul>
      <div className="mt-4 flex gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Germany trip, Emergency fund"
          className={`${inputCls} flex-1`} />
        <input value={target} onChange={(e) => setTarget(e.target.value)} type="number" min="0" step="0.01"
          placeholder="Target R" className={`${inputCls} w-28`} />
        <button onClick={() => void add()}
          className="rounded-lg bg-indigo-600 px-3 text-sm font-semibold text-white hover:bg-indigo-500">Add</button>
      </div>
    </Panel>
  );
}
