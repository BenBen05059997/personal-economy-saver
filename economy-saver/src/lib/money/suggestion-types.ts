import type { Currency } from "@/lib/catalogue/types";
import { hrefFor } from "@/lib/links";
import type { Fact } from "./facts";

export const RULE_KINDS = ["nudge_after", "statement_ahead", "bill_ahead", "cost_up", "safe_below", "goal_behind"] as const;
export type RuleKind = typeof RULE_KINDS[number];
export type StandingRule = { enabled: boolean; threshold: number | null; currency: Currency | null; spaceId?: string };
export type StandingRules = Record<RuleKind, StandingRule>;

export const SUGGESTION_KINDS = ["invoice_nudge", "statement_due", "bill_due", "cost_up", "cancel_by", "goal_behind", "tax_short", "safe_below"] as const;
export const SUGGESTION_ACTIONS = ["remind", "statement", "bill", "regular", "pot", "runway", "check_bill"] as const;
export type Finding = {
  kind: typeof SUGGESTION_KINDS[number];
  key: string;
  title: string;
  reason: string;
  action: typeof SUGGESTION_ACTIONS[number];
  refId: string | null;
  urgency: number;
  /** The figures the title and reason are written from (D79), worked out by the same engine functions the pictures use. */
  facts: Fact[];
};

/** Findings without a standing rule (cancellation deadlines) stay in General. */
export const FINDING_RULE: Partial<Record<Finding["kind"], RuleKind>> = {
  invoice_nudge: "nudge_after", statement_due: "statement_ahead", bill_due: "bill_ahead",
  cost_up: "cost_up", safe_below: "safe_below", goal_behind: "goal_behind", tax_short: "goal_behind",
};

export function findingsBySpace<T extends { spaceId: string | null; spaceName: string | null }>(rows: readonly T[]) {
  const groups = new Map<string | null, { id: string | null; name: string; rows: T[] }>();
  for (const row of rows) {
    const id = row.spaceName === "General" ? null : row.spaceId;
    const group = groups.get(id);
    if (group) group.rows.push(row);
    else groups.set(id, { id, name: row.spaceName ?? "General", rows: [row] });
  }
  return [...groups.values()];
}

/** The one button a finding offers: its label and where it goes. */
export function findingAction(row: { action: typeof SUGGESTION_ACTIONS[number]; refId: string | null }) {
  if (row.action === "regular") return { label: "Review regular costs", href: "/spending/over-time#regular-costs" };
  if (row.action === "runway") return { label: "Review safe to spend", href: "/#next-30-days" };
  if (!row.refId) throw new Error("Suggestion action needs a reference");
  switch (row.action) {
    case "remind": return { label: "Copy link again", href: hrefFor({ type: "invoice", id: row.refId }) };
    case "statement": return { label: "Review statement", href: hrefFor({ type: "statement", id: row.refId }) };
    case "check_bill": return { label: "Review in To check", href: "/to-check#check-" + row.refId };
    case "bill": return { label: "Review bill", href: hrefFor({ type: "bill", id: row.refId }) };
    case "pot": return { label: "Review pot", href: hrefFor({ type: "pot", id: row.refId }) };
  }
}
