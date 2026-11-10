import { and, asc, eq, inArray, isNotNull, isNull, lt, notInArray, sql } from "drizzle-orm";
import { jobError } from "@/lib/job-error";
import { addDays } from "@/lib/money/runway";
import { findSuggestions } from "@/lib/money/suggest";
import { FINDING_RULE, type Finding } from "@/lib/money/suggestion-types";
import { monthsBack } from "@/lib/money/spending";
import { REGULAR_MONTHS } from "@/lib/money/regular";
import { clockForHousehold } from "./clock";
import { CHARGE_LOOKBACK_DAYS, householdClockRow, loadMoneyState, recordEvent, requireHousehold, withHousehold, type Db } from "./household";
import { rulesFor } from "./rules";
import { events, households, invoices, spaces, standingRules, suggestions } from "./schema";

const active = () => inArray(suggestions.status, ["open", "not_now"]);
const RETENTION_MS = 90 * 86_400_000;

// The Activity entry remembers this finding after its closed row is pruned.
async function findingId(hid: string, key: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(hid + "/" + key))).slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x80;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join("-");
}

export async function runPass(db: Db, id: string, now = new Date()) {
  const hid = requireHousehold(id);
  return withHousehold(db, hid, async tx => {
    const [household] = await tx.select().from(households).where(eq(households.id, hid)).for("update");
    if (!household) throw new Error("Household not found");
    const { today } = clockForHousehold(household, now);
    const rules = await rulesFor(tx, hid);
    const lookback = addDays(today, -CHARGE_LOOKBACK_DAYS);
    const regularFrom = monthsBack(today.slice(0, 7), REGULAR_MONTHS) + "-01";
    const chargesFrom = rules.cost_up.enabled && regularFrom < lookback ? regularFrom : lookback;
    const [state, remindable] = await Promise.all([
      loadMoneyState(tx, hid, today, household, chargesFrom),
      rules.nudge_after.enabled ? tx.select({ id: invoices.id }).from(invoices).where(and(
        eq(invoices.householdId, hid), eq(invoices.status, "sent"), isNotNull(invoices.paypalInvoiceId),
        isNotNull(invoices.dueOn), isNull(invoices.remindedAt), isNull(invoices.reminderAttemptedAt),
      )) : [],
    ]);
    const findings = findSuggestions(state, rules, new Set(remindable.map(row => row.id)));
    const current = findings.map(finding => finding.key);
    await tx.update(suggestions).set({ status: "resolved", closedAt: now })
      .where(and(eq(suggestions.householdId, hid), active(), current.length ? notInArray(suggestions.key, current) : undefined));
    await tx.delete(suggestions).where(and(eq(suggestions.householdId, hid), lt(suggestions.closedAt, new Date(now.getTime() - RETENTION_MS))));
    if (current.length === 0) return state;

    await tx.update(suggestions).set({ status: "open", snoozedOn: null }).where(and(eq(suggestions.householdId, hid),
      eq(suggestions.status, "not_now"), lt(suggestions.snoozedOn, today), inArray(suggestions.key, current)));
    const rows = await Promise.all(findings.map(async finding => ({ ...finding, id: await findingId(hid, finding.key) })));
    const seen = await tx.select({ id: events.refId }).from(events).where(and(eq(events.householdId, hid),
      eq(events.kind, "suggestion_made"), eq(events.refType, "suggestion"), inArray(events.refId, rows.map(row => row.id))));
    const done = new Set(seen.map(row => row.id));
    const fresh = rows.filter(row => !done.has(row.id));
    if (fresh.length) {
      const inserted = await tx.insert(suggestions).values(fresh.map(row => ({ ...row, householdId: hid, createdOn: today, createdAt: now })))
        .onConflictDoNothing({ target: [suggestions.householdId, suggestions.key] }).returning({ id: suggestions.id, title: suggestions.title });
      for (const row of inserted) {
        await recordEvent(tx, hid, { madeBy: "cron", kind: "suggestion_made", title: row.title, ref: { type: "suggestion", id: row.id }, notify: true });
      }
    }
    // Current amounts and coverage can change while a finding is still open.
    for (const finding of findings) {
      const { key, ...values } = finding;
      await tx.update(suggestions).set(values).where(and(eq(suggestions.householdId, hid), eq(suggestions.key, key), active()));
    }
    return state;
  });
}

/** Run after the triggering write commits. A later pass can catch up on failure. */
export async function refreshSuggestions(db: Db, householdId: string, callSite: string) {
  try {
    await runPass(db, householdId);
  } catch (error) {
    console.error(JSON.stringify({ at: "suggestion_pass", householdId, callSite, ...jobError(error) }));
  }
}

const ruleKindFor = sql`case ${suggestions.kind} ${sql.join(
  Object.entries(FINDING_RULE).map(([finding, rule]) => sql`when ${finding} then ${rule}`), sql` `,
)} end`;

export async function openSuggestions(db: Db, id: string, digest?: { day: string; kinds: readonly Finding["kind"][] }) {
  const hid = requireHousehold(id);
  return withHousehold(db, hid, tx => tx.select({ id: suggestions.id, kind: suggestions.kind, title: suggestions.title,
    reason: suggestions.reason, action: suggestions.action, refId: suggestions.refId, spaceId: spaces.id, spaceName: spaces.name })
    .from(suggestions)
    .leftJoin(standingRules, and(eq(standingRules.householdId, suggestions.householdId), eq(standingRules.kind, ruleKindFor)))
    .leftJoin(spaces, and(eq(spaces.householdId, suggestions.householdId), eq(spaces.id, standingRules.spaceId)))
    .where(and(eq(suggestions.householdId, hid), eq(suggestions.status, "open"),
      digest ? and(eq(suggestions.createdOn, digest.day), inArray(suggestions.kind, digest.kinds)) : undefined))
    .orderBy(asc(suggestions.urgency), ...(digest ? [asc(suggestions.id)] : [asc(suggestions.createdOn), asc(suggestions.title), asc(suggestions.id)])));
}

export async function dismiss(db: Db, id: string, suggestionId: string, now = new Date()) {
  const hid = requireHousehold(id);
  return withHousehold(db, hid, async tx => {
    const [row] = await tx.update(suggestions).set({ status: "dismissed", closedAt: now })
      .where(and(eq(suggestions.householdId, hid), eq(suggestions.id, suggestionId), active()))
      .returning({ title: suggestions.title });
    if (!row) return false;
    await recordEvent(tx, hid, { madeBy: "form", kind: "suggestion_dismissed", title: row.title });
    return true;
  });
}

export async function notNow(db: Db, id: string, suggestionId: string, now = new Date()) {
  const hid = requireHousehold(id);
  const household = await householdClockRow(db, hid);
  if (!household) return false;
  const [row] = await db.update(suggestions).set({ status: "not_now", snoozedOn: clockForHousehold(household, now).today })
    .where(and(eq(suggestions.householdId, hid), eq(suggestions.id, suggestionId), eq(suggestions.status, "open")))
    .returning({ id: suggestions.id });
  return Boolean(row);
}

/** Call in the transaction that finishes the associated action. */
export async function closeByRef(tx: Db, id: string, refId: string, actions: Finding["action"][], now = new Date()) {
  const hid = requireHousehold(id);
  const closed = await tx.update(suggestions).set({ status: "approved", closedAt: now }).where(and(
    eq(suggestions.householdId, hid), eq(suggestions.refId, refId), inArray(suggestions.action, actions), active(),
  )).returning({ title: suggestions.title });
  for (const row of closed) await recordEvent(tx, hid, { madeBy: "form", kind: "suggestion_approved", title: row.title });
}
