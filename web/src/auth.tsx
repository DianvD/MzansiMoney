import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut as fbSignOut,
  type User,
} from "firebase/auth";
import { auth, googleProvider, isOwner } from "./firebase";
import { recordLogin } from "./lib/notifications";

interface AuthState {
  user: User | null;
  loading: boolean;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    return onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
      // Record the sign-in so the backend can alert on an unrecognised device.
      // Fire-and-forget; a known device just refreshes its last-seen time. Only
      // for the owner: a non-owner's call would be denied anyway, and gating it
      // here keeps the owner check ahead of EVERY owner-only callable.
      if (u && isOwner(u)) void recordLogin();
    });
  }, []);

  const value: AuthState = {
    user,
    loading,
    signIn: async () => {
      await signInWithPopup(auth, googleProvider);
    },
    signOut: async () => {
      // Clear React state immediately so another person's data isn't visible during
      // the async network round-trip. onAuthStateChanged confirms the null when it
      // settles; if fbSignOut fails, a subsequent auth event restores the user.
      setUser(null);
      await fbSignOut(auth);
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
