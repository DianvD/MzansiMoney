import { useState } from "react";
import { ALL_ACCOUNTS, type Account } from "../lib/accounts";
import { money } from "../lib/format";

interface Props {
  accounts: Account[];
  selectedAccountId: string;
  defaultAccountId: string | null;
  hideAmounts: boolean;
  onSelect: (accountId: string) => void;
  onSetDefault: (accountId: string) => void;
}

/** Top-bar account picker. Lists "All accounts" + each derived cash account, with
 * its latest balance and a default marker. Only renders when there's more than one
 * account (with a single account there's nothing to switch). */
export default function AccountSwitcher({
  accounts,
  selectedAccountId,
  defaultAccountId,
  hideAmounts,
  onSelect,
  onSetDefault,
}: Props) {
  const [open, setOpen] = useState(false);
  if (accounts.length < 2) return null;

  const current =
    selectedAccountId === ALL_ACCOUNTS
      ? null
      : accounts.find((a) => a.accountId === selectedAccountId);
  const currentLabel = current ? current.label : "All accounts";
  const mask = (v: string) => (hideAmounts ? "••••" : v);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex max-w-[12rem] items-center gap-1.5 rounded-lg border border-neutral-700 bg-neutral-800/70 px-2.5 py-1.5 text-sm text-neutral-200 hover:bg-neutral-800"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="truncate font-medium">{currentLabel}</span>
        <span className="text-neutral-500">▾</span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-40 mt-1 w-64 overflow-hidden rounded-xl border border-neutral-700 bg-neutral-900 shadow-2xl">
            <button
              onClick={() => { onSelect(ALL_ACCOUNTS); setOpen(false); }}
              className={`flex w-full items-center justify-between px-3 py-2.5 text-left text-sm hover:bg-neutral-800 ${
                selectedAccountId === ALL_ACCOUNTS ? "bg-indigo-500/10 text-indigo-200" : "text-neutral-200"
              }`}
            >
              <span className="font-medium">All accounts</span>
              <span className="text-xs text-neutral-500">{accounts.length} accounts</span>
            </button>
            <div className="border-t border-neutral-800" />
            {accounts.map((a) => {
              const active = a.accountId === selectedAccountId;
              const isDefault = a.accountId === defaultAccountId;
              return (
                <div
                  key={a.accountId}
                  className={`group flex items-center gap-2 px-3 py-2.5 text-sm hover:bg-neutral-800 ${
                    active ? "bg-indigo-500/10" : ""
                  }`}
                >
                  <button
                    onClick={() => { onSelect(a.accountId); setOpen(false); }}
                    className="min-w-0 flex-1 text-left"
                  >
                    <div className={`flex items-center gap-1.5 truncate font-medium ${active ? "text-indigo-200" : "text-neutral-200"}`}>
                      <span className="truncate">{a.label}</span>
                      {isDefault && <span className="shrink-0 rounded bg-neutral-800 px-1 text-[10px] font-semibold text-neutral-400">default</span>}
                    </div>
                    <div className="truncate text-xs text-neutral-500">
                      {a.institution && a.institution !== a.label ? `${a.institution} · ` : ""}
                      {a.count} txns{a.balance != null ? ` · ${mask(money(a.balance))}` : ""}
                    </div>
                  </button>
                  {!isDefault && (
                    <button
                      onClick={() => onSetDefault(a.accountId)}
                      title="Set as default account for imports"
                      className="shrink-0 rounded px-1.5 py-0.5 text-[11px] text-neutral-500 opacity-0 hover:bg-neutral-700 hover:text-neutral-200 group-hover:opacity-100"
                    >
                      Set default
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
