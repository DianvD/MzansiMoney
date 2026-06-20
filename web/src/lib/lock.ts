/**
 * App lock - a PIN (synced) + optional device biometric (Face/fingerprint/Windows
 * Hello) gate that sits in front of the app after Google sign-in.
 *
 * Honest scope: this is an APP LOCK, not cryptographic data protection. The PIN
 * is stored as a slow PBKDF2 hash in the user's own Firestore settings; biometric
 * uses a WebAuthn platform credential as a local unlock ceremony. It stops anyone
 * using your already-signed-in device - which is the realistic threat - but isn't
 * a substitute for your Google account's own 2FA (your real first factor).
 */
import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase";

// ---- base64 helpers -----------------------------------------------------
function bufToB64(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}
function b64ToBuf(b64: string): ArrayBuffer {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer;
}
function bufToB64url(buf: ArrayBuffer): string {
  return bufToB64(buf).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlToBuf(s: string): ArrayBuffer {
  return b64ToBuf(s.replace(/-/g, "+").replace(/_/g, "/"));
}

// ---- PIN ----------------------------------------------------------------
// The PIN hash is owned by the backend (secure/appLock, denied to clients); we
// only ever send a PIN attempt to a Cloud Function and get a yes/no back. The
// `uid` params are kept for call-site compatibility but the server uses auth.uid.
const callSetPin = httpsCallable<{ pin: string }, { status: string }>(functions, "set_app_pin");
const callVerifyPin = httpsCallable<{ pin: string }, { ok: boolean }>(functions, "verify_app_pin");
const callPinStatus = httpsCallable<Record<string, never>, { hasPin: boolean }>(functions, "app_pin_status");

export async function hasPin(_uid: string): Promise<boolean> {
  const res = await callPinStatus({});
  return !!res.data?.hasPin;
}

export async function setPin(_uid: string, pin: string): Promise<void> {
  await callSetPin({ pin });
}

export async function verifyPin(_uid: string, pin: string): Promise<boolean> {
  const res = await callVerifyPin({ pin });
  return !!res.data?.ok;
}

// ---- Biometric (WebAuthn platform authenticator, per device) ------------
function bioKey(uid: string) {
  return `app.bio.${uid}`;
}

export function biometricAvailable(): boolean {
  return typeof window !== "undefined" && !!window.PublicKeyCredential;
}

export function biometricEnrolled(uid: string): boolean {
  return biometricAvailable() && !!localStorage.getItem(bioKey(uid));
}

export async function enrollBiometric(uid: string, label: string): Promise<boolean> {
  if (!biometricAvailable()) return false;
  try {
    const cred = (await navigator.credentials.create({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rp: { name: "MzansiMoney" },
        user: { id: new TextEncoder().encode(uid), name: label, displayName: label },
        pubKeyCredParams: [
          { type: "public-key", alg: -7 },
          { type: "public-key", alg: -257 },
        ],
        authenticatorSelection: {
          authenticatorAttachment: "platform",
          userVerification: "required",
          residentKey: "preferred",
        },
        timeout: 60000,
        attestation: "none",
      },
    })) as PublicKeyCredential | null;
    if (!cred) return false;
    localStorage.setItem(bioKey(uid), bufToB64url(cred.rawId));
    return true;
  } catch {
    return false;
  }
}

export function removeBiometric(uid: string): void {
  localStorage.removeItem(bioKey(uid));
}

export async function unlockWithBiometric(uid: string): Promise<boolean> {
  const idB64 = localStorage.getItem(bioKey(uid));
  if (!idB64 || !biometricAvailable()) return false;
  try {
    await navigator.credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        allowCredentials: [{ type: "public-key", id: b64urlToBuf(idB64) }],
        userVerification: "required",
        timeout: 60000,
      },
    });
    // The local WebAuthn ceremony proves the device owner is present, but we also
    // require a live authenticated server round-trip so biometric unlock - like the
    // PIN and Google sign-in - always needs a network connection (it cannot be used
    // to open the app while offline).
    await callPinStatus({});
    return true;
  } catch {
    return false;
  }
}
