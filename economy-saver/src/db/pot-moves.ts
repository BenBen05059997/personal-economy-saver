// What happened to each pot's money (D81): its moves, read only. A confirmed move is signed minor units on a day; a pending one
// waits in To check and counts for nothing. The writers are in pots.ts.
import { and, asc, eq, sql, type SQL } from "drizzle-orm";
import { CategoryKeySchema } from "@/lib/money/categories";
import type { PendingMove, PotMove, Purchase } from "@/lib/money/types";
import { requireHousehold, withHousehold, type Db } from "./household";
import * as s from "./schema";

export const REMOVED_PURCHASE = "A removed purchase";

const columns = {
  id: s.potMoves.id, potId: s.potMoves.potId, potName: s.pots.name, potCategory: s.pots.category, kind: s.potMoves.kind, minor: s.potMoves.amountMinor,
  on: s.potMoves.movedOn, memberId: s.potMoves.memberId, reason: s.potMoves.reason, invoiceId: s.potMoves.invoiceId, choiceId: s.potMoves.choiceId,
  pairId: s.potMoves.pairId, chargeId: s.potMoves.chargeId, billId: s.potMoves.billId, billOn: s.potMoves.billOn,
  merchant: s.charges.merchant, biller: s.bills.biller, madeBy: s.potMoves.madeBy,
};

/** The purchase a spend was for: the charge's merchant or the bill's biller; a bill that was removed since keeps its day and is named "A removed purchase". */
function purchaseOf(row: Row): Purchase | null {
  if (row.chargeId !== null) return { kind: "charge", id: row.chargeId, on: null, label: row.merchant ?? REMOVED_PURCHASE };
  if (row.billId !== null) return { kind: "bill", id: row.billId, on: row.billOn, label: row.biller ?? REMOVED_PURCHASE };
  if (row.billOn !== null) return { kind: "bill", id: "", on: row.billOn, label: REMOVED_PURCHASE };
  return null;
}

function moveOf(row: Row) {
  return {
    id: row.id, potId: row.potId, potName: row.potName, potCategory: row.potCategory === null ? null : CategoryKeySchema.parse(row.potCategory), kind: row.kind, minor: row.minor,
    memberId: row.memberId, reason: row.reason, invoiceId: row.invoiceId, purchase: purchaseOf(row), choiceId: row.choiceId, pairId: row.pairId,
  };
}

const rowsOf = (db: Db, where: SQL | undefined) => db.select(columns).from(s.potMoves)
  .innerJoin(s.pots, and(eq(s.pots.householdId, s.potMoves.householdId), eq(s.pots.id, s.potMoves.potId)))
  .leftJoin(s.charges, and(eq(s.charges.householdId, s.potMoves.householdId), eq(s.charges.id, s.potMoves.chargeId)))
  .leftJoin(s.bills, and(eq(s.bills.householdId, s.potMoves.householdId), eq(s.bills.id, s.potMoves.billId)))
  .where(where);
type Row = Awaited<ReturnType<typeof rowsOf>>[number];

/** Every confirmed move of the household's pots, all time, oldest first. */
export async function loadPotMoves(db: Db, householdId: string): Promise<PotMove[]> {
  const hid = requireHousehold(householdId);
  return withHousehold(db, hid, async tx => {
    const rows = await rowsOf(tx, and(eq(s.potMoves.householdId, hid), eq(s.potMoves.status, "confirmed")))
      .orderBy(asc(s.potMoves.movedOn), asc(s.potMoves.createdAt), asc(s.potMoves.id));
    return rows.map((row): PotMove => ({ ...moveOf(row), on: row.on! }));
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}

/** The moves waiting in To check, oldest first (a carry waits as its two rows). The caller is already inside the household's scope: `loadMoneyState` reads it. */
export async function loadPendingMoves(db: Db, householdId: string): Promise<PendingMove[]> {
  const hid = requireHousehold(householdId);
  const rows = await rowsOf(db, and(eq(s.potMoves.householdId, hid), eq(s.potMoves.status, "pending")))
    .orderBy(asc(s.potMoves.createdAt), asc(s.potMoves.id));
  return rows.map((row): PendingMove => ({ ...moveOf(row), ...(row.madeBy !== "form" && { madeBy: row.madeBy }) }));
}

/** Per pot: what it became (the spends, made positive, in minor units) and the latest day of a move other than an adjust. Confirmed moves only. */
export async function loadPotMoveTotals(db: Db, householdId: string): Promise<Map<string, { became: number; lastMovedOn: string | null }>> {
  const hid = requireHousehold(householdId);
  const rows = await db.select({
    potId: s.potMoves.potId,
    became: sql<string>`coalesce(sum(case when ${s.potMoves.kind} = 'spend' then -${s.potMoves.amountMinor} else 0 end), 0)::text`,
    lastMovedOn: sql<string | null>`max(${s.potMoves.movedOn}) filter (where ${s.potMoves.kind} <> 'adjust')`,
  }).from(s.potMoves).where(and(eq(s.potMoves.householdId, hid), eq(s.potMoves.status, "confirmed"))).groupBy(s.potMoves.potId);
  return new Map(rows.map(row => [row.potId, { became: Number(row.became), lastMovedOn: row.lastMovedOn }]));
}
