import type { ReactNode } from "react";

interface Props {
  label: string;
  value: ReactNode;
  hint?: string;
  accent?: "default" | "positive" | "negative";
}

const accentColor: Record<NonNullable<Props["accent"]>, string> = {
  default: "text-white",
  positive: "text-emerald-400",
  negative: "text-rose-400",
};

export default function StatCard({ label, value, hint, accent = "default" }: Props) {
  return (
    <div className="rounded-2xl border border-neutral-800 bg-neutral-900/60 p-5">
      <div className="text-xs font-medium uppercase tracking-wider text-neutral-500">
        {label}
      </div>
      <div className={`mt-2 text-2xl font-semibold tabular-nums ${accentColor[accent]}`}>
        {value}
      </div>
      {hint && <div className="mt-1 text-xs text-neutral-500">{hint}</div>}
    </div>
  );
}
