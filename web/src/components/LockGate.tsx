import {
  createContext, useCallback, useContext, useEffect, useState,
  type ReactNode,
} from "react";
import {
  biometricAvailable, biometricEnrolled, enrollBiometric, hasPin,
  setPin, unlockWithBiometric, verifyPin,
} from "../lib/lock";
import { useBranding } from "../branding/context";

const IDLE_MS = 5 * 60 * 1000; // auto-lock after 5 minutes idle

const LockCtx = createContext<{ lock: () => void }>({ lock: () => {} });
export const useLock = () => useContext(LockCtx);

type Phase = "loading" | "setup" | "locked" | "open" | "error";

export default function LockGate({ uid, children }: { uid: string; children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [retrySignal, setRetrySignal] = useState(0);

  useEffect(() => {
    let alive = true;
    setPhase("loading");

    // Exponential back-off: 1 s, 2 s, 4 s — then give up and show an error
    // screen so the user can retry manually instead of sitting on a blank spinner.
    let attempt = 0;
    const maxAttempts = 3;
    const delays = [1000, 2000, 4000];

    async function tryLoad() {
      try {
        const has = await hasPin(uid);
        if (alive) setPhase(has ? "locked" : "setup");
      } catch {
        attempt++;
        if (!alive) return;
        if (attempt < maxAttempts) {
          await new Promise((r) => setTimeout(r, delays[attempt - 1]));
          if (alive) void tryLoad();
        } else {
          setPhase("error");
        }
      }
    }

    void tryLoad();
    return () => { alive = false; };
  }, [uid, retrySignal]);

  const lock = useCallback(() => setPhase((p) => (p === "open" ? "locked" : p)), []);

  // Auto-lock on inactivity while open.
  useEffect(() => {
    if (phase !== "open") return;
    let timer: number;
    const reset = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(lock, IDLE_MS);
    };
    const events = ["mousemove", "keydown", "pointerdown", "touchstart", "scroll"];
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    reset();
    return () => {
      window.clearTimeout(timer);
      events.forEach((e) => window.removeEventListener(e, reset));
    };
  }, [phase, lock]);

  if (phase === "loading")
    return <Center><div className="text-neutral-500">Loading…</div></Center>;
  if (phase === "error")
    return (
      <Center>
        <div className="w-full max-w-sm rounded-2xl border border-neutral-800 bg-neutral-900/60 p-8 text-center">
          <div className="text-neutral-300">Could not reach the server.</div>
          <div className="mt-1 text-sm text-neutral-500">Check your connection and try again.</div>
          <button
            onClick={() => setRetrySignal((n) => n + 1)}
            className="mt-5 rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-500"
          >
            Retry
          </button>
        </div>
      </Center>
    );
  if (phase === "setup")
    return <PinSetup uid={uid} onDone={() => setPhase("open")} />;
  if (phase === "locked")
    return <LockScreen uid={uid} onUnlock={() => setPhase("open")} />;
  return <LockCtx.Provider value={{ lock }}>{children}</LockCtx.Provider>;
}

function Center({ children }: { children: ReactNode }) {
  return <div className="flex min-h-screen items-center justify-center px-4">{children}</div>;
}

function Card({ children }: { children: ReactNode }) {
  const { branding } = useBranding();
  return (
    <Center>
      <div className="w-full max-w-sm rounded-2xl border border-neutral-800 bg-neutral-900/60 p-8">
        <div className="mb-1 text-center text-2xl font-bold tracking-tight text-white">
          {branding.emoji && <span className="mr-1">{branding.emoji}</span>}
          {branding.name}<span className="text-indigo-500">.</span>
        </div>
        {children}
      </div>
    </Center>
  );
}

const pinInput =
  "w-full rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2.5 text-center text-lg tracking-[0.3em] text-neutral-100 outline-none focus:border-indigo-500";
const primaryBtn =
  "mt-4 w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50";

const validPin = (p: string) => /^\d{4,12}$/.test(p);
const validNewPin = (p: string) => /^\d{6,12}$/.test(p);

function PinSetup({ uid, onDone }: { uid: string; onDone: () => void }) {
  const [pin, setPinV] = useState("");
  const [confirm, setConfirm] = useState("");
  const [useBio, setUseBio] = useState(biometricAvailable());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!validNewPin(pin)) return setError("PIN must be 6-12 digits.");
    if (pin !== confirm) return setError("PINs don't match.");
    setBusy(true);
    setError(null);
    try {
      await setPin(uid, pin);
      if (useBio && biometricAvailable()) await enrollBiometric(uid, "MzansiMoney");
      onDone();
    } catch {
      setError("Could not set up the PIN. Try again.");
      setBusy(false);
    }
  }

  return (
    <Card>
      <p className="mt-1 mb-5 text-center text-sm text-neutral-400">
        Set a PIN to lock the app. You'll enter it (or use biometrics) to open MzansiMoney.
      </p>
      <input className={pinInput} type="password" inputMode="numeric" maxLength={12}
        placeholder="••••••" value={pin} onChange={(e) => setPinV(e.target.value.replace(/\D/g, ""))}
        aria-label="New PIN" autoFocus autoComplete="off" />
      <input className={`${pinInput} mt-3`} type="password" inputMode="numeric" maxLength={12}
        placeholder="Confirm" value={confirm} onChange={(e) => setConfirm(e.target.value.replace(/\D/g, ""))}
        aria-label="Confirm PIN" autoComplete="off" />
      {biometricAvailable() && (
        <label className="mt-3 flex items-center gap-2 text-sm text-neutral-300">
          <input type="checkbox" checked={useBio} onChange={(e) => setUseBio(e.target.checked)} />
          Also enable Face/fingerprint unlock on this device
        </label>
      )}
      {error && <div className="mt-3 text-sm text-rose-400">{error}</div>}
      <button className={primaryBtn} disabled={busy} onClick={save}>
        {busy ? "Setting up…" : "Set PIN & continue"}
      </button>
    </Card>
  );
}

function LockScreen({ uid, onUnlock }: { uid: string; onUnlock: () => void }) {
  const [pin, setPinV] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bio = biometricEnrolled(uid);

  async function tryBiometric() {
    setBusy(true);
    setError(null);
    const ok = await unlockWithBiometric(uid);
    setBusy(false);
    if (ok) onUnlock();
    else setError("Biometric unlock cancelled - enter your PIN.");
  }

  async function submit() {
    if (!validPin(pin)) return setError("Enter your 4-12 digit PIN.");
    setBusy(true);
    setError(null);
    const ok = await verifyPin(uid, pin);
    if (ok) return onUnlock();
    setBusy(false);
    setPinV("");
    setError("Incorrect PIN.");
  }

  return (
    <Card>
      <p className="mt-1 mb-5 text-center text-sm text-neutral-400">Locked. Enter your PIN to continue.</p>
      <input className={pinInput} type="password" inputMode="numeric" maxLength={12}
        placeholder="••••••" value={pin} autoFocus autoComplete="off"
        onChange={(e) => setPinV(e.target.value.replace(/\D/g, ""))}
        onKeyDown={(e) => e.key === "Enter" && void submit()} aria-label="PIN" />
      {error && <div className="mt-3 text-sm text-rose-400">{error}</div>}
      <button className={primaryBtn} disabled={busy} onClick={() => void submit()}>
        {busy ? "Checking…" : "Unlock"}
      </button>
      {bio && (
        <button onClick={() => void tryBiometric()} disabled={busy}
          className="mt-2 w-full rounded-lg border border-neutral-700 px-4 py-2 text-sm text-neutral-300 hover:bg-neutral-800 disabled:opacity-50">
          Use Face / fingerprint
        </button>
      )}
    </Card>
  );
}
