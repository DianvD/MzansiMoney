// Visual metadata per category: a colour and an icon name (see components/icons).
// Used by the merchant avatar (category-icon fallback) and could tint charts too.

export interface CategoryMeta {
  color: string; // hex; tinted for backgrounds, solid for the glyph
  icon: string; // key in the Icon component's PATHS
}

export const CATEGORY_META: Record<string, CategoryMeta> = {
  Income: { color: "#10b981", icon: "incomeArrow" },
  Groceries: { color: "#84cc16", icon: "cart" },
  "Eating Out": { color: "#f97316", icon: "dining" },
  Fuel: { color: "#ef4444", icon: "fuel" },
  Transport: { color: "#0ea5e9", icon: "car" },
  Pets: { color: "#f59e0b", icon: "paw" },
  Subscriptions: { color: "#8b5cf6", icon: "recurring" },
  Gaming: { color: "#d946ef", icon: "gamepad" },
  Shopping: { color: "#ec4899", icon: "bag" },
  "Airtime & Data": { color: "#06b6d4", icon: "phone" },
  Internet: { color: "#3b82f6", icon: "wifi" },
  Insurance: { color: "#14b8a6", icon: "shield" },
  Medical: { color: "#f43f5e", icon: "medical" },
  "Home Loan": { color: "#6366f1", icon: "home" },
  Levies: { color: "#a855f7", icon: "building" },
  Investments: { color: "#22c55e", icon: "wealth" },
  "Bank Fees": { color: "#64748b", icon: "percent" },
  "ATM & Cash": { color: "#78716c", icon: "cash" },
  Utilities: { color: "#eab308", icon: "bolt" },
  Uncategorized: { color: "#6b7280", icon: "card" },
};

export function categoryMeta(category: string | undefined): CategoryMeta {
  return (category && CATEGORY_META[category]) || CATEGORY_META.Uncategorized;
}
