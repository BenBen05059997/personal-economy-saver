import type { Currency } from "@/lib/catalogue/types";
import { aboutMoney, minorMoney, minorPerUnit, money, ordinal } from "./format";
import { highEndsTurningShort, uncountedInWindow } from "./gaps";
import { arrivals, daysBetween, low, safeToSpend, series, WINDOW_DAYS, type LowPoint, type SafeToSpend } from "./runway";
import type { MoneyState } from "./types";

/** Whether any client payment is expected to land in the next 30 days. Without one, "even if clients pay late" says nothing true. */
export function expectsClientPayment(state: MoneyState, days = WINDOW_DAYS) {
  return arrivals(state).some(arrival => daysBetween(state.today, arrival.expectedOn) < days);
}

type SentenceParts = {
  lead: string;
  emphasis: string;
  /** lead + " " + emphasis: what Ask, the runway events and the LINE message say. */
  text: string;
  /** The clients the lead names, in order, that open to one client page (a first name two clients share is plain text). */
  clients: { id: string; name: string }[];
  /** The lead cut into plain words and the clients it names, in order; joined, it is `lead`. */
  leadParts: (string | { id: string; name: string })[];
  /** The emphasis cut at the day: `before` + " " + `on` + "." is `emphasis` (`on` is null when the emphasis names no day). */
  emphasisParts: { before: string; on: string | null };
  /** The date the emphasis names: the lowest point of the line it states; null when there is nothing to forecast. */
  day: string | null;
  /** Whether the sentence says you are short. */
  short: boolean;
  /** D55: what the sentence is not counting, or counts at an estimate that could make you short; null when no gap could change its answer. */
  note: string | null;
};

function parts(leadParts: SentenceParts["leadParts"], before: string, on: string | null, day: string | null, short: boolean): SentenceParts {
  const lead = leadParts.map(part => typeof part === "string" ? part : part.name).join("");
  const emphasis = on ? `${before} ${on}.` : before;
  return {
    lead, emphasis, text: lead + " " + emphasis,
    clients: leadParts.filter((part): part is { id: string; name: string } => typeof part !== "string"),
    leadParts, emphasisParts: { before, on }, day, short, note: null,
  };
}

function composeSentence(safe: SafeToSpend, usualLow: LowPoint, currency: Currency, clientsExpected = true, known: readonly { id: string; name: string }[] = []): SentenceParts {
  const amount = (value: number) => money(Math.abs(value), currency);
  const on = (point: LowPoint) => "on the " + ordinal(Number(point.date.slice(-2)));
  if (safe.low.amount >= 0) {
    const lead = clientsExpected ? "You're fine for the next 30 days, even if clients pay late. Lowest point" : "You're fine for the next 30 days. Lowest point";
    return parts([lead], amount(safe.low.amount), on(safe.low), safe.low.date, false);
  }
  if (usualLow.amount < 0) {
    return parts(["Even if clients pay as usual, you're"], amount(usualLow.amount) + " short", on(usualLow), usualLow.date, true);
  }
  const names = safe.lateClients;
  const named = (name: string) => {
    const matches = known.filter(client => client.name.split(" ")[0] === name);
    return matches.length === 1 ? { id: matches[0].id, name } : name;
  };
  const list = new Intl.ListFormat("en", { style: "long", type: "conjunction" }).formatToParts(names);
  const leadParts: SentenceParts["leadParts"] = [];
  const push = (text: string) => { if (typeof leadParts[leadParts.length - 1] === "string") leadParts[leadParts.length - 1] += text; else leadParts.push(text); };
  if (names.length) {
    push("You're fine if ");
    for (const piece of list) {
      if (piece.type === "element") {
        const part = named(piece.value);
        if (typeof part === "string") push(part); else leadParts.push(part);
      } else push(piece.value);
    }
    push(` ${names.length === 1 ? "pays" : "pay"} as usual. If ${names.length === 1 ? "that payment is" : "they're"} late, you're`);
  } else push("If client payments are late, you're");
  return parts(leadParts, amount(safe.shortBy) + " short", on(safe.low), safe.low.date, true);
}

/** D47: nothing to forecast (no confirmed bill, no confirmed card charge, no closed statement, no invoice still to be paid): pending items count for nothing, as everywhere else. */
function hasNothingToForecast(state: MoneyState) {
  return !state.bills.some(bill => bill.status === "confirmed")
    && !state.charges.some(charge => charge.status === "confirmed")
    && !state.statements.some(statement => !statement.paid)
    && !state.invoices.some(invoice => invoice.status !== "paid" && invoice.status !== "closed");
}

export function homeSentence(state: MoneyState): SentenceParts {
  if (hasNothingToForecast(state)) {
    return parts(["Add your bills and the clients who pay you to see your next 30 days."], `Bank balance ${money(state.bank, state.homeCurrency)}.`, null, null, false);
  }
  // The amount and low point do not use the monthly-essentials threshold (only the verdict does).
  return { ...composeSentence(safeToSpend(state, 0), low(series(state, "expected")), state.homeCurrency, expectsClientPayment(state), state.clients), note: gapNote(state) };
}

/**
 * D55: "Not counted: Minato Gas (amount not known)." for the confirmed bills in the window with nothing to estimate them from, then
 * "Minato Gas is counted at about ¥9,330; at ¥10,020 you'd be short on the 25th." for the first estimated bill whose high end would
 * make the usual case short. Null when neither applies.
 */
function gapNote(state: MoneyState): string | null {
  const unit = minorPerUnit(state.homeCurrency);
  const notes: string[] = [];
  const uncounted = uncountedInWindow(state).map(bill => bill.biller);
  if (uncounted.length > 0) {
    notes.push(`Not counted: ${new Intl.ListFormat("en", { style: "long", type: "conjunction" }).format(uncounted)} (${uncounted.length === 1 ? "amount" : "amounts"} not known).`);
  }
  const [turns] = highEndsTurningShort(state);
  if (turns !== undefined) {
    notes.push(`${turns.bill.biller} is counted at ${aboutMoney(Math.round(turns.bill.amount * unit), state.homeCurrency)}; at ${minorMoney(Math.round(turns.bill.amountHigh! * unit), state.homeCurrency)} you'd be short on the ${ordinal(Number(turns.shortOn.slice(-2)))}.`);
  }
  return notes.length > 0 ? notes.join(" ") : null;
}
