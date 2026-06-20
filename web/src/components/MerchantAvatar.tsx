import { Icon } from "./icons";
import { categoryMeta } from "../lib/categoryMeta";

/**
 * Avatar for a transaction, resolved best-first and fully local (no network):
 *   1. a colored monogram from the merchant's initials (the default);
 *   2. the category icon when there's no real merchant (fees, ATM, transfers).
 */

const STOPWORDS = new Set(["the", "bank", "absa", "nedbank", "fnb", "pty", "ltd", "ltd.", "co"]);
const PALETTE = [
  "#6366f1", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444",
  "#ec4899", "#8b5cf6", "#14b8a6", "#f97316", "#84cc16",
];

function initials(name: string): string {
  const words = name
    .replace(/[^a-zA-Z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !STOPWORDS.has(w.toLowerCase()));
  const use = words.length ? words : name.split(/\s+/).filter(Boolean);
  if (use.length === 0) return "?";
  if (use.length === 1) return use[0].slice(0, 2).toUpperCase();
  return (use[0][0] + use[1][0]).toUpperCase();
}

function colorFor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

function isGeneric(name: string): boolean {
  const n = name.trim().toLowerCase();
  return !n || n === "unknown" || STOPWORDS.has(n);
}

export default function MerchantAvatar({
  merchant,
  category,
  size = 36,
}: {
  merchant: string;
  category: string;
  size?: number;
}) {
  const name = (merchant || "").trim();
  const box = { width: size, height: size } as const;

  // No real merchant -> category icon.
  if (isGeneric(name)) {
    const meta = categoryMeta(category);
    return (
      <div
        className="flex shrink-0 items-center justify-center rounded-full"
        style={{ ...box, backgroundColor: `${meta.color}22`, color: meta.color }}
      >
        <Icon name={meta.icon} size={Math.round(size * 0.5)} />
      </div>
    );
  }

  // Colored monogram.
  const color = colorFor(name);
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full text-xs font-semibold"
      style={{ ...box, backgroundColor: `${color}22`, color }}
    >
      {initials(name)}
    </div>
  );
}
