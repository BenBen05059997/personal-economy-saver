// D61: what is unclear about a bill or charge that is about to be added. Pure: no I/O, no clock (today is `state.today`).
// One function, `checksFor`, takes a proposal (a reading waiting in To check, or a draft from Ask or MCP) and the money state and
// returns the failed checks in a fixed order, each in our own words with two to four choices. Each choice is a fixed step the
// person takes; nothing here decides, saves or sends. The reader never guesses a repeat or a last payment (D41): it asks.
// Integer minor units of the home currency, except a reading's own amount, which is in its own currency.

import type { Currency } from "@/lib/catalogue/types";
import type { CategoryKey } from "./categories";
import { dayLabel, minorMoney, minorPerUnit } from "./format";
import { gapEstimate, gapQuestion } from "./gaps";
import { sameName } from "./name-key";
import { amountOn, datesIn, nextAmountOf } from "./repeat";
import { regularCosts } from "./regular";
import { addDays, daysBetween, pendingCharges } from "./runway";
import { monthBounds, monthsBack, spendingItems } from "./spending";
import type { MoneyState, RepeatUnit } from "./types";

/** A date within this many days of another is the same bill or charge arriving twice. */
export const DUPLICATE_DAYS = 3;
/** An amount more than this share above the highest, or below the lowest, of the last three is far from the usual. */
export const FAR_PERCENT = 30;

export type CheckKind = "missing" | "already_saved" | "past_due" | "far_from_usual" | "repeat_unknown";
export const CHECK_ORDER: readonly CheckKind[] = ["missing", "already_saved", "past_due", "far_from_usual", "repeat_unknown"];

type CheckStep =
  | { do: "edit"; field: "amount" | "date" } // the person types it
  | { do: "unknown"; fields: ("amount" | "date")[] } // D55: save it as not known yet (bills only)
  | { do: "repeat"; repeat: RepeatUnit | null } // null = one-off
  | { do: "date"; date: string } // e.g. count it today
  | { do: "keep" } // as read
  | { do: "dismiss" }; // do not add it
export type CheckChoice = { label: string; step: CheckStep }; // label at most 40 characters
export type Check = { kind: CheckKind; words: string; choices: CheckChoice[] }; // 2 to 4 choices

export type Proposal = {
  source: "reading" | "bill" | "charge"; id: string; kind: "bill" | "charge";
  name: string | null; amountMinor: number | null; currency: Currency | null; date: string | null;
  repeat: RepeatUnit | null; category: CategoryKey | null; cardId: string | null;
};

type ReadingLike = { id: string; value: { kind: "bill" | "charge"; name: string | null; date: string | null; amountMinor: number | null; currency: Currency | null; category: CategoryKey | null; cardId: string | null; repeat: RepeatUnit | null } };

export function readingProposal(reading: ReadingLike): Proposal {
  const { value } = reading;
  return {
    source: "reading", id: reading.id, kind: value.kind, name: value.name, amountMinor: value.amountMinor, currency: value.currency,
    date: value.date, repeat: value.repeat, category: value.category, cardId: value.cardId,
  };
}

/** The stored id of a bill (an occurrence of a repeating bill is `<id>@<date>`). */
const storedId = (id: string) => id.split("@")[0];

/**
 * A confirmed repeating bill as a series: where it starts, how often, its last payment, the amount before any change and the change.
 * The state carries the stored bills, so a series whose next date is past the plan window (a yearly insurance due in eight months) is seen
 * like any other.
 */
type Series = { id: string; biller: string; startsOn: string; unit: RepeatUnit; repeatDay: number | null; until: string | null; amount: number | null; next: { amount: number; from: string } | null; varies: boolean };

function seriesOf(state: MoneyState): Series[] {
  return state.storedBills.flatMap(bill => bill.status === "confirmed" && bill.repeatUnit !== undefined && bill.due !== null
    ? [{ id: bill.id, biller: bill.biller, startsOn: bill.due, unit: bill.repeatUnit, repeatDay: bill.repeatDay ?? null, until: bill.repeatUntil ?? null, amount: bill.amount, next: nextAmountOf(bill), varies: bill.amountVaries === true }]
    : []);
}

/** The bills and charges waiting in To check as proposals, in home minor units; an amount or a date not known (D55) is null. */
export function pendingProposals(state: MoneyState): Proposal[] {
  const unit = minorPerUnit(state.homeCurrency);
  return [
    ...state.bills.filter(bill => bill.status === "pending").map((bill): Proposal => ({
      source: "bill", id: bill.id, kind: "bill", name: bill.biller, amountMinor: bill.amountUnknown ? null : Math.round(bill.amount * unit),
      currency: state.homeCurrency, date: bill.dueUnknown ? null : bill.due, repeat: bill.repeatUnit ?? null, category: bill.category, cardId: null,
    })),
    ...pendingCharges(state).map((charge): Proposal => ({
      source: "charge", id: charge.id, kind: "charge", name: charge.merchant, amountMinor: Math.round(charge.amount * unit),
      currency: state.homeCurrency, date: charge.date, repeat: null, category: charge.category, cardId: charge.cardId,
    })),
  ];
}

// ---------------------------------------------------------------- the rules

type Match = { words: string; sameAmount: boolean; distance: number };

function savedWords(kind: "bill" | "charge", waiting: boolean, name: string, minor: number, currency: Currency, date: string): string {
  const prefix = waiting ? "Already waiting in To check" : "Already saved";
  return kind === "bill" ? `${prefix}: ${name}, ${minorMoney(minor, currency)}, due ${dayLabel(date)}.` : `${prefix}: ${name}, ${minorMoney(minor, currency)} on ${dayLabel(date)}.`;
}

function alreadySaved(p: Proposal, state: MoneyState, waiting: readonly Proposal[]): Check | null {
  if (p.name === null || p.date === null) return null;
  const name = p.name, date = p.date;
  const unit = minorPerUnit(state.homeCurrency);
  const home = p.currency === state.homeCurrency;
  const near = (other: string) => Math.abs(daysBetween(date, other)) <= DUPLICATE_DAYS;
  const equal = (minor: number) => home && p.amountMinor !== null && p.amountMinor === minor;
  const matches: Match[] = [];

  if (p.kind === "bill") {
    for (const bill of state.bills) {
      if (bill.startsOn !== undefined || bill.estimated || bill.uncounted || bill.amountUnknown || bill.dueUnknown) continue; // (a): a one-off or a pending bill with both known
      if (storedId(bill.id) === p.id || !sameName(bill.biller, name) || !near(bill.due)) continue;
      const minor = Math.round(bill.amount * unit);
      if (equal(minor)) matches.push({ words: savedWords("bill", bill.status === "pending", bill.biller, minor, state.homeCurrency, bill.due), sameAmount: true, distance: Math.abs(daysBetween(date, bill.due)) });
    }
    for (const series of seriesOf(state)) { // (b): a confirmed repeating series, at any amount, wherever its next date falls; an amount-varies series links instead (D54)
      if (series.varies || series.id === p.id || !sameName(series.biller, name)) continue;
      const dates = datesIn({ due: series.startsOn, repeatUnit: series.unit, repeatDay: series.repeatDay, repeatUntil: series.until }, addDays(date, -DUPLICATE_DAYS), addDays(date, DUPLICATE_DAYS));
      if (dates.length === 0) continue;
      const found = dates.reduce((best, d) => (Math.abs(daysBetween(date, d)) < Math.abs(daysBetween(date, best)) ? d : best));
      const minor = Math.round(amountOn(series.amount ?? 0, series.next, found) * unit);
      const every = series.unit === "month" ? "every month" : "every year";
      const sameAmount = equal(minor);
      matches.push({
        words: sameAmount ? savedWords("bill", false, series.biller, minor, state.homeCurrency, found)
          : `${series.biller} is already counted on ${dayLabel(found)}: ${minorMoney(minor, state.homeCurrency)}, ${every}.${p.amountMinor !== null && p.currency !== null ? ` This one is ${minorMoney(p.amountMinor, p.currency)}.` : ""}`,
        sameAmount, distance: Math.abs(daysBetween(date, found)),
      });
    }
  } else {
    for (const charge of state.charges) { // (c)
      if (charge.id === p.id || !sameName(charge.merchant, name) || !near(charge.date)) continue;
      if (p.cardId !== null && charge.cardId !== p.cardId) continue;
      const minor = Math.round(charge.amount * unit);
      if (equal(minor)) matches.push({ words: savedWords("charge", charge.status === "pending", charge.merchant, minor, state.homeCurrency, charge.date), sameAmount: true, distance: Math.abs(daysBetween(date, charge.date)) });
    }
  }
  for (const other of waiting) { // (d): under rule (a), or (c) for a charge
    if (other.id === p.id || other.kind !== p.kind || other.name === null || other.date === null || other.amountMinor === null || !sameName(other.name, name) || !near(other.date)) continue;
    if (other.currency !== p.currency || !equal(other.amountMinor) || p.currency === null) continue;
    if (p.kind === "charge" && p.cardId !== null && other.cardId !== null && other.cardId !== p.cardId) continue;
    matches.push({ words: savedWords(p.kind, true, other.name, other.amountMinor, p.currency, other.date), sameAmount: true, distance: Math.abs(daysBetween(date, other.date)) });
  }
  if (matches.length === 0) return null;
  const best = [...matches].sort((a, b) => Number(b.sameAmount) - Number(a.sameAmount) || a.distance - b.distance)[0];
  return {
    kind: "already_saved", words: best.words,
    choices: [{ label: "Same one, don't add it", step: { do: "dismiss" } }, { label: "A different one, add it", step: { do: "keep" } }],
  };
}

function missing(p: Proposal, state: MoneyState): Check | null {
  const noAmount = p.amountMinor === null, noDate = p.date === null;
  if (!noAmount && !noDate) return null;
  const words = gapQuestion({
    name: p.name ?? (p.kind === "bill" ? "Bill" : "Charge"), missing: [...(noAmount ? ["amount" as const] : []), ...(noDate ? ["date" as const] : [])],
    due: p.date, amountMinor: p.amountMinor, currency: p.currency ?? state.homeCurrency,
  });
  const fields = [...(noAmount ? ["amount" as const] : []), ...(noDate ? ["date" as const] : [])];
  if (p.kind === "charge") {
    return { kind: "missing", words, choices: [{ label: "Type it in", step: { do: "edit", field: fields[0] } }, { label: "Don't add it", step: { do: "dismiss" } }] };
  }
  return {
    kind: "missing", words,
    choices: [
      { label: noAmount && noDate ? "Type them in" : noAmount ? "Type the amount" : "Type the date", step: { do: "edit", field: fields[0] } },
      { label: "Not known yet", step: { do: "unknown", fields } },
    ],
  };
}

function pastDue(p: Proposal, state: MoneyState): Check | null {
  if (p.kind !== "bill" || p.date === null || p.date >= state.today) return null;
  return {
    kind: "past_due", words: `The due date, ${dayLabel(p.date)}, has passed.`,
    choices: [
      { label: "Paid already", step: { do: "keep" } },
      { label: "Not paid yet, count it today", step: { do: "date", date: state.today } },
      { label: "Fix the date", step: { do: "edit", field: "date" } },
    ],
  };
}

function farFromUsual(p: Proposal, state: MoneyState): Check | null {
  if (p.kind !== "bill" || p.name === null || p.amountMinor === null || p.currency !== state.homeCurrency) return null;
  const name = p.name, unit = minorPerUnit(state.homeCurrency), money = (minor: number) => minorMoney(minor, state.homeCurrency);
  const history = state.bills.flatMap(bill => bill.status === "confirmed" && bill.repeatUnit === undefined && bill.startsOn === undefined && !bill.amountUnknown && !bill.dueUnknown
    && sameName(bill.biller, name) && (p.date === null || bill.due < p.date)
    ? [{ due: bill.due, amountMinor: Math.round(bill.amount * unit), biller: bill.biller, seriesId: bill.seriesBillId }] : []);
  const estimate = gapEstimate(history, null);
  const amount = p.amountMinor, this_ = `This one is ${money(amount)}.`;
  if (estimate !== null) {
    if (!(amount * 100 > estimate.highMinor * (100 + FAR_PERCENT) || amount * 100 < estimate.lowMinor * (100 - FAR_PERCENT))) return null;
    const latest = history.reduce((newest, bill) => bill.due > newest.due || (bill.due === newest.due && bill.biller > newest.biller) ? bill : newest);
    const matchedSeries = latest.seriesId === undefined ? undefined : seriesOf(state).find(series => series.id === latest.seriesId);
    const shown = matchedSeries?.biller ?? latest.biller;
    const usual = estimate.count === 1 ? `Your last ${shown} bill was ${money(estimate.highMinor)}.`
      : `${shown} is usually ${money(estimate.lowMinor)}–${money(estimate.highMinor)} (your last ${estimate.count} bills).`;
    return farCheck(`${usual} ${this_}`);
  }
  const date = p.date ?? state.today;
  const series = seriesOf(state).find(one => !one.varies && one.amount !== null && sameName(one.biller, name));
  if (!series || series.amount === null) return null;
  const usual = Math.round(amountOn(series.amount, series.next, date) * unit);
  if (!(amount * 100 > usual * (100 + FAR_PERCENT) || amount * 100 < usual * (100 - FAR_PERCENT))) return null;
  return farCheck(`${series.biller} is ${money(usual)} ${series.unit === "month" ? "every month" : "every year"}. ${this_}`);
}

const farCheck = (words: string): Check => ({
  kind: "far_from_usual", words,
  choices: [{ label: "That's right", step: { do: "keep" } }, { label: "Fix the amount", step: { do: "edit", field: "amount" } }, { label: "Don't add it", step: { do: "dismiss" } }],
});

function repeatUnknown(p: Proposal, state: MoneyState): Check | null {
  if (p.kind !== "bill" || p.repeat !== null || p.name === null) return null;
  const name = p.name;
  if (seriesOf(state).some(one => sameName(one.biller, name))) return null;
  const from = `${monthsBack(state.today.slice(0, 7), 3)}-01`, to = monthBounds(state.today.slice(0, 7)).last;
  const regular = regularCosts(spendingItems(state, from, to), state.homeCurrency, state.today);
  if (regular.items.some(item => sameName(item.label, name))) return null;
  return {
    kind: "repeat_unknown", words: `Does ${p.name} come again?`,
    choices: [
      { label: "Just this once", step: { do: "repeat", repeat: null } },
      { label: "Every month", step: { do: "repeat", repeat: "month" } },
      { label: "Every year", step: { do: "repeat", repeat: "year" } },
      { label: "Not sure", step: { do: "repeat", repeat: null } },
    ],
  };
}

/** The failed checks for one proposal, in `CHECK_ORDER`. `waiting` are the other proposals waiting in To check (readings), compared as saved ones are. */
export function checksFor(proposal: Proposal, state: MoneyState, waiting: readonly Proposal[] = []): Check[] {
  return [missing(proposal, state), alreadySaved(proposal, state, waiting), pastDue(proposal, state), farFromUsual(proposal, state), repeatUnknown(proposal, state)]
    .filter((check): check is Check => check !== null);
}
