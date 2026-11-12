// Missing data (D55). Pure: no I/O, no clock. A known bill is never ¥0 and an assumed number always says where it came from.
// A bill can be stored with its amount or its date not known yet. An unknown amount is estimated from the same name key's last
// three real amounts (earlier linked bills first for an amount-varies series); with no history it is not estimated and counts for nothing.
// An unknown date counts as due today. `openGaps` lists every gap for every face; the word functions are the only place the
// words are written. Integer minor units of the home currency throughout, except where a field says it is in units like `Bill.amount`.

import type { Currency } from "@/lib/catalogue/types";
import type { CategoryKey } from "./categories";
import { dayLabel, minorMoney, minorPerUnit, plural } from "./format";
import { sameName } from "./name-key";
import { daysBetween, low, series, WINDOW_DAYS } from "./runway";
import type { Bill, GapBasis, MoneyState, RealBill, RepeatUnit } from "./types";

/** The two phrases every face uses for a missing value. */
export const NOT_KNOWN = "not known";
export const NOT_KNOWN_YET = "not known yet";
export const AMOUNT_NOT_KNOWN = `amount ${NOT_KNOWN}`;
export const DATE_NOT_KNOWN = `date ${NOT_KNOWN}`;
/** The form labels and the Activity line for a value saved as not known yet: "Amount not known yet", "Date not known yet". */
export const AMOUNT_NOT_KNOWN_YET = `Amount ${NOT_KNOWN_YET}`;
export const DATE_NOT_KNOWN_YET = `Date ${NOT_KNOWN_YET}`;

/** How many of the latest real bills an estimate averages. */
export const GAP_HISTORY = 3;
/** A gap is urgent when it is due within this many days (an overdue one included). */
export const URGENT_DAYS = 3;

type GapEstimate = { averageMinor: number; lowMinor: number; highMinor: number; count: number };

/**
 * The estimate from real bills: the last `GAP_HISTORY` amounts by due date (ties by amount), strictly before `before` when it is
 * given and the latest ones when the date is not known, averaged and rounded half up to the minor unit. Null with no history.
 */
export function gapEstimate(history: readonly RealBill[], before: string | null): GapEstimate | null {
  const last = history.filter(bill => before === null || bill.due < before)
    .sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : a.amountMinor - b.amountMinor)).slice(-GAP_HISTORY);
  if (last.length === 0) return null;
  const amounts = last.map(bill => bill.amountMinor);
  return {
    averageMinor: Math.round(amounts.reduce((sum, amount) => sum + amount, 0) / amounts.length),
    lowMinor: Math.min(...amounts), highMinor: Math.max(...amounts), count: amounts.length,
  };
}

type HistoryBill = {
  biller: string; category: CategoryKey; status: "confirmed" | "pending"; repeatUnit?: RepeatUnit;
  amount: number | null; due: string | null; amountUnknown?: true; dueUnknown?: true;
};

/**
 * The real bills a bill named `biller` in `category` is estimated from when it has no series: the confirmed one-off bills with a
 * known amount and a known date, the same category and the same name key (a repeating bill is not a real bill). `unit` is the
 * minor units per unit of `Bill.amount`.
 */
export function nameHistory(bills: readonly HistoryBill[], biller: string, category: CategoryKey, unit: number): RealBill[] {
  return bills.flatMap(bill => bill.status === "confirmed" && bill.repeatUnit === undefined && bill.category === category
    && bill.amount !== null && !bill.amountUnknown && bill.due !== null && !bill.dueUnknown && sameName(bill.biller, biller)
    ? [{ due: bill.due, amountMinor: Math.round(bill.amount * unit) }] : []);
}

/** The fields an estimate sets on an engine bill, in units like `Bill.amount`; an uncounted bill when there is no estimate. */
export function estimatedFields(estimate: GapEstimate | null, unit: number, from: GapBasis["from"]):
  { amount: number; estimated: true; amountHigh: number; basis: GapBasis } | { amount: 0; uncounted: true } {
  if (estimate === null) return { amount: 0, uncounted: true };
  return {
    amount: estimate.averageMinor / unit, estimated: true, amountHigh: estimate.highMinor / unit,
    basis: { count: estimate.count, low: estimate.lowMinor / unit, high: estimate.highMinor / unit, from },
  };
}

// ---------------------------------------------------------------- the list

export type Gap = {
  source: "bill" | "reading";
  id: string; // the stored bill's id (a series' next occurrence is its stored id) or the reading's id
  name: string;
  category: CategoryKey | null;
  status: "confirmed" | "pending" | "to_check";
  missing: ("amount" | "date")[];
  due: string | null; // null when not known
  countedOn: string; // the date it counts on: its due date, or today when that is not known
  amountMinor: number | null; // the amount when it is known (the reading's own currency for a reading)
  estimate: (GapEstimate & { from: GapBasis["from"] }) | null;
  urgent: boolean;
  why: "due_soon" | "could_change_sentence" | null;
  currency: Currency;
};

/** A reading waiting in To check, as far as gaps look at it: its proposed fields. */
type GapReading = { id: string; value: { kind: "bill" | "charge"; name: string | null; date: string | null; amountMinor: number | null; currency: Currency | null; category: CategoryKey | null } };

const storedId = (id: string) => id.split("@")[0];
const inWindow = (state: MoneyState, date: string) => { const i = daysBetween(state.today, date); return i >= 0 && i < WINDOW_DAYS; };

/** The confirmed bills in the window the sentence has to say something about, one per stored bill, soonest first. */
export function uncountedInWindow(state: MoneyState): Bill[] {
  const seen = new Set<string>();
  return state.bills.filter(bill => {
    if (bill.status !== "confirmed" || !bill.uncounted || !inWindow(state, bill.due) || seen.has(storedId(bill.id))) return false;
    seen.add(storedId(bill.id));
    return true;
  });
}

/**
 * The confirmed estimated bills (by due date) whose high end, counted in the usual case instead of their average, turns the
 * usual-case low point from not short to short; each is tested alone, the others staying at their average. Empty when none does,
 * or when the usual case is short already.
 */
export function highEndsTurningShort(state: MoneyState): { bill: Bill; shortOn: string }[] {
  if (low(series(state, "expected")).amount < 0) return [];
  const turning: { bill: Bill; shortOn: string }[] = [];
  const seen = new Set<string>();
  for (const bill of state.bills) {
    if (bill.status !== "confirmed" || bill.amountUnknown !== true || !bill.estimated || bill.amountHigh === undefined || !inWindow(state, bill.due) || seen.has(storedId(bill.id))) continue;
    seen.add(storedId(bill.id));
    const point = low(series({ ...state, bills: state.bills.map(other => (other.id === bill.id ? { ...other, amount: bill.amountHigh! } : other)) }, "expected"));
    if (point.amount < 0) turning.push({ bill, shortOn: point.date });
  }
  return turning;
}

/**
 * Every gap in the state, urgent first, then by the date it counts on, then by name: one per bill (pending or confirmed) whose amount or
 * date is not known, and one per reading in To check that lacks an amount or a date. A gap is urgent when it is due within
 * `URGENT_DAYS` days (a date not known counts as today) or when it could change the sentence (an uncounted bill in the window, or an
 * estimated one whose high end would make you short).
 */
export function openGaps(state: MoneyState, readings: readonly GapReading[] = []): Gap[] {
  const unit = minorPerUnit(state.homeCurrency);
  const changing = new Set(uncountedInWindow(state).map(bill => storedId(bill.id)));
  for (const { bill } of highEndsTurningShort(state)) changing.add(storedId(bill.id));
  const gaps: Gap[] = [];
  const seen = new Set<string>();
  const urgency = (countedOn: string, changesSentence: boolean) => {
    const dueSoon = daysBetween(state.today, countedOn) <= URGENT_DAYS;
    return { urgent: dueSoon || changesSentence, why: dueSoon ? "due_soon" as const : changesSentence ? "could_change_sentence" as const : null };
  };
  for (const bill of state.bills) {
    const id = storedId(bill.id);
    if ((!bill.amountUnknown && !bill.dueUnknown) || seen.has(id)) continue;
    seen.add(id);
    const missing: Gap["missing"] = [...(bill.amountUnknown ? ["amount" as const] : []), ...(bill.dueUnknown ? ["date" as const] : [])];
    gaps.push({
      source: "bill", id, name: bill.biller, category: bill.category, status: bill.status, missing,
      due: bill.dueUnknown ? null : bill.due, countedOn: bill.due, amountMinor: bill.amountUnknown ? null : Math.round(bill.amount * unit),
      estimate: bill.amountUnknown && bill.estimated && bill.basis && bill.amountHigh !== undefined
        ? { averageMinor: Math.round(bill.amount * unit), lowMinor: Math.round(bill.basis.low * unit), highMinor: Math.round(bill.amountHigh * unit), count: bill.basis.count, from: bill.basis.from } : null,
      ...urgency(bill.due, bill.status === "confirmed" && changing.has(id)), currency: state.homeCurrency,
    });
  }
  for (const { id, value } of readings) {
    const missing: Gap["missing"] = [...(value.amountMinor === null ? ["amount" as const] : []), ...(value.date === null ? ["date" as const] : [])];
    if (missing.length === 0) continue;
    const estimate = value.amountMinor === null && value.name && value.category
      ? gapEstimate(nameHistory(state.bills, value.name, value.category, unit), value.date) : null;
    gaps.push({
      source: "reading", id, name: value.name ?? (value.kind === "bill" ? "Bill" : "Charge"), category: value.category, status: "to_check", missing,
      due: value.date, countedOn: value.date ?? state.today, amountMinor: value.amountMinor,
      estimate: estimate && { ...estimate, from: "bills" }, ...urgency(value.date ?? state.today, false), currency: value.currency ?? state.homeCurrency,
    });
  }
  return gaps.sort((a, b) => Number(b.urgent) - Number(a.urgent) || (a.countedOn < b.countedOn ? -1 : a.countedOn > b.countedOn ? 1 : 0) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

// ---------------------------------------------------------------- the words

/** "about ¥9,330 (¥8,640–¥10,020, from your last 3 bills)", "about ¥8,640 (from your last bill)", "amount not known". */
export function gapAmountWords(gap: Gap): string {
  const e = gap.estimate;
  if (e === null) return AMOUNT_NOT_KNOWN;
  const money = (minor: number) => minorMoney(minor, gap.currency);
  if (e.count === 1) return `about ${money(e.averageMinor)} (from your last bill)`;
  return `about ${money(e.averageMinor)} (${money(e.lowMinor)}–${money(e.highMinor)}, from your last ${e.count} bills)`;
}

export function gapDateWords(gap: Pick<Gap, "missing">): string {
  if (!gap.missing.includes("date")) throw new Error("This gap is not missing its date");
  return `${DATE_NOT_KNOWN}, counted as due now`;
}

/** The one question To check asks: "Minato Gas, due Nov 25: how much?", "Minato Gas, ¥9,800: when is it due?", "Minato Gas: how much, and when is it due?". */
export function gapQuestion(gap: Pick<Gap, "name" | "missing" | "due" | "amountMinor" | "currency"> & Partial<Gap>): string {
  const amount = gap.missing.includes("amount"), date = gap.missing.includes("date");
  if (amount && date) return `${gap.name}: how much, and when is it due?`;
  if (amount) return `${gap.name}, due ${dayLabel(gap.due!)}: how much?`;
  return `${gap.name}, ${minorMoney(gap.amountMinor!, gap.currency)}: when is it due?`;
}

/** The confirmed bills with a gap, in `openGaps` order: the ones To check lists under "Missing" (pending bills and readings show theirs on their own rows). */
export function confirmedGaps(state: MoneyState): Gap[] {
  return openGaps(state).filter(gap => gap.source === "bill" && gap.status === "confirmed");
}

/** What the forecast does with the amount meanwhile: "Counted at about ¥9,330 (…)", or "Not counted until you enter it". */
export function gapCountedWords(gap: Gap): string {
  if (!gap.missing.includes("amount")) throw new Error("This gap is not missing its amount");
  return gap.estimate === null ? "Not counted until you enter it" : `Counted at ${gapAmountWords(gap)}`;
}

/** Everything the forecast does meanwhile, in one muted line: the amount's words, then the date's, joined by " · ". */
export function gapMeanwhileWords(gap: Gap): string {
  return [...(gap.missing.includes("amount") ? [gapCountedWords(gap)] : []), ...(gap.missing.includes("date") ? [gapDateWords(gap)] : [])].join(" · ");
}

/** The small label on an urgent gap; null when it is not urgent. */
export function gapUrgencyWords(gap: Pick<Gap, "why">): string | null {
  return gap.why === "due_soon" ? "Due soon" : gap.why === "could_change_sentence" ? "Could change your forecast" : null;
}

/** The muted line under a month category or a search result group: "1 bill not counted: Minato Gas (amount not known)"; null for none. */
export function gapUncountedWords(names: readonly string[]): string | null {
  if (names.length === 0) return null;
  return `${plural(names.length, "bill")} not counted: ${names.map(name => `${name} (${AMOUNT_NOT_KNOWN})`).join(", ")}`;
}
