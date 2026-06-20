import type { ReactNode } from "react";

interface Props {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}

export default function Panel({ title, action, children, className = "" }: Props) {
  return (
    <section
      className={`rounded-2xl border border-neutral-800 bg-neutral-900/60 p-5 ${className}`}
    >
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-neutral-300">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}
