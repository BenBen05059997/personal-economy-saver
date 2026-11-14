// The fact record (D79): one figure with its term, case, period and meaning, worked out once and read by every face. Pure.
// Money is integer minor units; days and counts are integers; a date is ISO; a percent is rounded to one decimal.
// An unknown amount is never a money fact with 0: it is the term "not_counted" with the item in `about` (D55).

import type { Currency } from "@/lib/catalogue/types";
import { termOf, type TermName, type TermUnit } from "./terms";

export type FactCase = "as_usual" | "late" | "none";
export type FactPeriod = { on: string } | { from: string; to: string } | null;
export type FactAbout = { type: "card" | "client" | "category" | "bill" | "person" | "pot" | "invoice" | "charge" | "cost"; id: string; name: string };

export type Fact = {
  name: TermName;
  value: number | string;
  unit: TermUnit;
  currency?: Currency;
  case: FactCase;
  period: FactPeriod;
  about?: FactAbout;
  meaning: string;
  /** A view id or a tool name. */
  from: string;
  by: "engine" | "person";
};

export type FactOptions = {
  from: string;
  /** Required for a term whose case is "named"; a fixed-case term takes its own. */
  case?: "as_usual" | "late";
  currency?: Currency;
  period?: FactPeriod;
  about?: FactAbout;
};

function checkValue(name: TermName, value: number | string, unit: TermUnit, decimals: number) {
  if (unit === "money" || unit === "days" || unit === "count" || unit === "percent") {
    if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${name} needs a number, got ${String(value)}`);
    const scaled = value * 10 ** decimals;
    if (Math.abs(scaled - Math.round(scaled)) > 1e-9) throw new Error(`${name} must have at most ${decimals} decimals, got ${value}`);
  } else if (unit === "text" || unit === "date") {
    if (typeof value !== "string") throw new Error(`${name} needs text, got ${String(value)}`);
  }
}

function build(by: Fact["by"], name: TermName, value: number | string, options: FactOptions): Fact {
  const term = termOf(name);
  let factCase: FactCase;
  if (term.case === "named") {
    if (!options.case) throw new Error(`${name} must say which case it was tested on`);
    factCase = options.case;
  } else if (term.case === "none") {
    if (options.case) throw new Error(`${name} has no case`);
    factCase = "none";
  } else {
    if (options.case && options.case !== term.case) throw new Error(`${name} is always ${term.case}`);
    factCase = term.case;
  }
  checkValue(name, value, term.unit, term.decimals ?? 0);
  if (name === "not_counted" && !options.about) throw new Error("not_counted must say what is not counted, in about");
  const fact: Fact = { name, value, unit: term.unit, case: factCase, period: options.period ?? null, meaning: term.meaning, from: options.from, by };
  if (options.currency) fact.currency = options.currency;
  if (options.about) fact.about = options.about;
  return fact;
}

/** A figure the engine worked out. */
export function engineFact(name: TermName, value: number | string, options: FactOptions): Fact {
  return build("engine", name, value, options);
}

/** A figure the person gave, such as the amount they are testing. */
export function personFact(name: TermName, value: number | string, options: FactOptions): Fact {
  return build("person", name, value, options);
}

/** The first fact with this name (and this case, when given); null when there is none. */
export function fact(facts: readonly Fact[], name: TermName, factCase?: FactCase): Fact | null {
  return facts.find(item => item.name === name && (factCase === undefined || item.case === factCase)) ?? null;
}

/** The compact form for a tool result: the facts, and each term's meaning once in `meanings`, keyed by the fact's name, so no figure is without its meaning and no result repeats one. */
export function forModel(facts: readonly Fact[]) {
  const meanings: Record<string, string> = {};
  for (const item of facts) meanings[item.name] = item.meaning;
  return {
    facts: facts.map(item => ({
      name: item.name,
      value: item.value,
      unit: item.unit,
      ...(item.currency ? { currency: item.currency } : {}),
      ...(item.case !== "none" ? { case: item.case } : {}),
      ...(item.period ? { period: item.period } : {}),
      ...(item.about ? { about: item.about } : {}),
      by: item.by,
    })),
    meanings,
  };
}
