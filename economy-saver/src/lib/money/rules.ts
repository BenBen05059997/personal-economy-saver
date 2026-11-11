import type { Currency } from "@/lib/catalogue/types";
import { readAmount } from "./amount";
import { minorMoney } from "./format";
import type { RuleKind, StandingRule } from "./suggestion-types";

export const RULE_NAMES: Record<RuleKind, string> = {
  nudge_after: "Late-client link",
  statement_ahead: "Upcoming card statement",
  bill_ahead: "Upcoming bill",
  cost_up: "Regular cost increase",
  safe_below: "Minimum safe to spend",
  goal_behind: "Goal behind pace",
};

export function ruleNumberLimit(kind: RuleKind) {
  switch (kind) {
    case "nudge_after": case "statement_ahead": case "bill_ahead": return 30;
    case "cost_up": return 100;
    default: return null;
  }
}

export function readRule(kind: RuleKind, enabled: boolean, value: string | null, home: Currency): StandingRule | { problem: string } {
  const text = value?.trim() || null;
  if (kind === "goal_behind") {
    return text ? { problem: "This rule uses on or off." } : { enabled, threshold: null, currency: null };
  }
  if (text === null) {
    return enabled ? { problem: "This rule needs a number." } : { enabled, threshold: null, currency: null };
  }
  if (kind === "safe_below") {
    const amount = readAmount(text, home, false);
    if ("problem" in amount) return amount;
    if (amount.minor <= 0) return { problem: "Enter a positive amount in the household’s home currency." };
    return { enabled, threshold: amount.minor, currency: home };
  }
  const limit = ruleNumberLimit(kind)!;
  const threshold = Number(text);
  return /^\d+$/.test(text) && threshold >= 1 && threshold <= limit
    ? { enabled, threshold, currency: null } : { problem: "Use a whole number from 1 to " + limit + " for this rule." };
}

export function ruleWords(kind: RuleKind, rule: StandingRule) {
  const { threshold, currency, enabled } = rule;
  const days = threshold === 1 ? "1 day" : threshold + " days";
  let words: string;
  switch (kind) {
    case "nudge_after": words = threshold === null ? "Suggest sending a late client the link again" : "Suggest sending a client the link again " + days + " after their usual pay day"; break;
    case "statement_ahead": words = threshold === null ? "Flag upcoming card statements" : "Flag a card statement up to " + days + " ahead"; break;
    case "bill_ahead": words = threshold === null ? "Flag upcoming bills" : "Flag a bill up to " + days + " ahead"; break;
    case "cost_up": words = threshold === null ? "Flag a regular cost increase" : "Flag a regular cost when it rises by more than " + threshold + "%"; break;
    case "safe_below": words = threshold === null || currency === null ? "Flag low safe to spend" : "Flag safe to spend below " + minorMoney(threshold, currency); break;
    case "goal_behind": words = "Flag a goal that is behind pace"; break;
  }
  return enabled ? words : words + " (off)";
}
