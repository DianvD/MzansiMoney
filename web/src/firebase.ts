import { initializeApp } from "firebase/app";
import {
  getAuth,
  connectAuthEmulator,
  GoogleAuthProvider,
} from "firebase/auth";
import { getFirestore, connectFirestoreEmulator } from "firebase/firestore";
import { getFunctions, connectFunctionsEmulator } from "firebase/functions";
import { initializeAppCheck, ReCaptchaV3Provider } from "firebase/app-check";

const env = import.meta.env;

// Use emulators in dev, or whenever explicitly requested. In emulator mode the
// config values can be dummies - the demo-mzansimoney project never talks to Google.
const useEmulators =
  env.VITE_USE_EMULATORS === "true" ||
  (env.DEV && env.VITE_USE_EMULATORS !== "false");

const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY ?? "demo-api-key",
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN ?? "demo-mzansimoney.firebaseapp.com",
  projectId: env.VITE_FIREBASE_PROJECT_ID ?? "demo-mzansimoney",
  appId: env.VITE_FIREBASE_APP_ID ?? "demo-app",
};

export const app = initializeApp(firebaseConfig);

// App Check attaches a token proving each request comes from THIS registered app,
// so a stolen Firebase ID token replayed by a script is rejected by the backend
// (once ENFORCE_APP_CHECK=1 on the functions). Skipped under emulators; no-ops
// gracefully until VITE_RECAPTCHA_SITE_KEY is set, so prod won't break pre-setup.
// The reCAPTCHA v3 site key is public by design (it ships in the page).
if (!useEmulators && env.VITE_RECAPTCHA_SITE_KEY) {
  initializeAppCheck(app, {
    provider: new ReCaptchaV3Provider(env.VITE_RECAPTCHA_SITE_KEY),
    isTokenAutoRefreshEnabled: true,
  });
}

// Front-of-door allow-list (a UX gate; the REAL enforcement is the backend's
// OWNER_UID check on every callable + the Firestore rules). Configure with
// VITE_OWNER_UID (same value as the functions' OWNER_UID) and/or a comma-separated
// VITE_OWNER_EMAILS. These values are public by design - they ship in the bundle
// and only say "who is allowed", never a secret. When NEITHER is set we don't
// block here, so an unconfigured build can never lock the legitimate owner out -
// the backend still denies everyone else.
const ownerUid = (env.VITE_OWNER_UID ?? "").trim();
const ownerEmails = String(env.VITE_OWNER_EMAILS ?? "")
  .split(",")
  .map((e: string) => e.trim().toLowerCase())
  .filter(Boolean);

/** True if this signed-in user is the configured owner (or no allow-list is set). */
export function isOwner(user: { uid: string; email: string | null }): boolean {
  if (!ownerUid && ownerEmails.length === 0) return true; // not configured -> defer to backend
  if (ownerUid && user.uid === ownerUid) return true;
  if (user.email && ownerEmails.includes(user.email.toLowerCase())) return true;
  return false;
}

export const auth = getAuth(app);
export const db = getFirestore(app);
// Region must match the Python function's @on_call(region=...) / FUNCTIONS_REGION.
export const functions = getFunctions(app, env.VITE_FUNCTIONS_REGION ?? "africa-south1");
export const googleProvider = new GoogleAuthProvider();

if (useEmulators) {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
}
