import { eq } from "drizzle-orm";
import { Currency } from "@/lib/catalogue/types";
import { RULE_KINDS, type RuleKind, type StandingRule, type StandingRules } from "@/lib/money/suggestion-types";
import { readRule, ruleWords } from "@/lib/money/rules";
import { recordEvent, requireHousehold, withHousehold, type Db } from "./household";
import { households, standingRules } from "./schema";
import { InputError } from "./input-error";
import { requireSpace } from "./spaces";

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
  return { householdId, kind, ...rule };
}

export async function seedRules(db: Db, id: string) {
  const hid = requireHousehold(id);
  const defaults = defaultRules();
  await db.insert(standingRules).values(RULE_KINDS.map(kind => ruleRow(hid, kind, defaults[kind])));
}

function readRules(db: Db, hid: string) {
  return db.select({ kind: standingRules.kind, enabled: standingRules.enabled, threshold: standingRules.threshold, currency: standingRules.currency, spaceId: standingRules.spaceId })
    .from(standingRules).where(eq(standingRules.householdId, hid));
}

async function initializeRules(db: Db, hid: string) {
  return db.transaction(async tx => {
    const [household] = await tx.select({ id: households.id }).from(households).where(eq(households.id, hid)).for("update");
    if (!household) throw new InputError("Household not found");
    const rows = await readRules(tx, hid);
    if (rows.length) return rows;
    await seedRules(tx, hid);
    await recordEvent(tx, hid, { madeBy: "cron", kind: "rules_initialized", title: "Default standing rules added" });
    return readRules(tx, hid);
  });
}

export async function rulesFor(db: Db, id: string): Promise<StandingRules> {
  const hid = requireHousehold(id);
  return withHousehold(db, hid, async tx => {
    let rows = await readRules(tx, hid);
    if (!rows.length) rows = await initializeRules(tx, hid);
    const byKind = new Map(rows.map(row => [row.kind, row]));
    const entries = RULE_KINDS.map(kind => {
      const row = byKind.get(kind);
      if (!row) throw new Error(`Missing standing rule: ${kind}`);
      return [kind, { enabled: row.enabled, threshold: row.threshold, currency: row.currency === null ? null : Currency.parse(row.currency),
        ...(row.spaceId && { spaceId: row.spaceId }) }] as const;
    });
    return Object.fromEntries(entries) as StandingRules;
  });
}

export async function setStandingRule(db: Db, id: string, kind: RuleKind, rule: StandingRule) {
  const hid = requireHousehold(id);
  await withHousehold(db, hid, async tx => {
    await tx.insert(standingRules).values(ruleRow(hid, kind, rule))
      .onConflictDoUpdate({ target: [standingRules.householdId, standingRules.kind], set: { ...rule, updatedAt: new Date() } });
  });
}

export async function changeStandingRule(db: Db, id: string, input: { ruleKind: RuleKind; enabled: boolean; value: string | null; spaceId?: string }) {
  const hid = requireHousehold(id);
  return withHousehold(db, hid, async tx => {
    const [household] = await tx.select({ currency: households.homeCurrency }).from(households).where(eq(households.id, hid)).for("update");
    if (!household) throw new InputError("Household not found");
    const current = (await rulesFor(tx, hid))[input.ruleKind];
    const spaceId = input.spaceId ? (await requireSpace(tx, hid, input.spaceId, true)).id : current.spaceId;
    const value = input.value?.trim() || null;
    const keepValue = !input.enabled && (value === null || (input.ruleKind === "nudge_after" && value === String(current.threshold)));
    const next = keepValue ? { ...current, enabled: false } : readRule(input.ruleKind, input.enabled, value, Currency.parse(household.currency));
    if ("problem" in next) throw new InputError(next.problem);
    if (next.enabled === current.enabled && next.threshold === current.threshold && next.currency === current.currency && spaceId === current.spaceId) return false;
    await setStandingRule(tx, hid, input.ruleKind, { ...next, spaceId });
    await recordEvent(tx, hid, { madeBy: "form", kind: "rule_changed", title: "Rule changed: " + ruleWords(input.ruleKind, next) });
    return true;
  });
}
