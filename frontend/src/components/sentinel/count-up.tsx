import { useEffect, useLayoutEffect, useState } from "react";

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** A number that counts up from 0 when it first appears (instant with reduced motion). */
export function CountUp({ value, durationMs = 650 }: { value: number; durationMs?: number }) {
  const [shown, setShown] = useState(value);
  useIsoLayoutEffect(() => {
    if (
      value <= 0 ||
      typeof window === "undefined" ||
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    ) {
      setShown(value);
      return;
    }
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      setShown(Math.round(value * eased));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    setShown(0);
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, durationMs]);
  return <span aria-label={String(value)}>{shown.toLocaleString("en-CA")}</span>;
}
