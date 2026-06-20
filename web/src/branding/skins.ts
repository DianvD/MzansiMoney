// Branding / theming config. This is the file a self-hoster edits to set their
// app's default look: change DEFAULT_SKIN_ID, tweak a skin, or add your own.
//
// How theming works: Tailwind v4 emits accent utilities as `var(--color-indigo-*)`,
// so swapping those CSS variables at runtime (see branding/context.tsx) recolours
// the whole app's accent. Each skin just points at an accent palette below.

export type PaletteId = "indigo" | "amber" | "emerald" | "rose" | "sky" | "violet";

// 11-step accent scales (50 -> 950), mapped onto Tailwind's indigo variables.
export const PALETTES: Record<PaletteId, { label: string; scale: string[] }> = {
  indigo: { label: "Indigo", scale: ["#eef2ff", "#e0e7ff", "#c7d2fe", "#a5b4fc", "#818cf8", "#6366f1", "#4f46e5", "#4338ca", "#3730a3", "#312e81", "#1e1b4b"] },
  amber: { label: "Amber / braai", scale: ["#fffbeb", "#fef3c7", "#fde68a", "#fcd34d", "#fbbf24", "#f59e0b", "#d97706", "#b45309", "#92400e", "#78350f", "#451a03"] },
  emerald: { label: "Emerald / veld", scale: ["#ecfdf5", "#d1fae5", "#a7f3d0", "#6ee7b7", "#34d399", "#10b981", "#059669", "#047857", "#065f46", "#064e3b", "#022c22"] },
  rose: { label: "Rose", scale: ["#fff1f2", "#ffe4e6", "#fecdd3", "#fda4af", "#fb7185", "#f43f5e", "#e11d48", "#be123c", "#9f1239", "#881337", "#4c0519"] },
  sky: { label: "Sky / ocean", scale: ["#f0f9ff", "#e0f2fe", "#bae6fd", "#7dd3fc", "#38bdf8", "#0ea5e9", "#0284c7", "#0369a1", "#075985", "#0c4a6e", "#082f49"] },
  violet: { label: "Violet", scale: ["#f5f3ff", "#ede9fe", "#ddd6fe", "#c4b5fd", "#a78bfa", "#8b5cf6", "#7c3aed", "#6d28d9", "#5b21b6", "#4c1d95", "#2e1065"] },
};

export interface Skin {
  id: string;
  name: string;
  tagline: string;
  emoji: string;       // shown in the logo / sign-in mark
  palette: PaletteId;
}

// Preset skins. Add your own here, then point DEFAULT_SKIN_ID at it.
export const SKINS: Skin[] = [
  { id: "mzansimoney", name: "MzansiMoney", tagline: "Your money, sorted the Mzansi way.", emoji: "🇿🇦", palette: "emerald" },
  { id: "braaibucks", name: "BraaiBucks", tagline: "Track your lekker spending.", emoji: "🔥", palette: "amber" },
  { id: "classic", name: "Classic", tagline: "A clean, neutral money app.", emoji: "💸", palette: "indigo" },
  { id: "ocean", name: "Ocean", tagline: "Calm waters for your cash.", emoji: "🌊", palette: "sky" },
  { id: "berry", name: "Berry", tagline: "Sweet and simple finance.", emoji: "🫐", palette: "violet" },
];

// The default look for this deployment. A self-hoster changes this one line
// (and the public manifest/title) to rebrand the whole instance.
export const DEFAULT_SKIN_ID = "mzansimoney";

export const CUSTOM_SKIN_ID = "custom";

export function skinById(id: string | undefined): Skin {
  return SKINS.find((s) => s.id === id) ?? SKINS.find((s) => s.id === DEFAULT_SKIN_ID) ?? SKINS[0];
}
