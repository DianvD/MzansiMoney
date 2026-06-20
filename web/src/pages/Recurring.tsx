import { useEffect, useMemo, useState } from "react";
import type { RecurringLists, Transaction } from "../types";
import { useAuth } from "../auth";
import { classifyRecurring, detectRecurring, latestAmount, type Recurring, type RecurringKind } from "../lib/recurring";
import { saveRecurringLists, subscribeRecurringLists } from "../lib/data";
import { money, shortDate } from "../lib/format";
import { Icon } from "../components/icons";
import MerchantAvatar from "../components/MerchantAvatar";

interface Props {
  transactions: Transaction[];
  loading: boolean;
  hideAmounts: boolean;
}

const SECTIONS: { kind: RecurringKind; title: string; blurb: string; defaultOpen: boolean }[] = [
  { kind: "important", title: "Important", blurb: "Recurring payments you want to keep an eye on. Move things here in Edit.", defaultOpen: true },
  { kind: "debit", title: "Debit Orders", blurb: "Company-controlled mandates (medical, insurance, loan) - hard to stop.", defaultOpen: true },
  { kind: "subscription", title: "Subscriptions", blurb: "Automatic each month, but you can cancel or change card (Claude, internet…).", defaultOpen: true },
  { kind: "transfer", title: "Transfers", blurb: "Money moved between your own accounts (e.g. into your home loan). Not spending.", defaultOpen: true },
  { kind: "other", title: "Other recurring", blurb: "Everything else that recurs across months (groceries, fuel…).", defaultOpen: false },
];

export default function Recurring({ transactions, loading, hideAmounts }: Props) {
  const { user } = useAuth();
  const [lists, setLists] = useState<RecurringLists>({ important: [], debitOrders: [], subscriptions: [], transfers: [] });
  const [editing, setEditing] = useState(false);
  const [openItem, setOpenItem] = useState<string | null>(null);
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});
  const mask = (v: string) => (hideAmounts ? "••••••" : v);

  useEffect(() => {
    if (!user) return;
    return subscribeRecurringLists(user.uid, setLists, () => {});
  }, [user]);

  const detected = useMemo(() => detectRecurring(transactions), [transactions]);
  const buckets = useMemo(() => classifyRecurring(detected, lists), [detected, lists]);

  function setKind(merchant: string, kind: RecurringKind) {
    if (!user) return;
    const m = merchant.toLowerCase();
    // Drop any existing keyword that matches this merchant from every list, then
    // add it (full name = precise) to the chosen one. "other" just removes it.
    const drop = (ks: string[]) => ks.filter((k) => !m.includes(k.toLowerCase()));
    const next: RecurringLists = {
      important: drop(lists.important),
      debitOrders: drop(lists.debitOrders),
      subscriptions: drop(lists.subscriptions),
      transfers: drop(lists.transfers),
    };
    if (kind === "important") next.important.push(merchant);
    if (kind === "debit") next.debitOrders.push(merchant);
    if (kind === "subscription") next.subscriptions.push(merchant);
    if (kind === "transfer") next.transfers.push(merchant);
    void saveRecurringLists(user.uid, next);
  }

  if (loading) return <div className="py-20 text-center text-neutral-500">Loading…</div>;

  if (detected.length === 0)
    return (
      <section className="rounded-2xl border border-neutral-800 bg-neutral-900/60 p-5">
        <h2 className="mb-2 text-sm font-semibold text-neutral-300">Recurring</h2>
        <div className="py-8 text-center text-sm text-neutral-500">
          Nothing recurring yet. Once a couple of months of statements are imported, your debit
          orders, subscriptions and recurring spend show up here.
        </div>
      </section>
    );

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <p className="text-sm text-neutral-400">
          Your automatic & recurring payments, grouped. Tap <span className="text-indigo-300">Edit</span> to move an item between Debit Orders and Subscriptions.
        </p>
        <button
          onClick={() => setEditing((v) => !v)}
          className="shrink-0 rounded-lg border border-neutral-700 px-3 py-1.5 text-xs font-medium text-neutral-300 hover:bg-neutral-800"
        >
          {editing ? "Done" : "Edit"}
        </button>
      </div>

      {SECTIONS.map((s) => {
        const items = buckets[s.kind];
        const open = openSections[s.kind] ?? s.defaultOpen;
        const subtotal = items.reduce((sum, r) => sum + latestAmount(r), 0);
        return (
          <section key={s.kind} className="rounded-2xl border border-neutral-800 bg-neutral-900/60 p-5">
            <button
              onClick={() => setOpenSections((o) => ({ ...o, [s.kind]: !open }))}
              aria-expanded={open}
              className="flex w-full items-center justify-between gap-3 text-left"
            >
              <span className="flex items-center gap-2">
                <Icon name="chevron" size={16} className={`text-neutral-500 transition-transform ${open ? "" : "-rotate-90"}`} />
                <span className="text-sm font-semibold text-neutral-300">{s.title}</span>
                <span className="text-xs text-neutral-500">{items.length}</span>
              </span>
              <span className="text-xs tabular-nums text-neutral-400">≈ {mask(money(subtotal))}/mo</span>
            </button>

            {open && (
              <>
                <p className="mt-1 pl-6 text-xs text-neutral-600">{s.blurb}</p>
                {items.length === 0 ? (
                  <div className="py-4 pl-6 text-sm text-neutral-600">None.</div>
                ) : (
                  <ul className="mt-2 divide-y divide-neutral-800">
                    {items.map((r) => (
                      <li key={r.key}>
                        <div className="flex items-center gap-3 py-3">
                          <button
                            onClick={() => setOpenItem(openItem === r.key ? null : r.key)}
                            className="flex min-w-0 flex-1 items-center gap-3 text-left"
                          >
                            <MerchantAvatar merchant={r.merchant} category={r.category} size={36} />
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-sm font-medium text-neutral-200">{r.merchant}</div>
                              <div className="truncate text-xs text-neutral-500">
                                {r.category} · {r.count}× · last {shortDate(r.lastDate)}
                              </div>
                            </div>
                            <div className="shrink-0 text-right">
                              <div className="text-sm font-semibold tabular-nums text-neutral-200">{mask(money(latestAmount(r)))}</div>
                              <div className="text-xs text-neutral-500">latest</div>
                            </div>
                          </button>
                        </div>
                        {editing && <KindPicker current={s.kind} onPick={(k) => setKind(r.merchant, k)} />}
                        {openItem === r.key && <Detail r={r} hideAmounts={hideAmounts} />}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </section>
        );
      })}
    </div>
  );
}

const KIND_LABEL: Record<RecurringKind, string> = {
  important: "Important",
  debit: "Debit order",
  subscription: "Subscription",
  transfer: "Transfer",
  other: "Other",
};

function KindPicker({ current, onPick }: { current: RecurringKind; onPick: (k: RecurringKind) => void }) {
  return (
    <div className="flex flex-wrap gap-2 pb-3 pl-12">
      {(["important", "debit", "subscription", "transfer", "other"] as RecurringKind[]).map((k) => (
        <button
          key={k}
          onClick={() => onPick(k)}
          className={`rounded-full px-2.5 py-1 text-xs font-medium ${
            k === current
              ? "bg-indigo-500/20 text-indigo-300"
              : "border border-neutral-700 text-neutral-400 hover:bg-neutral-800"
          }`}
        >
          {KIND_LABEL[k]}
        </button>
      ))}
    </div>
  );
}

function Detail({ r, hideAmounts }: { r: Recurring; hideAmounts: boolean }) {
  const mask = (v: string) => (hideAmounts ? "••••••" : v);
  return (
    <div className="mb-3 ml-12 rounded-xl border border-neutral-800 bg-neutral-900/60 p-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Mini label="Typical" value={mask(money(r.typical))} />
        <Mini label="Range" value={r.min === r.max ? "Fixed" : `${mask(money(r.min))}-${mask(money(r.max))}`} />
        <Mini label="Times" value={`${r.count} (${r.months} mo)`} />
        <Mini label="Total paid" value={mask(money(r.total))} />
      </div>
      <div className="mt-3 text-xs font-medium uppercase tracking-wider text-neutral-500">History</div>
      <ul className="mt-1 divide-y divide-neutral-800/70">
        {r.occurrences.map((o, i) => (
          <li key={i} className="flex items-center justify-between py-1.5 text-sm">
            <span className="text-neutral-400">{shortDate(o.date)}</span>
            <span className="tabular-nums text-neutral-200">{mask(money(o.amount))}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-neutral-500">{label}</div>
      <div className="text-sm font-semibold tabular-nums text-neutral-200">{value}</div>
    </div>
  );
}
