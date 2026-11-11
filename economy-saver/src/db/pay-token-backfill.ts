// A sent invoice has one permanent payment link (D12). This gives the sent invoices made before links existed their token.
import { and, eq, isNull } from "drizzle-orm";
import { newPayToken, payLinkRefusal } from "@/lib/paypal/pay-link";
import { requireHousehold, withHousehold, type Db } from "./household";
import { households, invoices } from "./schema";

export type BackfillCounts = { households: number; given: number; skipped: Record<"not USD" | "no positive amount", number> };

/** One household, one transaction. With `apply` false it only counts. Never returns a token. */
export async function backfillHouseholdPayTokens(db: Db, id: string, apply: boolean): Promise<Omit<BackfillCounts, "households">> {
  const hid = requireHousehold(id);
  return withHousehold(db, hid, async tx => {
    const rows = await tx.select({ id: invoices.id, currency: invoices.currency, amountMinor: invoices.amountMinor }).from(invoices)
      .where(and(eq(invoices.householdId, hid), eq(invoices.status, "sent"), isNull(invoices.payToken)));
    const out = { given: 0, skipped: { "not USD": 0, "no positive amount": 0 } };
    for (const row of rows) {
      const refusal = payLinkRefusal(row);
      if (refusal) { out.skipped[refusal]++; continue; }
      if (apply) {
        const done = await tx.update(invoices).set({ payToken: newPayToken() })
          .where(and(eq(invoices.householdId, hid), eq(invoices.id, row.id), eq(invoices.status, "sent"), isNull(invoices.payToken)))
          .returning({ id: invoices.id });
        if (done.length === 0) continue;
      }
      out.given++;
    }
    return out;
  });
}

/** Every household, one at a time. Run by `scripts/backfill-pay-tokens.ts`; a second run gives nothing. */
export async function backfillPayTokens(db: Db, apply: boolean): Promise<BackfillCounts> {
  const ids = await db.select({ id: households.id }).from(households).orderBy(households.id);
  const total: BackfillCounts = { households: 0, given: 0, skipped: { "not USD": 0, "no positive amount": 0 } };
  for (const { id } of ids) {
    const part = await backfillHouseholdPayTokens(db, id, apply);
    if (part.given > 0) total.households++;
    total.given += part.given;
    total.skipped["not USD"] += part.skipped["not USD"];
    total.skipped["no positive amount"] += part.skipped["no positive amount"];
  }
  return total;
}
