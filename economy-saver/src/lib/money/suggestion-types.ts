import type { Currency } from "@/lib/catalogue/types";

export const RULE_KINDS = ["nudge_after", "statement_ahead", "bill_ahead", "cost_up", "safe_below", "goal_behind"] as const;
export type RuleKind = typeof RULE_KINDS[number];
export type StandingRule = { enabled: boolean; threshold: number | null; currency: Currency | null; spaceId?: string };
export type StandingRules = Record<RuleKind, StandingRule>;

export const SUGGESTION_KINDS = ["invoice_nudge", "late_client", "statement_due", "bill_due", "cost_up", "cancel_by", "goal_behind", "safe_below"] as const;
export const SUGGESTION_ACTIONS = ["remind", "invoice", "statement", "bill", "regular", "pot", "runway", "check_bill"] as const;
export type Finding = {
  kind: typeof SUGGESTION_KINDS[number];
  key: string;
  title: string;
  reason: string;
  action: typeof SUGGESTION_ACTIONS[number];
  refId: string | null;
  urgency: number;
};

/** Findings without a standing rule (usual payment day and cancellation deadlines) stay in General. */
export const FINDING_RULE: Partial<Record<Finding["kind"], RuleKind>> = {
  invoice_nudge: "nudge_after", statement_due: "statement_ahead", bill_due: "bill_ahead",
  cost_up: "cost_up", safe_below: "safe_below", goal_behind: "goal_behind",
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
