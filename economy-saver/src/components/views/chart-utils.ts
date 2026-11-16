import { useEffect, useRef, useState } from "react";
import type { Currency } from "@/lib/catalogue/types";

/** A round step (1, 2 or 5 times a power of ten) that gives about `ticks` gridlines over `range`, never smaller than `unit` (a whole currency unit, so no two labels repeat). */
export function niceStep(range: number, ticks = 4, unit = 1): number {
  const raw = Math.max(range, 1e-9) / ticks, power = 10 ** Math.floor(Math.log10(raw)), f = raw / power;
  return Math.max((f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * power, unit);
}

/** "¥200k", "$1.5k", "−¥20k", "¥0": a whole-unit amount on an axis. */
export function compact(value: number, currency: Currency): string {
  const symbol = currency === "JPY" ? "¥" : "$", abs = Math.abs(value);
  const trim = (n: number) => String(Math.round(n * 10) / 10);
  const body = abs >= 1e6 ? `${trim(abs / 1e6)}M` : abs >= 1e3 ? `${trim(abs / 1e3)}k` : String(Math.round(abs));
  return `${value < 0 && abs >= 0.5 ? "−" : ""}${symbol}${body}`;
}

/** The width in CSS pixels of the element the ref is on; `first` until it is measured. */
export function useWidth<T extends HTMLElement>(first = 720) {
  const ref = useRef<T>(null), [width, setWidth] = useState(first);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const measure = () => { const w = Math.round(node.getBoundingClientRect().width); if (w > 0) setWidth(w); };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}
