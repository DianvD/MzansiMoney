// Customizable dashboard layout - which cards show, in what order, at what width.
// Persisted at users/{uid}/settings/ui.dashboardLayout (same doc as navOrder).
// The balance hero is NOT a card here - it's pinned above the grid, always shown.

export type CardWidth = "third" | "half" | "twothirds" | "full";

export interface DashCard {
  id: string;
  width: CardWidth;
}

export interface DashboardLayout {
  /** Visible cards, in display order. */
  cards: DashCard[];
  /** Ids of cards the user has hidden (kept so they can be re-added). */
  hidden: string[];
}

/** The registry of all dashboard cards. Add a card here and it shows up for
 * everyone (appended to existing saved layouts via {@link reconcileLayout}). */
export const CARD_META: { id: string; title: string; defaultWidth: CardWidth }[] = [
  { id: "pinned", title: "Payments to check", defaultWidth: "full" },
  { id: "spending", title: "Spending this month", defaultWidth: "third" },
  { id: "income", title: "Income this month", defaultWidth: "third" },
  { id: "net", title: "Net this month", defaultWidth: "third" },
  { id: "categories", title: "Spending by category", defaultWidth: "twothirds" },
  { id: "recent", title: "Recent transactions", defaultWidth: "third" },
  { id: "bills", title: "Upcoming bills", defaultWidth: "full" },
];

export const DEFAULT_LAYOUT: DashboardLayout = {
  cards: CARD_META.map((c) => ({ id: c.id, width: c.defaultWidth })),
  hidden: [],
};

// Width -> column span in the 6-column desktop grid. Mobile is always full width.
export const WIDTH_COLS: Record<CardWidth, number> = {
  third: 2,
  half: 3,
  twothirds: 4,
  full: 6,
};

// Literal classes (so Tailwind keeps them): each card is full width on mobile and
// spans its chosen columns from `lg` up.
export const WIDTH_SPAN_CLASS: Record<CardWidth, string> = {
  third: "lg:col-span-2",
  half: "lg:col-span-3",
  twothirds: "lg:col-span-4",
  full: "lg:col-span-6",
};

export const WIDTH_LABEL: Record<CardWidth, string> = {
  third: "⅓",
  half: "½",
  twothirds: "⅔",
  full: "Full",
};

export const WIDTH_CYCLE: CardWidth[] = ["third", "half", "twothirds", "full"];

export function cardTitle(id: string): string {
  return CARD_META.find((c) => c.id === id)?.title ?? id;
}

function cardDefaultWidth(id: string): CardWidth {
  return CARD_META.find((c) => c.id === id)?.defaultWidth ?? "full";
}

/** Merge a saved layout with the registry: keep saved order/width for known cards,
 * append any newly-added cards (from an app update) at their default width, drop
 * ids that no longer exist, and never let a card be both visible and hidden. */
export function reconcileLayout(saved: Partial<DashboardLayout> | null | undefined): DashboardLayout {
  const known = new Set(CARD_META.map((c) => c.id));
  const hidden = (saved?.hidden ?? []).filter((id) => known.has(id));
  const hiddenSet = new Set(hidden);

  const seen = new Set<string>();
  const cards: DashCard[] = [];
  for (const c of saved?.cards ?? []) {
    if (!known.has(c.id) || hiddenSet.has(c.id) || seen.has(c.id)) continue;
    seen.add(c.id);
    cards.push({ id: c.id, width: WIDTH_COLS[c.width] ? c.width : cardDefaultWidth(c.id) });
  }
  // Append cards present in the registry but missing from the saved layout.
  for (const c of CARD_META) {
    if (seen.has(c.id) || hiddenSet.has(c.id)) continue;
    cards.push({ id: c.id, width: c.defaultWidth });
  }
  return { cards, hidden };
}
