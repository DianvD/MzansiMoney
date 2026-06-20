import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useAuth } from "./auth";
import {
  subscribeBills,
  subscribeTransactions,
  subscribeNavOrder,
  saveNavOrder,
  subscribeAccountPrefs,
  saveSelectedAccount,
  saveDefaultAccount,
} from "./lib/data";
import type { Bill, Transaction } from "./types";
import { deriveAccounts, ALL_ACCOUNTS } from "./lib/accounts";
import AccountSwitcher from "./components/AccountSwitcher";
import { useBranding } from "./branding/context";
import Dashboard from "./pages/Dashboard";
import Import from "./pages/Import";
import Bills from "./pages/Bills";
import Transactions from "./pages/Transactions";
import Recurring from "./pages/Recurring";
import Wealth from "./pages/Wealth";
import HomeLoan from "./pages/HomeLoan";
import ErrorBoundary from "./components/ErrorBoundary";
import LockGate, { useLock } from "./components/LockGate";
import SecuritySettings from "./components/SecuritySettings";
import BrandingSettings from "./components/BrandingSettings";
import Nav, { NAV_ITEMS } from "./components/Nav";
import { Icon } from "./components/icons";

type View = "dashboard" | "transactions" | "bills" | "debits" | "wealth" | "homeloan" | "import";

export default function App() {
  const { user, loading: authLoading, signIn, signOut } = useAuth();
  const { branding } = useBranding();
  const [view, setView] = useState<View>("dashboard");
  const [hideAmounts, setHideAmounts] = useState(false);
  const [securityOpen, setSecurityOpen] = useState(false);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [txnsLoading, setTxnsLoading] = useState(true);
  const [bills, setBills] = useState<Bill[]>([]);
  const [billsLoading, setBillsLoading] = useState(true);
  const [navOrder, setNavOrder] = useState<string[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string>(ALL_ACCOUNTS);
  const [defaultAccountId, setDefaultAccountId] = useState<string | null>(null);
  const [accountLabels, setAccountLabels] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  // "now" drives month math and bill overdue/upcoming status. Refresh it when the
  // window regains focus so a dashboard left open overnight doesn't go stale.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const update = () => setNow(new Date());
    window.addEventListener("focus", update);
    return () => window.removeEventListener("focus", update);
  }, []);

  useEffect(() => {
    if (!user) {
      setTransactions([]);
      setBills([]);
      setTxnsLoading(false);
      setBillsLoading(false);
      return;
    }
    setTxnsLoading(true);
    setBillsLoading(true);
    const unsubTxns = subscribeTransactions(
      user.uid,
      (txns) => { setTransactions(txns); setTxnsLoading(false); setError(null); },
      (err) => { setError(err.message); setTxnsLoading(false); },
    );
    const unsubBills = subscribeBills(
      user.uid,
      (b) => { setBills(b); setBillsLoading(false); setError(null); },
      (err) => { setError(err.message); setBillsLoading(false); },
    );
    return () => { unsubTxns(); unsubBills(); };
  }, [user]);

  useEffect(() => {
    if (!user) { setNavOrder([]); return; }
    return subscribeNavOrder(user.uid, setNavOrder, () => {});
  }, [user]);

  useEffect(() => {
    if (!user) {
      setSelectedAccountId(ALL_ACCOUNTS);
      setDefaultAccountId(null);
      setAccountLabels({});
      return;
    }
    return subscribeAccountPrefs(
      user.uid,
      (p) => { setSelectedAccountId(p.selectedAccountId); setDefaultAccountId(p.defaultAccountId); setAccountLabels(p.labels); },
      () => {},
    );
  }, [user]);

  // Accounts are derived from the data - distinct cash accountIds. (Hook: stays
  // above the early returns.)
  const accounts = useMemo(
    () => deriveAccounts(transactions.filter((t) => t.accountType !== "home_loan"), accountLabels),
    [transactions, accountLabels],
  );

  // Apply the saved nav order, appending any items not yet in it (so a newly
  // added page still shows up). Must stay above the early returns - it's a hook.
  const orderedNav = useMemo(() => {
    const byKey = new Map<string, (typeof NAV_ITEMS)[number]>(NAV_ITEMS.map((i) => [i.key, i]));
    const ordered = navOrder.map((k) => byKey.get(k)).filter(Boolean) as (typeof NAV_ITEMS)[number][];
    const seen = new Set(ordered.map((i) => i.key));
    for (const i of NAV_ITEMS) if (!seen.has(i.key)) ordered.push(i);
    return ordered;
  }, [navOrder]);

  if (authLoading) {
    return (
      <div className="flex h-full items-center justify-center text-neutral-500">
        Loading…
      </div>
    );
  }

  if (!user) return <SignIn onSignIn={signIn} />;

  const go = (v: string) => setView(v as View);
  const reorderNav = (keys: string[]) => { if (user) void saveNavOrder(user.uid, keys); };

  // Keep the home-loan (liability) account out of every cash view: its interest
  // must never read as income and its "balance owed" must never net against cash.
  // Older transactions have no accountType - they're cash.
  const cashTxns = transactions.filter((t) => t.accountType !== "home_loan");
  const homeLoanTxns = transactions.filter((t) => t.accountType === "home_loan");

  // The selected-account lens. If the saved selection points at an account that no
  // longer exists (e.g. it was reverted), fall back to All. Bills are paid from the
  // default account, so they only show on All / the default view.
  const selected = accounts.some((a) => a.accountId === selectedAccountId) ? selectedAccountId : ALL_ACCOUNTS;
  const viewCashTxns = selected === ALL_ACCOUNTS ? cashTxns : cashTxns.filter((t) => t.accountId === selected);
  const viewBills = selected === ALL_ACCOUNTS || selected === defaultAccountId ? bills : [];

  return (
    <LockGate uid={user.uid}>
      <div className="flex min-h-screen bg-neutral-950">
        {/* Desktop sidebar */}
        <aside className="hidden w-60 shrink-0 border-r border-neutral-800/80 lg:block">
          <div className="sticky top-0 h-screen">
            <Nav view={view} items={orderedNav} onReorder={reorderNav} onNavigate={go} onSecurity={() => setSecurityOpen(true)} onAppearance={() => setAppearanceOpen(true)} onSignOut={() => void signOut()} />
          </div>
        </aside>

        {/* Mobile drawer */}
        {drawerOpen && (
          <div className="fixed inset-0 z-40 lg:hidden">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setDrawerOpen(false)} />
            <div className="absolute left-0 top-0 h-full w-64 border-r border-neutral-800 bg-neutral-950 shadow-2xl">
              <Nav
                view={view}
                items={orderedNav}
                onReorder={reorderNav}
                onNavigate={(v) => { go(v); setDrawerOpen(false); }}
                onSecurity={() => { setSecurityOpen(true); setDrawerOpen(false); }}
                onAppearance={() => { setAppearanceOpen(true); setDrawerOpen(false); }}
                onSignOut={() => void signOut()}
                onClose={() => setDrawerOpen(false)}
              />
            </div>
          </div>
        )}

        {/* Main column */}
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-neutral-800/80 bg-neutral-950/80 px-4 py-3 backdrop-blur sm:px-6">
            <button
              onClick={() => setDrawerOpen(true)}
              aria-label="Open menu"
              className="-ml-1 rounded-lg p-1.5 text-neutral-300 hover:bg-neutral-800 lg:hidden"
            >
              <Icon name="menu" />
            </button>
            <h1 className="text-base font-semibold text-white sm:text-lg">{titleFor(view)}</h1>
            <div className="ml-auto flex items-center gap-2">
              <AccountSwitcher
                accounts={accounts}
                selectedAccountId={selected}
                defaultAccountId={defaultAccountId}
                hideAmounts={hideAmounts}
                onSelect={(id) => { setSelectedAccountId(id); if (user) void saveSelectedAccount(user.uid, id); }}
                onSetDefault={(id) => { setDefaultAccountId(id); if (user) void saveDefaultAccount(user.uid, id); }}
              />
              <div className="flex items-center gap-1.5">
                <IconButton onClick={() => setHideAmounts((v) => !v)} label={hideAmounts ? "Show balances" : "Hide balances"}>
                  <Icon name={hideAmounts ? "eyeOff" : "eye"} />
                </IconButton>
                <LockButton />
              </div>
            </div>
          </header>

          {securityOpen && <SecuritySettings onClose={() => setSecurityOpen(false)} />}
          {appearanceOpen && <BrandingSettings onClose={() => setAppearanceOpen(false)} />}

          <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6">
            {error && (
              <div className="mb-4 rounded-xl border border-rose-900 bg-rose-950/50 px-4 py-3 text-sm text-rose-300">
                {error}
              </div>
            )}
            {!txnsLoading && !billsLoading && transactions.length === 0 && bills.length === 0 && (
              <div className="mb-6 flex flex-col items-start gap-3 rounded-2xl border border-indigo-900/60 bg-gradient-to-br from-indigo-950/40 to-neutral-900/40 px-5 py-4 sm:flex-row sm:items-center">
                <div className="flex-1">
                  <div className="text-sm font-semibold text-indigo-200">Welcome to {branding.name} 👋</div>
                  <div className="text-sm text-indigo-300/80">
                    Import a bank CSV or an invoice PDF and your dashboard fills in. Everything is deduplicated.
                  </div>
                </div>
                <button
                  onClick={() => go("import")}
                  className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500"
                >
                  Import data
                </button>
              </div>
            )}

            <ErrorBoundary>
              {view === "dashboard" && (
                <Dashboard
                  transactions={viewCashTxns}
                  bills={viewBills}
                  loading={txnsLoading}
                  billsLoading={billsLoading}
                  hideAmounts={hideAmounts}
                  now={now}
                />
              )}
              {view === "transactions" && (
                <Transactions transactions={viewCashTxns} loading={txnsLoading} hideAmounts={hideAmounts} />
              )}
              {view === "bills" && (
                <Bills bills={bills} loading={billsLoading} hideAmounts={hideAmounts} now={now} />
              )}
              {view === "debits" && (
                <Recurring transactions={viewCashTxns} loading={txnsLoading} hideAmounts={hideAmounts} />
              )}
              {view === "wealth" && <Wealth transactions={cashTxns} hideAmounts={hideAmounts} />}
              {view === "homeloan" && (
                <HomeLoan transactions={homeLoanTxns} loading={txnsLoading} hideAmounts={hideAmounts} />
              )}
              {view === "import" && <Import accounts={accounts} defaultAccountId={defaultAccountId} />}
            </ErrorBoundary>
          </main>
        </div>
      </div>
    </LockGate>
  );
}

function titleFor(view: string): string {
  return NAV_ITEMS.find((i) => i.key === view)?.label ?? "MzansiMoney";
}

function IconButton({
  onClick,
  label,
  children,
}: {
  onClick: () => void;
  label: string;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className="rounded-lg p-1.5 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
    >
      {children}
    </button>
  );
}

function LockButton() {
  const { lock } = useLock();
  return (
    <IconButton onClick={lock} label="Lock app">
      <Icon name="lock" />
    </IconButton>
  );
}

function SignIn({ onSignIn }: { onSignIn: () => Promise<void> }) {
  const { branding } = useBranding();
  return (
    <div className="flex h-full min-h-screen flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-2xl border border-neutral-800 bg-neutral-900/60 p-8 text-center">
        <div className="text-3xl font-bold tracking-tight text-white">
          {branding.emoji && <span className="mr-1.5">{branding.emoji}</span>}
          {branding.name}<span className="text-indigo-500">.</span>
        </div>
        <p className="mt-2 text-sm text-neutral-400">
          {branding.tagline || "Your personal finance operating system."}
        </p>
        <button
          onClick={() => void onSignIn()}
          className="mt-6 w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500"
        >
          Continue with Google
        </button>
      </div>
    </div>
  );
}
