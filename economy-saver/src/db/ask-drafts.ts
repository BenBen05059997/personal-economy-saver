import { and, asc, eq, inArray } from "drizzle-orm";
import { balanceUpdates, charges, events } from "@/db/schema";
import { requireHousehold, type Db } from "@/db/household";
import { draftViews, type BalanceRow, type DraftRow } from "@/lib/agent/draft-card";
import type { DraftKind, DraftView } from "@/lib/agent/view";
import type { SpendingInput } from "@/lib/money/spending";
import type { MoneyState } from "@/lib/money/types";

const KIND_OF_REF: Record<string, DraftKind> = { bill: "bill", charge: "charge", pot: "pot", balance_update: "balance" };

/**
 * What each turn drafted, read from the rows now (D60). A draft is the `to_check` event its tool wrote under the turn's ask id; the item it names is
 * waiting while its row is pending, confirmed once confirmed, and not added when the row is gone. Call inside the household's own transaction.
 */
export async function draftsOfTurns(tx: Db, householdId: string, turnIds: readonly string[], ctx: { state: MoneyState; spending: SpendingInput }): Promise<Record<string, DraftView[]>> {
  const hid = requireHousehold(householdId);
  if (turnIds.length === 0) return {};
  const made = await tx.select({ askId: events.askId, refType: events.refType, refId: events.refId, title: events.title }).from(events)
    .where(and(eq(events.householdId, hid), eq(events.kind, "to_check"), inArray(events.askId, [...turnIds]))).orderBy(asc(events.createdAt), asc(events.id));
  const byTurn = new Map<string, DraftRow[]>();
  for (const event of made) {
    const kind = event.refType ? KIND_OF_REF[event.refType] : undefined;
    if (!event.askId || !event.refId || !kind) continue;
    const list = byTurn.get(event.askId) ?? [];
    if (!list.some(item => item.id === event.refId)) list.push({ kind, id: event.refId, eventTitle: event.title });
    byTurn.set(event.askId, list);
  }
  const balanceIds = [...byTurn.values()].flat().filter(row => row.kind === "balance").map(row => row.id);
  const balances = new Map<string, BalanceRow>();
  if (balanceIds.length > 0) {
    const rows = await tx.select({ id: balanceUpdates.id, amountMinor: balanceUpdates.amountMinor, status: balanceUpdates.status }).from(balanceUpdates)
      .where(and(eq(balanceUpdates.householdId, hid), inArray(balanceUpdates.id, balanceIds)));
    for (const row of rows) balances.set(row.id, { amountMinor: row.amountMinor, status: row.status });
  }
  const chargeIds = [...byTurn.values()].flat().filter(row => row.kind === "charge").map(row => row.id);
  const older = new Map<string, "pending" | "confirmed">();
  if (chargeIds.length > 0) for (const row of await tx.select({ id: charges.id, status: charges.status }).from(charges).where(and(eq(charges.householdId, hid), inArray(charges.id, chargeIds)))) older.set(row.id, row.status);
  const out: Record<string, DraftView[]> = {};
  for (const [turn, rows] of byTurn) out[turn] = draftViews(rows, ctx, balances, older);
  return out;
}
