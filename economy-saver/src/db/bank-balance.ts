import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { InputError } from "./input-error";
import { recordEvent, requireHousehold, type Db, type Maker } from "./household";
import { fromMinor, parseMinor } from "./money";
import { observeRunway } from "./runway-events";
import { balanceUpdates, households } from "./schema";
import { minorMoney } from "@/lib/money/format";
import { Currency } from "@/lib/catalogue/types";

export const bankBalanceInput = z.object({
  id: z.string().uuid(),
  amount: z.string().trim(), // the new balance in the household's home currency; zero and negative are allowed, as in Settings
});

type Locked = { id: string; currency: string; bank: number; previous: boolean | null };

/** Writes the balance and its event inside a transaction that holds the household lock. No event when the value is unchanged. */
async function applyBalance(tx: Db, hid: string, household: Locked, amountMinor: number, id: string, by: Maker) {
  if (household.previous === null) await observeRunway(tx, hid);
  if (amountMinor === household.bank) return;
  await tx.update(households).set({ bankBalanceMinor: amountMinor }).where(eq(households.id, hid));
  const currency = Currency.parse(household.currency);
  const major = (minor: number) => fromMinor(minor, household.currency);
  await recordEvent(tx, hid, {
    ...by, kind: "bank_balance", title: `Bank balance set to ${minorMoney(amountMinor, currency)} (was ${minorMoney(household.bank, currency)})`,
    amount: { value: major(amountMinor), currency: household.currency }, ref: { type: "balance_update", id },
  });
  await observeRunway(tx, hid);
}

async function lockHousehold(tx: Db, hid: string): Promise<Locked> {
  const [household] = await tx.select({ id: households.id, currency: households.homeCurrency, bank: households.bankBalanceMinor, previous: households.runwayShort })
    .from(households).where(eq(households.id, hid)).for("update");
  if (!household) throw new InputError("Household not found");
  return household;
}

/**
 * Sets the bank balance, in the household's home currency (D42). "confirmed" writes `households.bank_balance_minor` at
 * once and records a `bank_balance` event with the old and new values (the form and Settings); "pending" stores an update
 * that waits in To check until `confirmPending` applies it (the agent and MCP). Idempotent on `id`: the same id with the
 * same amount returns it again and never applies twice; a different amount throws.
 */
export async function setBankBalance(db: Db, householdId: string, input: z.infer<typeof bankBalanceInput>, status: "confirmed" | "pending", by: Maker): Promise<string> {
  const hid = requireHousehold(householdId);
  const data = bankBalanceInput.parse(input);
  return db.transaction(async tx => {
    const household = await lockHousehold(tx, hid);
    const amountMinor = parseMinor(data.amount, household.currency);
    const [existing] = await tx.select().from(balanceUpdates).where(and(eq(balanceUpdates.householdId, hid), eq(balanceUpdates.id, data.id)));
    if (existing) {
      if (existing.amountMinor !== amountMinor) throw new InputError("This balance update identifier is already in use");
      return data.id;
    }
    await tx.insert(balanceUpdates).values({ id: data.id, householdId: hid, amountMinor, currency: household.currency, status, madeBy: by.madeBy, askId: by.askId ?? null });
    if (status === "pending") {
      await recordEvent(tx, hid, { ...by, kind: "to_check", title: "Bank balance update to check", ref: { type: "balance_update", id: data.id }, notify: true });
    } else await applyBalance(tx, hid, household, amountMinor, data.id, by);
    return data.id;
  });
}

/** `confirmPending` for a pending update: applies it through the same path as a confirmed write. False when nothing pending matches. */
export async function confirmBalanceUpdate(tx: Db, householdId: string, id: string): Promise<boolean> {
  const hid = requireHousehold(householdId);
  const household = await lockHousehold(tx, hid);
  const pending = and(eq(balanceUpdates.householdId, hid), eq(balanceUpdates.id, id), eq(balanceUpdates.status, "pending"));
  const [row] = await tx.select({ amountMinor: balanceUpdates.amountMinor }).from(balanceUpdates).where(pending);
  if (!row) return false;
  await tx.update(balanceUpdates).set({ status: "confirmed" }).where(pending);
  await applyBalance(tx, hid, household, row.amountMinor, id, { madeBy: "form" });
  return true;
}
