/**
 * Security notifications - client side.
 *
 * - `recordLogin()` tells the backend we just signed in, sending a stable
 *   per-browser device id so the server can email a "new sign-in" alert when it
 *   sees a device it doesn't recognise. Fire-and-forget; it never blocks the app.
 * - `getLoginAlerts` / `setLoginAlerts` read+write the user's opt-out preference
 *   (login alerts default ON) in `settings/notifications`, which is client-writable.
 */
import { httpsCallable } from "firebase/functions";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { functions, db } from "../firebase";

const DEVICE_KEY = "mzansimoney.deviceId";

/** A stable random id for THIS browser (hashed server-side, never reused as a
 * secret). Clearing site data just makes this browser look "new" once more. */
function deviceId(): string {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

const callRecordLogin = httpsCallable<
  { deviceId: string; userAgent: string },
  { status: string; alerted?: boolean }
>(functions, "record_login");

/** Record this sign-in. Safe to call on every load; a known device just refreshes
 * its last-seen time. Errors are swallowed - it must never block using the app. */
export async function recordLogin(): Promise<void> {
  try {
    await callRecordLogin({ deviceId: deviceId(), userAgent: navigator.userAgent });
  } catch {
    /* non-critical */
  }
}

// ---- login-alert preference (settings/notifications.loginAlerts) ----------

function notifRef(uid: string) {
  return doc(db, "users", uid, "settings", "notifications");
}

export async function getLoginAlerts(uid: string): Promise<boolean> {
  try {
    const snap = await getDoc(notifRef(uid));
    return snap.exists() ? snap.data().loginAlerts !== false : true; // default ON
  } catch {
    return true;
  }
}

export async function setLoginAlerts(uid: string, enabled: boolean): Promise<void> {
  await setDoc(notifRef(uid), { loginAlerts: enabled }, { merge: true });
}
