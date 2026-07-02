import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAuth } from "./auth";
import {
  subscribeBills,
  subscribeTransactions,
  loadOlderTransactions,
  subscribeUiSettings,
  saveNavOrder,
  saveSelectedAccount,
  saveDefaultAccount,
  type TxnCursor,
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
import PullToRefresh from "./components/PullToRefresh";
import Nav, { NAV_ITEMS } from "./components/Nav";
import { Icon } from "./components/icons";
import { isOwner } from "./firebase";

type View = "dashboard" | "transactions" | "bills" | "debits" | "wealth" | "homeloan" | "import";

export default function App() {
  const { user, loading: authLoading, signIn, signOut } = useAuth();
  const { branding } = useBranding();
  const [view, setView] = useState<View>("dashboard");
  const [hideAmounts, setHideAmounts] = useState(false);
  const [securityOpen, setSecurityOpen] = useState(false);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Transaction state: live page + merged older pages.
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [txnsLoading, setTxnsLoading] = useState(true);
  const [olderTxns, setOlderTxns] = useState<Transaction[]>([]);
  const [olderCursor, setOlderCursor] = useState<TxnCursor | undefined>();
  const [loadingOlder, setLoadingOlder] = useState(false);
  const liveLastDocRef = useRef<TxnCursor | undefined>();
  const firstLoad = useRef(true);

  const [bills, setBills] = useState<Bill[]>([]);
  const [billsLoading, setBillsLoading] = useState(true);

  const [navOrder, setNavOrder] = useState<string[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string>(ALL_ACCOUNTS);
  const [defaultAccountId, setDefaultAccountId] = useState<string | null>(null);
  const [accountLabels, setAccountLabels] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  // reloadKey forces effects to re-subscribe (pull-to-refresh).
  const [reloadKey, setReloadKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  // "now" drives month math. Refresh when the window regains focus.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const update = () => setNow(new Date());
    window.addEventListener("focus", update);
    return () => window.removeEventListener("focus", update);
  }, []);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setReloadKey((k) => k + 1);
    setNow(new Date());
    await new Promise((r) => setTimeout(r, 500));
    setRefreshing(false);
  }, []);

  useEffect(() => {
    if (!user) {
      setTransactions([]);
      setOlderTxns([]);
      setOlderCursor(undefined);
      liveLastDocRef.current = undefined;
      firstLoad.current = true;
      setBills([]);
      setTxnsLoading(false);
      setBillsLoading(false);
      return;
    }
    firstLoad.current = true;
    setOlderTxns([]);
    setOlderCursor(undefined);
    liveLastDocRef.current = undefined;
    setTxnsLoading(true);
    setBillsLoading(true);

    const unsubTxns = subscribeTransactions(
      user.uid,
      (txns, lastDoc) => {
        setTransactions(txns);
        liveLastDocRef.current = lastDoc;
        setError(null);
        if (firstLoad.current) {
          setTxnsLoading(false);
          firstLoad.current = false;
        }
      },
      (err) => { setError(err.message); setTxnsLoading(false); },
    );
    const unsubBills = subscribeBills(
      user.uid,
      (b) => { setBills(b); setBillsLoading(false); setError(null); },
      (err) => { setError(err.message); setBillsLoading(false); },
    );
    return () => { unsubTxns(); unsubBills(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, reloadKey]);

  // Single subscription for all /settings/ui fields (nav order, account prefs, dashboard layout).
  useEffect(() => {
    if (!user) {
      setNavOrder([]);
      setSelectedAccountId(ALL_ACCOUNTS);
      setDefaultAccountId(null);
      setAccountLabels({});
      return;
    }
    return subscribeUiSettings(
      user.uid,
      (s) => {
        setNavOrder(s.navOrder);
        setSelectedAccountId(s.selectedAccountId);
        setDefaultAccountId(s.defaultAccountId);
        setAccountLabels(s.accountLabels);
      },
      () => {},
    );
  }, [user]);

  // Merge live and older pages; dedup by id in case the live window shrinks.
  const allTransactions = useMemo(() => {
    if (olderTxns.length === 0) return transactions;
    const seen = new Set(transactions.map((t) => t.id));
    const extra = olderTxns.filter((t) => !seen.has(t.id));
    return [...transactions, ...extra];
  }, [transactions, olderTxns]);

  const handleLoadOlder = useCallback(async () => {
    const cursor = liveLastDocRef.current;
    if (!user || !cursor || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const { txns, lastDoc } = await loadOlderTransactions(user.uid, cursor);
      setOlderTxns((prev) => {
        const seen = new Set(prev.map((t) => t.id));
        return [...prev, ...txns.filter((t) => !seen.has(t.id))];
      });
      setOlderCursor(lastDoc);
      // Advance the live cursor so the next "load older" starts from the new tail.
      if (lastDoc) liveLastDocRef.current = lastDoc;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load older transactions.");
    } finally {
      setLoadingOlder(false);
    }
  }, [user, loadingOlder]);

  const accounts = useMemo(
    () => deriveAccounts(allTransactions.filter((t) => t.accountType !== "home_loan"), accountLabels),
    [allTransactions, accountLabels],
  );

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

  if (!isOwner(user)) return <AccessDenied onSignOut={() => void signOut()} />;

  const go = (v: string) => setView(v as View);
  const reorderNav = (keys: string[]) => { if (user) void saveNavOrder(user.uid, keys); };

  const cashTxns = allTransactions.filter((t) => t.accountType !== "home_loan");
  const homeLoanTxns = allTransactions.filter((t) => t.accountType === "home_loan");

  const selected = accounts.some((a) => a.accountId === selectedAccountId) ? selectedAccountId : ALL_ACCOUNTS;
  const viewCashTxns = selected === ALL_ACCOUNTS ? cashTxns : cashTxns.filter((t) => t.accountId === selected);
  const viewBills = selected === ALL_ACCOUNTS || selected === defaultAccountId ? bills : [];

  const canLoadOlder = !!(liveLastDocRef.current || olderCursor);

  return (
    <LockGate uid={user.uid}>
      <PullToRefresh onRefresh={refresh}>
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
                  <IconButton onClick={() => void refresh()} label="Refresh" disabled={refreshing}>
                    <Icon name="refresh" className={refreshing ? "animate-spin" : undefined} />
                  </IconButton>
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
              {!txnsLoading && !billsLoading && allTransactions.length === 0 && bills.length === 0 && (
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
              </ErrorBoundary>
              <ErrorBoundary>
                {view === "transactions" && (
                  <Transactions
                    transactions={viewCashTxns}
                    loading={txnsLoading}
                    hideAmounts={hideAmounts}
                    canLoadOlder={canLoadOlder}
                    loadingOlder={loadingOlder}
                    onLoadOlder={handleLoadOlder}
                  />
                )}
              </ErrorBoundary>
              <ErrorBoundary>
                {view === "bills" && (
                  <Bills bills={bills} loading={billsLoading} hideAmounts={hideAmounts} now={now} />
                )}
              </ErrorBoundary>
              <ErrorBoundary>
                {view === "debits" && (
                  <Recurring transactions={viewCashTxns} loading={txnsLoading} hideAmounts={hideAmounts} />
                )}
              </ErrorBoundary>
              <ErrorBoundary>
                {view === "wealth" && <Wealth transactions={cashTxns} hideAmounts={hideAmounts} />}
              </ErrorBoundary>
              <ErrorBoundary>
                {view === "homeloan" && (
                  <HomeLoan transactions={homeLoanTxns} loading={txnsLoading} hideAmounts={hideAmounts} />
                )}
              </ErrorBoundary>
              <ErrorBoundary>
                {view === "import" && <Import accounts={accounts} defaultAccountId={defaultAccountId} />}
              </ErrorBoundary>
            </main>
          </div>
        </div>
      </PullToRefresh>
    </LockGate>
  );
}

function titleFor(view: string): string {
  return NAV_ITEMS.find((i) => i.key === view)?.label ?? "MzansiMoney";
}

function IconButton({
  onClick,
  label,
  disabled,
  children,
}: {
  onClick: () => void;
  label: string;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      disabled={disabled}
      className="rounded-lg p-1.5 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200 disabled:opacity-50"
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

function AccessDenied({ onSignOut }: { onSignOut: () => void }) {
  const { branding } = useBranding();
  return (
    <div className="flex h-full min-h-screen flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-2xl border border-neutral-800 bg-neutral-900/60 p-8 text-center">
        <div className="text-3xl font-bold tracking-tight text-white">
          {branding.emoji && <span className="mr-1.5">{branding.emoji}</span>}
          {branding.name}<span className="text-indigo-500">.</span>
        </div>
        <div className="mt-4 text-sm text-rose-400">Access denied.</div>
        <p className="mt-2 text-xs text-neutral-500">
          This instance is private. Sign in with the authorised account.
        </p>
        <button
          onClick={onSignOut}
          className="mt-6 w-full rounded-lg border border-neutral-700 px-4 py-2.5 text-sm font-medium text-neutral-300 hover:bg-neutral-800"
        >
          Sign out
        </button>
      </div>
    </div>
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
