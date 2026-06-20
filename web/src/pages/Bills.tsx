import { useMemo } from "react";
import type { Bill } from "../types";
import { groupBills, sumBills, type BillStatus } from "../lib/bills";
import { MASK, money, shortDate, tsToDate } from "../lib/format";
import Panel from "../components/Panel";
import MerchantAvatar from "../components/MerchantAvatar";

interface Props {
  bills: Bill[];
  loading: boolean;
  hideAmounts: boolean;
  now: Date;
}

const SECTIONS: { key: BillStatus; title: string; tone: string }[] = [
  { key: "overdue", title: "Overdue", tone: "text-rose-400" },
  { key: "upcoming", title: "Upcoming", tone: "text-neutral-200" },
  { key: "paid", title: "Paid", tone: "text-emerald-400" },
];

export default function Bills({ bills, loading, hideAmounts, now }: Props) {
  const grouped = useMemo(() => groupBills(bills, now), [bills, now]);
  const mask = (v: string) => (hideAmounts ? MASK : v);

  if (loading) return <div className="py-20 text-center text-neutral-500">Loading…</div>;

  if (bills.length === 0)
    return (
      <Panel title="Bills">
        <div className="py-10 text-center text-sm text-neutral-500">
          No bills yet. Import an invoice PDF on the Import tab and it appears here.
        </div>
      </Panel>
    );

  return (
    <div className="space-y-6">
      {SECTIONS.map(({ key, title, tone }) => {
        const items = grouped[key];
        if (items.length === 0) return null;
        return (
          <Panel
            key={key}
            title={`${title} · ${items.length}`}
            action={<span className={`text-sm font-semibold tabular-nums ${tone}`}>
              {mask(money(sumBills(items)))}
            </span>}
          >
            <ul className="divide-y divide-neutral-800">
              {items.map((b) => (
                <li key={b.id} className="flex items-center gap-4 py-3">
                  <MerchantAvatar merchant={b.institution} category={b.category} size={36} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-neutral-200">
                      {b.institution}
                      {b.docNumber ? <span className="text-neutral-500"> · {b.docNumber}</span> : null}
                    </div>
                    <div className="truncate text-xs text-neutral-500">
                      {b.category}
                      {(() => { const d = tsToDate(b.dueDate); return d ? ` · due ${shortDate(d)}` : " · no due date"; })()}
                    </div>
                  </div>
                  <div className={`shrink-0 text-sm font-semibold tabular-nums ${tone}`}>
                    {mask(money(b.amount))}
                  </div>
                </li>
              ))}
            </ul>
          </Panel>
        );
      })}
    </div>
  );
}
