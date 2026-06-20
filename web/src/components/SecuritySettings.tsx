import { useState } from "react";
import { useAuth } from "../auth";
import { useBranding } from "../branding/context";
import {
  biometricAvailable, biometricEnrolled, enrollBiometric, removeBiometric, setPin,
} from "../lib/lock";
import { setStatementPassword } from "../lib/data";

export default function SecuritySettings({ onClose }: { onClose: () => void }) {
  const { user } = useAuth();
  const { branding } = useBranding();
  const uid = user?.uid ?? "";
  const [pin, setPinV] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bioOn, setBioOn] = useState(biometricEnrolled(uid));
  const [stmtPw, setStmtPw] = useState("");
  const [savingPw, setSavingPw] = useState(false);

  async function saveStatementPw() {
    if (!stmtPw.trim()) return setError("Enter your statement password (account number).");
    setSavingPw(true); setError(null); setMsg(null);
    try {
      await setStatementPassword(stmtPw.trim());
      setStmtPw("");
      setMsg("Statement password saved (encrypted). Encrypted statements will auto-unlock.");
    } catch {
      setError("Could not save the statement password.");
    } finally {
      setSavingPw(false);
    }
  }

  async function changePin() {
    if (!/^\d{4,6}$/.test(pin)) return setError("PIN must be 4-6 digits.");
    if (pin !== confirm) return setError("PINs don't match.");
    setBusy(true); setError(null); setMsg(null);
    try {
      await setPin(uid, pin);
      setPinV(""); setConfirm("");
      setMsg("PIN updated.");
    } catch {
      setError("Could not update PIN.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleBio() {
    setError(null); setMsg(null);
    if (bioOn) {
      removeBiometric(uid);
      setBioOn(false);
      setMsg("Biometric unlock disabled on this device.");
    } else {
      const ok = await enrollBiometric(uid, branding.name);
      setBioOn(ok);
      setMsg(ok ? "Biometric unlock enabled on this device." : "Couldn't enable biometrics.");
    }
  }

  const field = "w-full rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-200 outline-none focus:border-indigo-500";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl border border-neutral-800 bg-neutral-900 p-5" onClick={(e) => e.stopPropagation()}>
        <div className="text-sm font-semibold text-neutral-200">Security</div>

        <div className="mt-4 text-xs uppercase tracking-wider text-neutral-500">Change PIN</div>
        <input className={`${field} mt-2`} type="password" inputMode="numeric" maxLength={6}
          placeholder="New PIN" value={pin} onChange={(e) => setPinV(e.target.value.replace(/\D/g, ""))} />
        <input className={`${field} mt-2`} type="password" inputMode="numeric" maxLength={6}
          placeholder="Confirm" value={confirm} onChange={(e) => setConfirm(e.target.value.replace(/\D/g, ""))} />
        <button className="mt-2 rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
          disabled={busy} onClick={changePin}>Update PIN</button>

        {biometricAvailable() && (
          <div className="mt-5">
            <div className="text-xs uppercase tracking-wider text-neutral-500">Biometric (this device)</div>
            <button onClick={toggleBio}
              className="mt-2 rounded-lg border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-800">
              {bioOn ? "Disable Face / fingerprint" : "Enable Face / fingerprint"}
            </button>
          </div>
        )}

        <div className="mt-5">
          <div className="text-xs uppercase tracking-wider text-neutral-500">Statement password</div>
          <div className="mt-1 text-xs text-neutral-500">
            Your bank-statement PDF password (usually your account number). Stored AES-encrypted,
            server-side only - used to auto-unlock encrypted statements.
          </div>
          <div className="mt-2 flex gap-2">
            <input className={field} type="password" autoComplete="off" placeholder="Account number"
              value={stmtPw} onChange={(e) => setStmtPw(e.target.value)} />
            <button onClick={saveStatementPw} disabled={savingPw}
              className="shrink-0 rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50">
              {savingPw ? "Saving…" : "Save"}
            </button>
          </div>
        </div>

        {msg && <div className="mt-3 text-sm text-emerald-400">{msg}</div>}
        {error && <div className="mt-3 text-sm text-rose-400">{error}</div>}

        <div className="mt-5 text-right">
          <button onClick={onClose} className="rounded-lg px-3 py-1.5 text-sm text-neutral-400 hover:text-neutral-200">Done</button>
        </div>
      </div>
    </div>
  );
}
