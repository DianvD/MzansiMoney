import { useState } from "react";
import { Icon } from "./icons";
import { useBranding } from "../branding/context";

export const NAV_ITEMS = [
  { key: "dashboard", label: "Dashboard", icon: "dashboard" },
  { key: "transactions", label: "Transactions", icon: "transactions" },
  { key: "bills", label: "Bills", icon: "bills" },
  { key: "debits", label: "Recurring", icon: "recurring" },
  { key: "wealth", label: "Net Worth", icon: "wealth" },
  { key: "homeloan", label: "Home Loan", icon: "home" },
  { key: "import", label: "Import", icon: "import" },
] as const;

interface NavItem {
  key: string;
  label: string;
  icon: string;
}

interface Props {
  view: string;
  items: readonly NavItem[];
  onReorder: (keys: string[]) => void;
  onNavigate: (view: string) => void;
  onSecurity: () => void;
  onAppearance: () => void;
  onSignOut: () => void;
  onClose?: () => void;
}

export default function Nav({ view, items, onReorder, onNavigate, onSecurity, onAppearance, onSignOut, onClose }: Props) {
  const [editing, setEditing] = useState(false);
  const { branding } = useBranding();

  function move(index: number, dir: -1 | 1) {
    const keys = items.map((i) => i.key);
    const j = index + dir;
    if (j < 0 || j >= keys.length) return;
    [keys[index], keys[j]] = [keys[j], keys[index]];
    onReorder(keys);
  }

  return (
    <div className="flex h-full flex-col px-3 py-4">
      <div className="flex items-center justify-between px-2 pb-4">
        <span className="text-2xl font-bold tracking-tight text-white">
          {branding.emoji && <span className="mr-1">{branding.emoji}</span>}
          {branding.name}<span className="text-indigo-500">.</span>
        </span>
        {onClose && (
          <button
            onClick={onClose}
            aria-label="Close menu"
            className="rounded-lg p-1.5 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200 lg:hidden"
          >
            <Icon name="close" />
          </button>
        )}
      </div>

      <nav className="flex flex-1 flex-col gap-1">
        {items.map((item, index) => {
          const active = view === item.key;
          if (editing) {
            return (
              <div
                key={item.key}
                className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-neutral-300"
              >
                <Icon name={item.icon} className="text-neutral-500" />
                <span className="flex-1 truncate">{item.label}</span>
                <button
                  onClick={() => move(index, -1)}
                  disabled={index === 0}
                  aria-label={`Move ${item.label} up`}
                  className="rounded p-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200 disabled:opacity-30"
                >
                  <Icon name="chevron" size={16} className="rotate-180" />
                </button>
                <button
                  onClick={() => move(index, 1)}
                  disabled={index === items.length - 1}
                  aria-label={`Move ${item.label} down`}
                  className="rounded p-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200 disabled:opacity-30"
                >
                  <Icon name="chevron" size={16} />
                </button>
              </div>
            );
          }
          return (
            <button
              key={item.key}
              onClick={() => onNavigate(item.key)}
              aria-current={active ? "page" : undefined}
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                active
                  ? "bg-indigo-500/15 text-white"
                  : "text-neutral-400 hover:bg-neutral-800/70 hover:text-neutral-200"
              }`}
            >
              <Icon name={item.icon} className={active ? "text-indigo-400" : ""} />
              {item.label}
            </button>
          );
        })}
      </nav>

      <div className="mt-auto flex flex-col gap-1 border-t border-neutral-800/70 pt-3">
        <button
          onClick={() => setEditing((v) => !v)}
          className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
            editing
              ? "bg-indigo-500/15 text-indigo-200"
              : "text-neutral-400 hover:bg-neutral-800/70 hover:text-neutral-200"
          }`}
        >
          <Icon name="recurring" /> {editing ? "Done reordering" : "Reorder menu"}
        </button>
        <button
          onClick={onAppearance}
          className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-neutral-400 transition hover:bg-neutral-800/70 hover:text-neutral-200"
        >
          <span className="ml-0.5 inline-block h-4 w-4 rounded-full bg-indigo-500" /> Appearance
        </button>
        <button
          onClick={onSecurity}
          className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-neutral-400 transition hover:bg-neutral-800/70 hover:text-neutral-200"
        >
          <Icon name="shield" /> Security
        </button>
        <button
          onClick={onSignOut}
          className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-neutral-400 transition hover:bg-neutral-800/70 hover:text-neutral-200"
        >
          <Icon name="logout" /> Sign out
        </button>
      </div>
    </div>
  );
}
