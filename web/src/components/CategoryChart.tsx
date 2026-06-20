import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { money } from "../lib/format";

const PALETTE = [
  "#6366f1",
  "#22c55e",
  "#f59e0b",
  "#ec4899",
  "#06b6d4",
  "#a855f7",
  "#ef4444",
  "#84cc16",
  "#14b8a6",
  "#f97316",
];

interface Props {
  data: { category: string; amount: number }[];
}

export default function CategoryChart({ data }: Props) {
  if (data.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-neutral-500">
        No spending this month yet.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
      <div className="h-56 w-full sm:w-1/2">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="amount"
              nameKey="category"
              innerRadius={55}
              outerRadius={85}
              paddingAngle={2}
              stroke="none"
            >
              {data.map((_, i) => (
                <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
              ))}
            </Pie>
            <Tooltip
              formatter={(v: number) => money(v)}
              contentStyle={{
                background: "#171717",
                border: "1px solid #404040",
                borderRadius: 8,
                color: "#e5e5e5",
              }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="flex-1 space-y-2">
        {data.map((d, i) => (
          <li key={d.category} className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2 text-neutral-300">
              <span
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ background: PALETTE[i % PALETTE.length] }}
              />
              {d.category}
            </span>
            <span className="tabular-nums text-neutral-400">{money(d.amount)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
