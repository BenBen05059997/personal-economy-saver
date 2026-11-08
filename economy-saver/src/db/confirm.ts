import { closeByRef, refreshSuggestions } from "./suggestions";
import { observeRunway } from "./runway-events";
import { and, eq } from "drizzle-orm";
import { type Db, recordEvent, requireHousehold, withHousehold } from "./household";
import { bills, charges, households } from "./schema";
import { fromMinor } from "./money";
import { confirmBalanceUpdate } from "./bank-balance";
import { confirmPot } from "./pots";
import { syncClosedStatementCharge } from "./statement-charge";
import { linkToSeries } from "./bills";

export async function confirmPending(db: Db, householdId: string, kind: "bill" | "charge" | "balance" | "pot", id: string) {
  const hid = requireHousehold(householdId);
  const saved = await withHousehold(db, hid, async tx => {
    const [household] = await tx.select({ id: households.id, previous: households.runwayShort }).from(households).where(eq(households.id, hid)).for("update");
    if (!household) return false;
    if (kind === "balance") return confirmBalanceUpdate(tx, hid, id);
    if (kind === "pot") return confirmPot(tx, hid, id);
    const table = kind === "bill" ? bills : charges;
    const pending = and(eq(table.householdId, hid), eq(table.id, id), eq(table.status, "pending"));
    if (household.previous === null) {
      const [match] = await tx.select({ id: table.id }).from(table).where(pending);
      if (!match) return false;
      await observeRunway(tx, hid);
    }
    const [row] = await tx.update(table).set({ status: "confirmed" })
      .where(pending)
      .returning({ name: kind === "bill" ? bills.biller : charges.merchant, amount: table.amountMinor, currency: table.currency });
    if (!row) return false;
    if (kind === "charge") await syncClosedStatementCharge(tx, hid, id);
    const linked = kind === "bill" ? await linkToSeries(tx, hid, id) : null; // D54: a confirmed one-off joins its amount-varies series
    await recordEvent(tx, hid, { madeBy: "form",
      kind: kind + "_confirmed",
      title: row.name + " confirmed",
      ...(linked && { body: linked }),
      ...(row.amount !== null && { amount: { value: fromMinor(row.amount, row.currency), currency: row.currency } }),
      ref: { type: kind, id },
    });
    if (kind === "bill") await closeByRef(tx, hid, id, ["check_bill"]);
    await observeRunway(tx, hid);
    return true;
  });
  if (saved) await refreshSuggestions(db, hid, "confirmPending");
  return saved;
}
