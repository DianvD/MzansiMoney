import { useEffect, useRef, useState, type ReactNode } from "react";

// Custom pull-to-refresh for mobile. The browser's native pull-to-refresh is
// disabled in index.css (overscroll-behavior) because it reloaded the whole PWA
// and bounced you to sign-in. This reloads DATA only - it calls onRefresh()
// (which re-pulls Firestore) without touching the page or your session.

const THRESHOLD = 70;   // px of pull needed to trigger a refresh
const MAX_PULL = 110;   // px the indicator can travel
const RESIST = 0.5;     // drag resistance (half the finger movement)

export default function PullToRefresh({
  onRefresh,
  children,
}: {
  onRefresh: () => Promise<void>;
  children: ReactNode;
}) {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef<number | null>(null);
  const pullRef = useRef(0);
  const refreshingRef = useRef(false);

  const apply = (v: number) => { pullRef.current = v; setPull(v); };

  useEffect(() => {
    // Touch devices only - never interfere with a desktop trackpad / mouse.
    if (!window.matchMedia("(pointer: coarse)").matches) return;

    function onStart(e: TouchEvent) {
      if (refreshingRef.current || window.scrollY > 0) return;
      startY.current = e.touches[0].clientY;
    }
    function onMove(e: TouchEvent) {
      if (startY.current === null || refreshingRef.current) return;
      const dy = e.touches[0].clientY - startY.current;
      if (dy <= 0 || window.scrollY > 0) { if (pullRef.current) apply(0); startY.current = null; return; }
      const dist = Math.min(MAX_PULL, dy * RESIST);
      apply(dist);
      if (e.cancelable) e.preventDefault();   // hold the page still while pulling
    }
    async function onEnd() {
      if (startY.current === null) return;
      startY.current = null;
      if (pullRef.current >= THRESHOLD && !refreshingRef.current) {
        refreshingRef.current = true;
        setRefreshing(true);
        apply(THRESHOLD);
        try { await onRefresh(); } finally {
          refreshingRef.current = false;
          setRefreshing(false);
          apply(0);
        }
      } else {
        apply(0);
      }
    }

    document.addEventListener("touchstart", onStart, { passive: true });
    document.addEventListener("touchmove", onMove, { passive: false });
    document.addEventListener("touchend", onEnd);
    document.addEventListener("touchcancel", onEnd);
    return () => {
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onEnd);
      document.removeEventListener("touchcancel", onEnd);
    };
  }, [onRefresh]);

  const visible = pull > 0 || refreshing;
  return (
    <>
      <div
        className="pointer-events-none fixed inset-x-0 top-0 z-50 flex justify-center transition-opacity duration-150"
        style={{ opacity: visible ? 1 : 0 }}
        aria-hidden={!visible}
      >
        <div
          className="mt-3 flex h-9 w-9 items-center justify-center rounded-full border border-neutral-700 bg-neutral-900 text-indigo-400 shadow-lg"
          style={{ transform: `translateY(${Math.max(0, pull - 12)}px)` }}
        >
          <svg
            width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
            className={refreshing ? "animate-spin" : ""}
            style={refreshing ? undefined : { transform: `rotate(${pull * 3}deg)` }}
          >
            <path d="M21 12a9 9 0 1 1-2.64-6.36" />
            <polyline points="21 3 21 9 15 9" />
          </svg>
        </div>
      </div>
      {children}
    </>
  );
}
