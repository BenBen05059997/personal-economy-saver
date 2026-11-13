// What was set aside (D77): the fills of a household's pots, from their `pot_filled` events, as integer minor units. Read only.
import { and, asc, eq, gte, isNotNull, lt, sql } from "drizzle-orm";
import { addDays } from "@/lib/money/runway";
import type { PotFill } from "@/lib/money/types";
import { requireHousehold, withHousehold, type Db } from "./household";
import * as s from "./schema";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The fills on the household's days from `from` to `to` (both included), oldest first; each with the pot, the household day and the amount set aside. */
export async function loadPotFills(db: Db, householdId: string, range: { from: string; to: string }): Promise<PotFill[]> {
  const hid = requireHousehold(householdId);
  const { from, to } = range;
  if (!DATE.test(from) || !DATE.test(to) || from > to) throw new Error("A fills range is two YYYY-MM-DD dates, from on or before to");
  return withHousehold(db, hid, async tx => {
    const [household] = await tx.select({ timeZone: s.households.timeZone }).from(s.households).where(eq(s.households.id, hid));
    if (!household) throw new Error("Household not found");
    const day = sql<string>`to_char(timezone(${household.timeZone}, ${s.events.occurredAt}), 'YYYY-MM-DD')`;
    const rows = await tx.select({ potId: s.events.refId, potName: s.pots.name, date: day, minor: s.events.amountMinor, id: s.events.id })
      .from(s.events).leftJoin(s.pots, and(eq(s.pots.householdId, s.events.householdId), eq(s.pots.id, s.events.refId)))
      .where(and(eq(s.events.householdId, hid), eq(s.events.kind, "pot_filled"), eq(s.events.refType, "pot"), isNotNull(s.events.refId), isNotNull(s.events.amountMinor),
        gte(day, from), lt(day, addDays(to, 1))))
      .orderBy(asc(s.events.occurredAt), asc(s.events.id));
    return rows.map((row): PotFill => ({ potId: row.potId!, potName: row.potName ?? "A pot", date: row.date, minor: row.minor! }));
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}
