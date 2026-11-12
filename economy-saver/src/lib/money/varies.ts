// Which amount-varies series a real bill belongs to (D54). Pure: the one rule the database (linking a bill as it is saved or
// confirmed) and the reader's review card (saying it will link) share. Names match by D54's name keys, `sameName`.
import type { CategoryKey } from "./categories";
import { gapEstimate } from "./gaps";
import { occurrenceDates, variesEstimate } from "./repeat";
import { monthBounds, sameName } from "./spending";
import type { RealBill } from "./types";

/** A confirmed amount-varies monthly bill, as stored: where its series starts and its own amount (minor units). */
export type VariesSeries = { id: string; biller: string; category: CategoryKey; due: string; repeatDay: number; until?: string | null }; // until: D41, the series' last payment day

/**
 * The series a one-off bill named `bill.biller` in `bill.category`, due `bill.due`, joins: the only amount-varies series with the
 * same name key and category, unless that series already has a real bill due in the same calendar month (`taken`: the
 * series' linked real bills, by series id and due date); a second bill in one month is its own bill. Null otherwise, also
 * when two series match (the user links one by hand in Settings).
 */
export function seriesToJoin(series: VariesSeries[], taken: { seriesBillId: string; due: string }[], bill: { biller: string; category: CategoryKey; due: string }): VariesSeries | null {
  const matches = series.filter(s => s.category === bill.category && sameName(s.biller, bill.biller) && (s.until === undefined || s.until === null || bill.due <= s.until)); // D41: a bill after the last payment is its own
  if (matches.length !== 1) return null;
  const [match] = matches;
  const month = bill.due.slice(0, 7);
  return taken.some(t => t.seriesBillId === match.id && t.due.slice(0, 7) === month) ? null : match;
}

/** The occurrence of a series in the month of `date` (YYYY-MM-DD), or null when the series has none there (it starts later). */
export function occurrenceInMonth(series: Pick<VariesSeries, "due" | "repeatDay" | "until">, date: string): string | null {
  const { first, last } = monthBounds(date.slice(0, 7));
  return occurrenceDates(series.due, "month", series.repeatDay, first, last, series.until ?? null)[0] ?? null;
}

export type LinkPreview = { seriesId: string; biller: string; month: string; estimateMinor: number | null };

/**
 * What the reader's review card says before a one-off bill is confirmed: the series it would join, the month (YYYY-MM) and the
 * estimate it replaces there (minor units; null when the series has no occurrence that month). `series` are the household's
 * confirmed amount-varies bills with their stored amounts, `real` their confirmed linked real bills. Null when it would not link.
 */
export function linkPreview(series: (VariesSeries & { storedMinor: number | null })[], real: { seriesBillId: string; due: string; amountMinor: number | null }[], bill: { biller: string; category: CategoryKey; due: string }): LinkPreview | null {
  const match = seriesToJoin(series, real, bill);
  if (match === null) return null;
  const on = occurrenceInMonth(match, bill.due);
  const stored = series.find(s => s.id === match.id)!.storedMinor;
  const priced = real.flatMap((b): RealBill[] => (b.seriesBillId === match.id && b.amountMinor !== null ? [{ due: b.due, amountMinor: b.amountMinor }] : [])); // D55: a real bill without an amount takes its month but is no part of the estimate
  const estimate = on === null ? null : stored === null ? gapEstimate(priced, on)?.averageMinor ?? null : variesEstimate(priced, stored, on);
  return { seriesId: match.id, biller: match.biller, month: bill.due.slice(0, 7), estimateMinor: estimate };
}
