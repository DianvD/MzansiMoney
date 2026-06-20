import { initializeApp } from "firebase/app";
import {
  getAuth,
  connectAuthEmulator,
  GoogleAuthProvider,
} from "firebase/auth";
import { getFirestore, connectFirestoreEmulator } from "firebase/firestore";
import { getFunctions, connectFunctionsEmulator } from "firebase/functions";

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
export const auth = getAuth(app);
export const db = getFirestore(app);
// Region must match the Python function's @on_call(region=...).
export const functions = getFunctions(app, "africa-south1");
export const googleProvider = new GoogleAuthProvider();

if (useEmulators) {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
}
