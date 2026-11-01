import type { Currency, Valued } from "@/lib/catalogue/types";

const DAY = 86_400_000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const formatters: Partial<Record<Currency, Intl.NumberFormat>> = {};

// ¥ and $ with no decimals, fixed to en-US so server and client render the same text.
export function formatMoney(amount: number, currency: Currency): string {
  const f = (formatters[currency] ??= new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }));
  return f.format(Math.round(amount));
}

const PER: Record<Valued["per"], string> = { year: "/yr", month: "/mo", once: " once" };

export function formatValue(v: Pick<Valued, "amount" | "currency" | "per">): string {
  return `${formatMoney(v.amount, v.currency)}${PER[v.per] ?? ""}`;
}

export function formatDays(days: number): string {
  if (days <= 0) return "today";
  return days === 1 ? "1 day" : `${days} days`;
}

// "Dec 31", from today (YYYY-MM-DD) plus a number of days. Pure UTC arithmetic, no locale.
export function formatDueDate(today: string, inDays: number): string {
  const t = Date.parse(today);
  if (Number.isNaN(t)) return "";
  const d = new Date(t + inDays * DAY);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

// "Dec 31 · 47 days"
export function formatDeadline(today: string, inDays: number): string {
  return `${formatDueDate(today, inDays)} · ${formatDays(inDays)}`;
}

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
