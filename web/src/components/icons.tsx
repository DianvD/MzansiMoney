import type { ReactNode } from "react";

// Minimal Lucide-style stroke icons - no dependency, currentColor.
const PATHS: Record<string, ReactNode> = {
  dashboard: (
    <>
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </>
  ),
  transactions: (
    <>
      <path d="m16 3 4 4-4 4" />
      <path d="M20 7H4" />
      <path d="m8 21-4-4 4-4" />
      <path d="M4 17h16" />
    </>
  ),
  bills: (
    <>
      <path d="M5 2v20l2.5-1.5L10 22l2.5-1.5L15 22l2.5-1.5L20 22V2l-2.5 1.5L15 2l-2.5 1.5L10 2 7.5 3.5 5 2Z" />
      <path d="M9 8h6" />
      <path d="M9 12h6" />
    </>
  ),
  wealth: (
    <>
      <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
      <polyline points="16 7 22 7 22 13" />
    </>
  ),
  import: (
    <>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </>
  ),
  menu: (
    <>
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </>
  ),
  close: (
    <>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </>
  ),
  lock: (
    <>
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </>
  ),
  eye: (
    <>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  eyeOff: (
    <>
      <path d="m2 2 20 20" />
      <path d="M6.7 6.7C3.7 8.6 2 12 2 12s3.5 7 10 7c2.2 0 4-.6 5.5-1.6" />
      <path d="M10 5.1A9.6 9.6 0 0 1 12 5c6.5 0 10 7 10 7a18 18 0 0 1-2.6 3.4" />
    </>
  ),
  recurring: (
    <>
      <path d="M17 2l4 4-4 4" />
      <path d="M3 11V9a4 4 0 0 1 4-4h14" />
      <path d="M7 22l-4-4 4-4" />
      <path d="M21 13v2a4 4 0 0 1-4 4H3" />
    </>
  ),
  home: (
    <>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V21h14V9.5" />
      <path d="M9 21v-6h6v6" />
    </>
  ),
  shield: <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />,
  // Category icons (merchant-category avatars).
  cart: (
    <>
      <circle cx="8" cy="21" r="1" />
      <circle cx="18" cy="21" r="1" />
      <path d="M2.5 3h2l2.6 12.4a2 2 0 0 0 2 1.6h7.8a2 2 0 0 0 2-1.6L21 7H6" />
    </>
  ),
  dining: (
    <>
      <path d="M5 3v6a2 2 0 0 0 4 0V3" />
      <path d="M7 9v12" />
      <path d="M16 3c-1.7 0-3 2-3 4.5S14.3 12 16 12v9" />
    </>
  ),
  fuel: (
    <>
      <path d="M4 21V5a2 2 0 0 1 2-2h5a2 2 0 0 1 2 2v16" />
      <path d="M3 21h11" />
      <path d="M4 12h9" />
      <path d="M13 8h2a2 2 0 0 1 2 2v6a1.5 1.5 0 0 0 3 0V9.5L17 6.5" />
    </>
  ),
  car: (
    <>
      <path d="M5 13l1.6-4.6A2 2 0 0 1 8.5 7h7a2 2 0 0 1 1.9 1.4L19 13" />
      <path d="M4 13h16v4h-2.5M9.5 17h-5z" />
      <path d="M4 17h3M17 17h3" />
      <circle cx="8" cy="17" r="1" />
      <circle cx="16" cy="17" r="1" />
    </>
  ),
  paw: (
    <>
      <circle cx="11" cy="16" r="3.2" />
      <circle cx="5.5" cy="11.5" r="1.3" />
      <circle cx="9" cy="7" r="1.3" />
      <circle cx="14" cy="7" r="1.3" />
      <circle cx="17" cy="11" r="1.3" />
    </>
  ),
  gamepad: (
    <>
      <rect x="2" y="6" width="20" height="12" rx="5" />
      <path d="M7 11v3M5.5 12.5h3" />
      <circle cx="15.5" cy="11.5" r=".7" />
      <circle cx="18" cy="13.5" r=".7" />
    </>
  ),
  bag: (
    <>
      <path d="M6 8h12l-1 12a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1z" />
      <path d="M9 8V6a3 3 0 0 1 6 0v2" />
    </>
  ),
  phone: (
    <>
      <rect x="7" y="2" width="10" height="20" rx="2.5" />
      <path d="M11 18h2" />
    </>
  ),
  wifi: (
    <>
      <path d="M4.5 12.5a11 11 0 0 1 15 0" />
      <path d="M8 16a6 6 0 0 1 8 0" />
      <circle cx="12" cy="19.5" r=".6" />
    </>
  ),
  medical: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="3.5" />
      <path d="M12 8.5v7M8.5 12h7" />
    </>
  ),
  building: (
    <>
      <rect x="5" y="3" width="14" height="18" rx="1" />
      <path d="M9 7h2M13 7h2M9 11h2M13 11h2M10 21v-3h4v3" />
    </>
  ),
  percent: (
    <>
      <line x1="19" y1="5" x2="5" y2="19" />
      <circle cx="6.5" cy="6.5" r="1.6" />
      <circle cx="17.5" cy="17.5" r="1.6" />
    </>
  ),
  cash: (
    <>
      <rect x="2" y="6" width="20" height="12" rx="2.5" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M5.5 9.5v0M18.5 14.5v0" />
    </>
  ),
  bolt: <path d="M13 2 4 14h7l-1 8 9-12h-7z" />,
  chevron: <polyline points="6 9 12 15 18 9" />,
  incomeArrow: (
    <>
      <path d="M12 3v10" />
      <path d="M8 9.5l4 4 4-4" />
      <path d="M5 16h14v3a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1z" />
    </>
  ),
  card: (
    <>
      <rect x="2" y="5" width="20" height="14" rx="2.5" />
      <path d="M2 10h20" />
    </>
  ),
  logout: (
    <>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </>
  ),
};

export function Icon({
  name,
  size = 20,
  className,
}: {
  name: keyof typeof PATHS | string;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {PATHS[name] ?? null}
    </svg>
  );
}
