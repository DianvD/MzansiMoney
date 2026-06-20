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
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "../firebase";

const PBKDF2_ITERATIONS = 210000;

interface Security {
  salt: string;
  hash: string;
  iterations: number;
  version: number;
}

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
async function derive(pin: string, saltB64: string, iterations: number): Promise<string> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pin),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: b64ToBuf(saltB64), iterations, hash: "SHA-256" },
    keyMaterial,
    256,
  );
  return bufToB64(bits);
}

function securityRef(uid: string) {
  return doc(db, "users", uid, "settings", "security");
}

export async function getSecurity(uid: string): Promise<Security | null> {
  const snap = await getDoc(securityRef(uid));
  return snap.exists() ? (snap.data() as Security) : null;
}

export async function hasPin(uid: string): Promise<boolean> {
  return (await getSecurity(uid)) !== null;
}

export async function setPin(uid: string, pin: string): Promise<void> {
  const salt = bufToB64(crypto.getRandomValues(new Uint8Array(16)).buffer);
  const hash = await derive(pin, salt, PBKDF2_ITERATIONS);
  await setDoc(securityRef(uid), { salt, hash, iterations: PBKDF2_ITERATIONS, version: 1 });
}

export async function verifyPin(uid: string, pin: string): Promise<boolean> {
  const sec = await getSecurity(uid);
  if (!sec) return false;
  const hash = await derive(pin, sec.salt, sec.iterations);
  // Length-safe constant-ish comparison.
  if (hash.length !== sec.hash.length) return false;
  let diff = 0;
  for (let i = 0; i < hash.length; i++) diff |= hash.charCodeAt(i) ^ sec.hash.charCodeAt(i);
  return diff === 0;
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
    return true; // user-verification ceremony succeeded
  } catch {
    return false;
  }
}
