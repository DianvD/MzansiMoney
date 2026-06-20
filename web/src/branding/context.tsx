import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useAuth } from "../auth";
import { subscribeBranding, saveBranding, type BrandingDoc } from "../lib/data";
import {
  CUSTOM_SKIN_ID,
  DEFAULT_SKIN_ID,
  PALETTES,
  skinById,
  type PaletteId,
} from "./skins";

export interface Branding {
  skinId: string;
  name: string;
  tagline: string;
  emoji: string;
  paletteId: PaletteId;
  gmailLabel: string;
}

function isPalette(id: string | undefined): id is PaletteId {
  return !!id && id in PALETTES;
}

/** Resolve the effective branding from the saved per-user doc, falling back to
 * the deployment's default skin. */
export function resolveBranding(saved: BrandingDoc | null): Branding {
  const def = skinById(DEFAULT_SKIN_ID);
  if (!saved || !saved.skinId) {
    return { skinId: def.id, name: def.name, tagline: def.tagline, emoji: def.emoji, paletteId: def.palette, gmailLabel: def.name };
  }
  if (saved.skinId === CUSTOM_SKIN_ID) {
    const name = (saved.name || def.name).trim() || def.name;
    return {
      skinId: CUSTOM_SKIN_ID,
      name,
      tagline: "",
      emoji: saved.emoji ?? "",
      paletteId: isPalette(saved.paletteId) ? saved.paletteId : def.palette,
      gmailLabel: (saved.gmailLabel || name).trim(),
    };
  }
  const s = skinById(saved.skinId);
  return { skinId: s.id, name: s.name, tagline: s.tagline, emoji: s.emoji, paletteId: s.palette, gmailLabel: (saved.gmailLabel || s.name).trim() };
}

const SCALE_KEYS = ["50", "100", "200", "300", "400", "500", "600", "700", "800", "900", "950"];

/** Swap Tailwind's indigo accent variables for the chosen palette, recolouring
 * every `indigo-*` utility in the app at once. For the default `indigo` accent we
 * clear the overrides so Tailwind's exact built-in colours stand (no visual change
 * for an unbranded instance). */
export function applyAccent(paletteId: PaletteId) {
  const root = document.documentElement;
  if (paletteId === "indigo") {
    SCALE_KEYS.forEach((k) => root.style.removeProperty(`--color-indigo-${k}`));
    return;
  }
  const scale = (PALETTES[paletteId] ?? PALETTES.indigo).scale;
  SCALE_KEYS.forEach((k, i) => root.style.setProperty(`--color-indigo-${k}`, scale[i]));
}

// Apply the deployment default immediately on load (before React mounts) so the
// sign-in screen never flashes the wrong accent.
applyAccent(skinById(DEFAULT_SKIN_ID).palette);

interface Ctx {
  branding: Branding;
  save: (b: BrandingDoc) => Promise<void> | void;
}
const BrandingContext = createContext<Ctx>(null as unknown as Ctx);
export const useBranding = () => useContext(BrandingContext);

export function BrandingProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [saved, setSaved] = useState<BrandingDoc | null>(null);

  useEffect(() => {
    if (!user) { setSaved(null); return; }
    return subscribeBranding(user.uid, setSaved, () => {});
  }, [user]);

  const branding = resolveBranding(saved);
  useEffect(() => { applyAccent(branding.paletteId); }, [branding.paletteId]);
  useEffect(() => { document.title = branding.name; }, [branding.name]);

  const save = (b: BrandingDoc) => (user ? saveBranding(user.uid, b) : undefined);
  return <BrandingContext.Provider value={{ branding, save }}>{children}</BrandingContext.Provider>;
}
