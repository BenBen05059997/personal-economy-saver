import { useEffect, useRef, useState } from "react";
import type { Currency } from "@/lib/catalogue/types";

/** A round step (1, 2 or 5 times a power of ten) that gives about `ticks` gridlines over `range`. */
export function niceStep(range: number, ticks = 4): number {
  const raw = Math.max(range, 1e-9) / ticks, power = 10 ** Math.floor(Math.log10(raw)), f = raw / power;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * power;
}

/** "¥200k", "$1.5k", "−¥20k", "¥0": a whole-unit amount on an axis. */
export function compact(value: number, currency: Currency): string {
  const symbol = currency === "JPY" ? "¥" : "$", abs = Math.abs(value);
  const trim = (n: number) => String(Math.round(n * 10) / 10);
  const body = abs >= 1e6 ? `${trim(abs / 1e6)}M` : abs >= 1e3 ? `${trim(abs / 1e3)}k` : String(Math.round(abs));
  return `${value < 0 && abs >= 0.5 ? "−" : ""}${symbol}${body}`;
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-11-27" -> "Fri, Nov 27". */
export function longDay(iso: string): string {
  const day = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return `${DAYS[day]}, ${MONTHS[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}`;
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
