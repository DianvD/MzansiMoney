import type { Transaction } from "../types";
import { MASK, shortDate, signedMoney, tsToDate } from "../lib/format";
import MerchantAvatar from "./MerchantAvatar";

// A debit at/above this reads as a "big one" and goes red. Tuned to the owner's data:
// everyday spend is a few hundred rand, so this catches rent, the bond, big
// premiums and large transfers without colouring normal life.
const BIG_SPEND = 1500;

interface Props {
  transactions: Transaction[];
  hideAmounts?: boolean;
  onEditCategory?: (t: Transaction) => void;
}

export default function TransactionList({ transactions, hideAmounts, onEditCategory }: Props) {
  if (transactions.length === 0) {
    return (
      <div className="py-10 text-center text-sm text-neutral-500">
        No transactions yet. Import a CSV to get started.
      </div>
    );
  }

  return (
    <ul className="divide-y divide-neutral-800">
      {transactions.map((t) => {
        const isCredit = t.direction === "credit";
        // Keep outgoing calm; only a genuinely big debit goes red, so red actually
        // means "ouch" instead of painting every spend alarming.
        const bigHit = !isCredit && t.amount >= BIG_SPEND;
        const amountClass = isCredit ? "text-emerald-400" : bigHit ? "text-rose-400" : "text-neutral-300";
        return (
          <li key={t.id} className="flex items-center gap-4 py-3">
            <MerchantAvatar merchant={t.merchant} category={t.category} size={36} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-neutral-200">
                {t.merchant}
              </div>
              <div className="truncate text-xs text-neutral-500">
                {(() => { const d = tsToDate(t.date); return d ? shortDate(d) : "-"; })()} ·{" "}
                {onEditCategory ? (
                  <button
                    onClick={() => onEditCategory(t)}
                    className="rounded text-indigo-400 underline-offset-2 hover:underline"
                    title="Change category"
                  >
                    {t.category}
                  </button>
                ) : (
                  t.category
                )}
              </div>
            </div>
            <div className={`shrink-0 text-sm font-semibold tabular-nums ${amountClass}`}>
              {hideAmounts ? MASK : signedMoney(t.signedAmount)}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
