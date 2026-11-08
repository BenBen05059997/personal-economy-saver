import { and, eq, isNotNull } from "drizzle-orm";
import { Currency } from "@/lib/catalogue/types";
import { RULE_KINDS, type RuleKind, type StandingRule, type StandingRules } from "@/lib/money/suggestion-types";
import { requireHousehold, type Db } from "./household";
import { rules } from "./schema";

export function defaultRules(): StandingRules {
  return {
    nudge_after: { enabled: true, threshold: 3, currency: null },
    statement_ahead: { enabled: true, threshold: 3, currency: null },
    bill_ahead: { enabled: true, threshold: 3, currency: null },
    cost_up: { enabled: false, threshold: null, currency: null },
    safe_below: { enabled: false, threshold: null, currency: null },
    goal_behind: { enabled: true, threshold: null, currency: null },
  };
}

function ruleRow(householdId: string, kind: RuleKind, rule: StandingRule) {
  return { householdId, kind, matchBiller: "standing:" + kind, patch: {}, ...rule };
}

export async function seedRules(db: Db, id: string) {
  const hid = requireHousehold(id);
  const defaults = defaultRules();
  await db.insert(rules).values(RULE_KINDS.map(kind => ruleRow(hid, kind, defaults[kind])));
}

export async function rulesFor(db: Db, id: string): Promise<StandingRules> {
  const hid = requireHousehold(id);
  const rows = await db.select({ kind: rules.kind, enabled: rules.enabled, threshold: rules.threshold, currency: rules.currency })
    .from(rules).where(and(eq(rules.householdId, hid), isNotNull(rules.kind)));
  const result = defaultRules();
  for (const row of rows) {
    if (row.kind === null || row.enabled === null) continue;
    result[row.kind] = { enabled: row.enabled, threshold: row.threshold, currency: row.currency === null ? null : Currency.parse(row.currency) };
  }
  return result;
}

export async function setStandingRule(db: Db, id: string, kind: RuleKind, rule: StandingRule) {
  const hid = requireHousehold(id);
  await db.insert(rules).values(ruleRow(hid, kind, rule))
    .onConflictDoUpdate({ target: [rules.householdId, rules.kind], set: rule });
}
