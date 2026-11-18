import { closeByRef, refreshSuggestions } from "./suggestions";
// Pots (D43): money set aside with a reason. One function per job, called by the Saving forms (confirmed rows) and by the
// agent's add_pot tool (pending rows, confirmed in To check). Money in a confirmed pot is not spendable: the engine
// starts the runway from cash less the pots (availableCash), so every write here ends with the runway observed.
import { and, eq, inArray, isNotNull, isNull, notInArray, sql } from "drizzle-orm";
import { z } from "zod";
import { InputError } from "./input-error";
import { lockHousehold, recordEvent, requireHousehold, usdRateMicro, withHousehold, type Db, type Maker } from "./household";
import { convertMinor, fromMinor, fromRateMicro, parseAmountMinor, parseMinor } from "./money";
import { clockForHousehold, householdMoment, type ClockHousehold } from "./clock";
import { observeRunway } from "./runway-events";
import { bills, charges, choices, households, members, potMoves, pots } from "./schema";
import { Currency } from "@/lib/catalogue/types";
import { CategoryKeySchema, type CategoryKey } from "@/lib/money/categories";
import { minorMoney, percentText, percentToBp } from "@/lib/money/format";
import { fillShare } from "@/lib/money/pots";
import type { MoveKind } from "@/lib/money/types";
import { stableId } from "@/lib/stable-id";

export const potInput = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1).max(60),
  target: z.string().trim().nullable().default(null), // plain number in the home currency
  targetDate: z.string().date().nullable().default(null),
  saved: z.string().trim().default("0"), // saved so far; zero is fine
  fillPct: z.string().trim().nullable().default(null), // share of each client payment, "25" or "12.5"
  memberId: z.uuid().nullable().default(null),
  category: CategoryKeySchema.nullable().default(null), // what the pot is for (D81); government_tax makes it the tax pot
});

type PotInput = z.infer<typeof potInput>;
type PotFields = z.input<typeof potInput>;
type Fields = { name: string; targetMinor: number | null; targetDate: string | null; savedMinor: number; fillBp: number | null; memberId: string | null; category: CategoryKey | null };

/** "25" or "12.5" as basis points (2500, 1250); 0.01 to 100 percent. */
export function parseFillBp(text: string): number {
  const bp = percentToBp(text) ?? 0;
  if (bp < 1 || bp > 10_000) throw new InputError("Enter a share between 0.01 and 100 percent, such as 25");
  return bp;
}

const blank = (value: string | null) => value === null || value === "" ? null : value;

function fieldsOf(data: PotInput, currency: string): Fields {
  const target = blank(data.target);
  const savedMinor = parseMinor(data.saved === "" ? "0" : data.saved, currency);
  if (savedMinor < 0) throw new InputError("The amount saved cannot be negative");
  if (blank(data.targetDate) !== null && target === null) throw new InputError("A target date needs a target amount");
  return {
    name: data.name,
    targetMinor: target === null ? null : parseAmountMinor(target, currency),
    targetDate: blank(data.targetDate),
    savedMinor,
    fillBp: blank(data.fillPct) === null ? null : parseFillBp(data.fillPct!),
    memberId: data.memberId,
    category: data.category,
  };
}

const same = (a: Fields, b: Fields) => a.name === b.name && a.targetMinor === b.targetMinor && a.targetDate === b.targetDate
  && a.savedMinor === b.savedMinor && a.fillBp === b.fillBp && a.memberId === b.memberId && a.category === b.category;

function describe(f: Fields, currency: Currency) {
  const money = (minor: number | null) => minor === null ? "none" : minorMoney(minor, currency);
  return {
    saved: money(f.savedMinor), target: money(f.targetMinor), by: f.targetDate ?? "none",
    fill: f.fillBp === null ? "none" : percentText(f.fillBp) + "%", name: f.name, category: f.category ?? "none",
  };
}

/** The old and new value of every field that changed, for the event body: "Saved ¥10,000 → ¥15,000". */
function changes(before: Fields, after: Fields, currency: Currency): string {
  const [old, now] = [describe(before, currency), describe(after, currency)];
  const label = { name: "Name", saved: "Saved", target: "Target", by: "Target date", fill: "Set aside", category: "Category" } as const;
  return (Object.keys(label) as (keyof typeof label)[]).filter(key => old[key] !== now[key])
    .map(key => `${label[key]} ${old[key]} → ${now[key]}`).join("; ");
}

function addedEvent(tx: Db, hid: string, id: string, f: Fields, currency: string, by: Maker) {
  return recordEvent(tx, hid, {
    ...by,
    kind: "pot_added", title: `${f.name} pot added`,
    ...(f.savedMinor > 0 && { amount: { value: fromMinor(f.savedMinor, currency), currency } }),
    ref: { type: "pot", id },
  });
}

/** One row of `pot_moves` as `writeMove` inserts it. */
type NewMove = {
  id: string; potId: string; kind: MoveKind; amountMinor: number; currency: string; reason: string | null; memberId: string | null;
  invoiceId?: string | null; chargeId?: string | null; billId?: string | null; billOn?: string | null; choiceId?: string | null; pairId?: string | null;
  status: "confirmed" | "pending"; movedOn: string | null; confirmedAt: Date | null; madeBy: Maker["madeBy"]; askId: string | null;
};

/**
 * The one place a pot's `saved_minor` changes (D81): it inserts moves, or confirms pending ones, and in the same transaction sets
 * every pot it touched to the sum of its confirmed moves, so a pot's money is always what its moves add up to. The caller holds the
 * household lock.
 */
async function writeMove(tx: Db, hid: string, change: { insert: NewMove[] } | { confirm: { ids: string[]; movedOn: string; confirmedAt: Date } }): Promise<void> {
  const touched = new Set<string>();
  if ("insert" in change) {
    for (const row of change.insert) {
      await tx.insert(potMoves).values({ ...row, householdId: hid });
      if (row.status === "confirmed") touched.add(row.potId);
    }
  } else {
    const { ids, movedOn, confirmedAt } = change.confirm;
    const rows = await tx.update(potMoves).set({ status: "confirmed", movedOn, confirmedAt })
      .where(and(eq(potMoves.householdId, hid), inArray(potMoves.id, ids), eq(potMoves.status, "pending"))).returning({ potId: potMoves.potId });
    for (const row of rows) touched.add(row.potId);
  }
  for (const potId of touched) {
    await tx.update(pots).set({
      savedMinor: sql`(select coalesce(sum(${potMoves.amountMinor}), 0)::bigint from ${potMoves}
        where ${potMoves.householdId} = ${hid} and ${potMoves.potId} = ${potId} and ${potMoves.status} = 'confirmed')`,
    }).where(and(eq(pots.householdId, hid), eq(pots.id, potId)));
  }
}

/** The adjust that starts a pot or corrects it: signed, confirmed now. */
const adjustMove = (potId: string, amountMinor: number, currency: string, household: ClockHousehold, by: Maker): NewMove => ({
  id: crypto.randomUUID(), potId, kind: "adjust", amountMinor, currency, reason: null, memberId: by.memberId ?? null,
  status: "confirmed", movedOn: clockForHousehold(household).today, confirmedAt: householdMoment(household), madeBy: by.madeBy, askId: by.askId ?? null,
});

/**
 * Creates or edits a pot in the household's home currency. "confirmed" (the Saving forms) counts at once and records a
 * `pot_added` event, or a `pot_updated` event with the old and new values when the id already names a confirmed pot;
 * "pending" (the agent and MCP) waits in To check until `confirmPending` and counts for nothing. A starting amount, or an edited
 * one, is an `adjust` move. Idempotent on `id`: the same id with the same fields returns it again with no second event; a pending
 * call with an id already in use by different fields throws.
 */
export async function savePot(db: Db, householdId: string, input: PotFields, status: "confirmed" | "pending", by: Maker): Promise<string> {
  const hid = requireHousehold(householdId);
  const data = potInput.parse(input);
  const refresh = await withHousehold(db, hid, async tx => {
    const household = await lockHousehold(tx, hid);
    const currency = Currency.parse(household.currency);
    const fields = fieldsOf(data, household.currency);
    if (fields.memberId) {
      const [member] = await tx.select({ id: members.id }).from(members).where(and(eq(members.householdId, hid), eq(members.id, fields.memberId)));
      if (!member) throw new InputError("Choose a member of this household");
    }
    const [existing] = await tx.select().from(pots).where(and(eq(pots.householdId, hid), eq(pots.id, data.id)));
    if (existing) {
      const before: Fields = { name: existing.name, targetMinor: existing.targetMinor, targetDate: existing.targetDate, savedMinor: existing.savedMinor, fillBp: existing.fillBp, memberId: existing.memberId, category: existing.category === null ? null : CategoryKeySchema.parse(existing.category) };
      if (same(before, fields)) {
        if (status === "confirmed" && existing.status === "confirmed") await closeByRef(tx, hid, data.id, ["pot"]);
        return false;
      }
      if (status !== "confirmed" || existing.status !== "confirmed") throw new InputError("This pot identifier is already in use");
      if (household.previous === null) await observeRunway(tx, hid);
      const { savedMinor, ...rest } = fields; // the money changes only through a move
      await tx.update(pots).set(rest).where(and(eq(pots.householdId, hid), eq(pots.id, data.id)));
      if (savedMinor !== existing.savedMinor) await writeMove(tx, hid, { insert: [adjustMove(data.id, savedMinor - existing.savedMinor, existing.currency, household, by)] });
      await recordEvent(tx, hid, { ...by, kind: "pot_updated", title: `${fields.name} pot updated`, body: changes(before, fields, currency), ref: { type: "pot", id: data.id } });
      await closeByRef(tx, hid, data.id, ["pot"]);
      await observeRunway(tx, hid);
      return true;
    }
    if (status === "confirmed" && household.previous === null) await observeRunway(tx, hid);
    await tx.insert(pots).values({ id: data.id, householdId: hid, currency: household.currency, status, madeBy: by.madeBy, askId: by.askId ?? null, ...fields,
      // a confirmed pot starts at zero and takes its starting amount as a move; a pending one only states it
      ...(status === "confirmed" && { savedMinor: 0 }),
      ...(household.fixedToday && { createdAt: householdMoment(household) }),
    });
    if (status === "pending") {
      await recordEvent(tx, hid, { ...by, kind: "to_check", title: `${fields.name} pot to check`, ref: { type: "pot", id: data.id }, notify: true });
    } else {
      if (fields.savedMinor > 0) await writeMove(tx, hid, { insert: [adjustMove(data.id, fields.savedMinor, household.currency, household, by)] });
      await addedEvent(tx, hid, data.id, fields, household.currency, by);
      await observeRunway(tx, hid);
    }
    return status === "confirmed";
  });
  if (refresh) await refreshSuggestions(db, hid, "savePot");
  return data.id;
}

/** `confirmPending` for a pending pot: it counts from now on, its stated starting amount as an `adjust` move. False when nothing pending matches. The caller holds the household lock. */
export async function confirmPot(tx: Db, householdId: string, id: string): Promise<boolean> {
  const hid = requireHousehold(householdId);
  const [household] = await tx.select({ previous: households.runwayShort, isDemo: households.isDemo, fixedToday: households.fixedToday, timeZone: households.timeZone }).from(households).where(eq(households.id, hid));
  if (!household) return false;
  const pending = and(eq(pots.householdId, hid), eq(pots.id, id), eq(pots.status, "pending"));
  if (household.previous === null) {
    const [match] = await tx.select({ id: pots.id }).from(pots).where(pending);
    if (!match) return false;
    await observeRunway(tx, hid);
  }
  const [row] = await tx.update(pots).set({ status: "confirmed" }).where(pending).returning();
  if (!row) return false;
  if (row.savedMinor > 0) await writeMove(tx, hid, { insert: [adjustMove(id, row.savedMinor, row.currency, household, { madeBy: "form" })] });
  await addedEvent(tx, hid, id, { ...row, category: null }, row.currency, { madeBy: "form" });
  await observeRunway(tx, hid);
  return true;
}

/** Removes a pot. Its money goes back to cash that can be spent. False when this household has no such pot. */
export async function removePot(db: Db, householdId: string, id: string): Promise<boolean> {
  const hid = requireHousehold(householdId);
  const potId = z.uuid().parse(id);
  return withHousehold(db, hid, async tx => {
    const household = await lockHousehold(tx, hid);
    if (household.previous === null) await observeRunway(tx, hid);
    const [row] = await tx.delete(pots).where(and(eq(pots.householdId, hid), eq(pots.id, potId))).returning();
    if (!row) return false;
    await recordEvent(tx, hid, { madeBy: "form",
      kind: "pot_removed", title: `${row.name} pot removed`,
      ...(row.status === "confirmed" && row.savedMinor > 0 && { body: `${minorMoney(row.savedMinor, Currency.parse(row.currency))} is cash you can spend again`, amount: { value: fromMinor(row.savedMinor, row.currency), currency: row.currency } }),
      ref: { type: "pot", id: potId },
    });
    if (row.status === "confirmed") await observeRunway(tx, hid);
    return true;
  });
}

// ---------------------------------------------------------------- moves (D81)

export type MoveInput = {
  id: string; potId: string; kind: "add" | "take_out" | "spend" | "carry"; amountMinor: number | null; toPotId: string | null;
  purchase: { kind: "charge" | "bill"; id: string; on: string | null } | null; choiceId: string | null; reason: string | null; memberId: string | null; done: boolean;
};

/** What a purchase is, in the pot's currency: its amount (null for a bill whose amount is not known) and what pots have already taken for it. */
type PurchaseInfo = { chargeId: string | null; billId: string | null; billOn: string | null; amountMinor: number | null; label: string };

async function purchaseInfo(tx: Db, hid: string, purchase: NonNullable<MoveInput["purchase"]>, currency: string): Promise<PurchaseInfo> {
  const [amountMinor, rowCurrency, label, date] = await (async () => {
    if (purchase.kind === "charge") {
      const [charge] = await tx.select().from(charges).where(and(eq(charges.householdId, hid), eq(charges.id, z.uuid().parse(purchase.id))));
      if (!charge) throw new InputError("Choose one of your charges");
      if (charge.status !== "confirmed") throw new InputError("That charge is still waiting in To check; confirm it first");
      return [charge.amountMinor, charge.currency, charge.merchant, charge.date] as const;
    }
    const [bill] = await tx.select().from(bills).where(and(eq(bills.householdId, hid), eq(bills.id, z.uuid().parse(purchase.id))));
    if (!bill) throw new InputError("Choose one of your bills");
    if (bill.status !== "confirmed") throw new InputError("That bill is still waiting in To check; confirm it first");
    if (purchase.on === null) throw new InputError("Say which day of the bill this is for");
    return [bill.amountMinor, bill.currency, bill.biller, purchase.on] as const;
  })();
  const converted = amountMinor === null ? null : rowCurrency === currency ? amountMinor
    : convertMinor(amountMinor, rowCurrency, currency, fromRateMicro(await usdRateMicro(tx, hid, currency, date)));
  return purchase.kind === "charge" ? { chargeId: purchase.id, billId: null, billOn: null, amountMinor: converted, label }
    : { chargeId: null, billId: purchase.id, billOn: purchase.on, amountMinor: converted, label };
}

const purchaseMatch = (hid: string, row: { chargeId?: string | null; billId?: string | null; billOn?: string | null }) =>
  row.chargeId ? and(eq(potMoves.householdId, hid), eq(potMoves.chargeId, row.chargeId))
    : and(eq(potMoves.householdId, hid), eq(potMoves.billId, row.billId!), eq(potMoves.billOn, row.billOn!));

/** What the pots have already taken for one purchase, confirmed spends only, apart from the rows with `except` ids; a positive number. */
async function takenFor(tx: Db, hid: string, row: { chargeId?: string | null; billId?: string | null; billOn?: string | null }, except: string[]): Promise<number> {
  const rows = await tx.select({ minor: potMoves.amountMinor }).from(potMoves)
    .where(and(purchaseMatch(hid, row), eq(potMoves.kind, "spend"), eq(potMoves.status, "confirmed"), except.length ? notInArray(potMoves.id, except) : undefined));
  return -rows.reduce((sum, r) => sum + r.minor, 0);
}

/**
 * The refusals every move meets, in words, before it counts: a pot of this household that is confirmed, a done pot takes no more
 * money, the tax pot is never spent, a pot never gives more than it holds, and the pots never take more for a purchase than it cost.
 * `rows` are the signed rows about to be confirmed.
 */
async function requireMovable(tx: Db, hid: string, rows: { id: string; potId: string; kind: MoveKind; amountMinor: number; chargeId?: string | null; billId?: string | null; billOn?: string | null }[]): Promise<void> {
  const potIds = [...new Set(rows.map(r => r.potId))];
  const found = await tx.select().from(pots).where(and(eq(pots.householdId, hid), inArray(pots.id, potIds)));
  const byId = new Map(found.map(p => [p.id, p]));
  const change = new Map<string, number>();
  for (const row of rows) {
    const pot = byId.get(row.potId);
    if (!pot) throw new InputError("Choose one of your pots");
    if (pot.status !== "confirmed") throw new InputError(`${pot.name} is still waiting in To check; confirm it first`);
    if (row.amountMinor > 0 && pot.doneOn !== null) throw new InputError(`${pot.name} is done and takes no more money`);
    if (row.kind === "spend" && pot.category === "government_tax") throw new InputError(`${pot.name} holds money that is ready for tax, so it can't be marked as spent on a purchase`);
    if (row.kind === "carry" && pot.category === "government_tax") throw new InputError(`${pot.name} holds money that is ready for tax, so it moves only by putting in or taking out, never to or from another pot`);
    change.set(pot.id, (change.get(pot.id) ?? 0) + row.amountMinor);
  }
  for (const [potId, delta] of change) {
    const pot = byId.get(potId)!;
    if (pot.savedMinor + delta < 0) throw new InputError(`${pot.name} holds ${minorMoney(pot.savedMinor, Currency.parse(pot.currency))}, which is less than that`);
  }
  for (const row of rows.filter(r => r.kind === "spend" && (r.chargeId || r.billId))) {
    const pot = byId.get(row.potId)!;
    const purchase = await purchaseInfo(tx, hid, row.chargeId ? { kind: "charge", id: row.chargeId, on: null } : { kind: "bill", id: row.billId!, on: row.billOn! }, pot.currency);
    if (purchase.amountMinor === null) continue;
    const together = rows.filter(r => r.kind === "spend" && r.chargeId === row.chargeId && r.billId === row.billId && r.billOn === row.billOn).reduce((sum, r) => sum - r.amountMinor, 0);
    const taken = await takenFor(tx, hid, row, rows.map(r => r.id));
    if (taken + together > purchase.amountMinor) {
      throw new InputError(`${purchase.label} cost ${minorMoney(purchase.amountMinor, Currency.parse(pot.currency))} and pots have already covered ${minorMoney(taken, Currency.parse(pot.currency))}, so that is more than it cost`);
    }
  }
}

const moveTitle = (kind: MoveKind, minor: number, currency: Currency, pot: string, other?: string, label?: string) => {
  const money = minorMoney(minor, currency);
  if (kind === "add") return `Added ${money} to ${pot}`;
  if (kind === "take_out") return `Took ${money} out of ${pot}`;
  if (kind === "carry") return `Moved ${money} from ${pot} to ${other}`;
  return `${money} from ${pot} went to ${label ?? "a purchase"}`;
};

/**
 * Moves money in or out of a confirmed pot: `add` (+), `take_out` (-), `spend` (-, on a charge or a bill, or just an amount) or
 * `carry` (from this pot to `toPotId`, two rows joined by a pair id). `amountMinor` is always the positive size of the move; a
 * spend with none takes the purchase, capped at what the pot holds. "confirmed" counts at once; "pending" (the agent) waits in
 * To check until `confirmMove`. `done` marks the pot done in the same transaction. Idempotent on `id`. Refuses, in words, another
 * household's pot or a pending one, more than the pot holds, a spend from the tax pot, more than a purchase cost, and money into
 * a done pot.
 */
export async function movePot(db: Db, householdId: string, input: MoveInput, status: "confirmed" | "pending", by: Maker): Promise<string> {
  const hid = requireHousehold(householdId);
  const id = z.uuid().parse(input.id), potId = z.uuid().parse(input.potId);
  if (input.kind === "carry" ? input.toPotId === null || input.toPotId === potId : input.toPotId !== null) throw new InputError(input.kind === "carry" ? "Choose a different pot to move the money to" : "Only a move between pots has a second pot");
  if (input.kind !== "spend" && input.purchase !== null) throw new InputError("Only money spent has a purchase");
  if (input.kind !== "add" && input.choiceId !== null) throw new InputError("Only money added can name a choice");
  if (input.kind === "add" && input.done) throw new InputError("A pot can't take money and be marked done at once");
  if (input.done && status === "pending") throw new InputError("Marking a pot done is for you to do, not a draft");
  if (input.amountMinor === null ? input.kind !== "spend" || input.purchase === null : !Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) {
    throw new InputError(input.amountMinor === null ? "Enter an amount" : "Enter an amount above zero");
  }
  const reason = input.reason === null || input.reason.trim() === "" ? null : input.reason.trim();
  if (reason !== null && reason.length > 200) throw new InputError("Keep the reason to 200 characters or fewer");
  const refresh = await withHousehold(db, hid, async tx => {
    const household = await lockHousehold(tx, hid);
    const home = Currency.parse(household.currency);
    const memberId = input.memberId ?? by.memberId ?? null;
    if (memberId) {
      const [member] = await tx.select({ id: members.id }).from(members).where(and(eq(members.householdId, hid), eq(members.id, memberId)));
      if (!member) throw new InputError("Choose a member of this household");
    }
    const [pot] = await tx.select().from(pots).where(and(eq(pots.householdId, hid), eq(pots.id, potId)));
    if (!pot) throw new InputError("Choose one of your pots");
    const [existing] = await tx.select().from(potMoves).where(and(eq(potMoves.householdId, hid), eq(potMoves.id, id)));
    const [to] = input.toPotId ? await tx.select().from(pots).where(and(eq(pots.householdId, hid), eq(pots.id, input.toPotId))) : [];
    if (input.toPotId && !to) throw new InputError("Choose one of your pots");
    if (input.choiceId) {
      const [choice] = await tx.select({ id: choices.id, status: choices.status }).from(choices).where(and(eq(choices.householdId, hid), eq(choices.id, input.choiceId)));
      if (!choice) throw new InputError("Choose one of your choices");
    }
    const purchase = input.purchase === null ? null : await purchaseInfo(tx, hid, input.purchase, pot.currency);
    let size = input.amountMinor;
    if (size === null) { // a spend takes the purchase, capped at what the pot holds
      if (purchase!.amountMinor === null) throw new InputError(`${purchase!.label} has no amount yet, so enter one`);
      size = Math.min(purchase!.amountMinor - await takenFor(tx, hid, purchase!, existing ? [existing.id] : []), pot.savedMinor);
      if (size <= 0) throw new InputError(pot.savedMinor <= 0 ? `${pot.name} holds nothing to spend` : `Pots have already covered all of ${purchase!.label}`);
    }
    const signed = input.kind === "add" ? size : -size;
    if (existing) { // the same move again is the same row
      if (existing.potId !== potId || existing.kind !== input.kind || existing.amountMinor !== signed) throw new InputError("This move identifier is already in use");
      return false;
    }
    const partner = input.kind === "carry" ? await stableId(hid, id, "carry") : null;
    const base = { currency: pot.currency, reason, memberId, madeBy: by.madeBy, askId: by.askId ?? null };
    const timing = status === "confirmed"
      ? { status, movedOn: clockForHousehold(household).today, confirmedAt: householdMoment(household) } as const
      : { status, movedOn: null, confirmedAt: null } as const;
    const rows: NewMove[] = [{
      ...base, ...timing, id, potId, kind: input.kind, amountMinor: signed,
      ...(purchase && { chargeId: purchase.chargeId, billId: purchase.billId, billOn: purchase.billOn }), choiceId: input.choiceId,
      ...(partner && { pairId: partner }),
    }];
    if (input.kind === "carry") rows.push({ ...base, ...timing, id: partner!, potId: to!.id, kind: "carry", amountMinor: size, pairId: partner });
    if (status === "confirmed" && household.previous === null) await observeRunway(tx, hid);
    await requireMovable(tx, hid, rows);
    await writeMove(tx, hid, { insert: rows });
    if (input.done && pot.doneOn === null) {
      await tx.update(pots).set({ doneOn: clockForHousehold(household).today }).where(and(eq(pots.householdId, hid), eq(pots.id, potId)));
      await recordEvent(tx, hid, { ...by, kind: "pot_done", title: `${pot.name} marked done`, ref: { type: "pot", id: potId } });
    }
    const title = moveTitle(input.kind, size, home, pot.name, to?.name, purchase?.label);
    const amount = { value: fromMinor(size, pot.currency), currency: pot.currency };
    if (status === "pending") {
      await recordEvent(tx, hid, { ...by, kind: "to_check", title: `${title}, to check`, amount, ref: { type: "pot_move", id }, notify: true });
      return false;
    }
    await recordEvent(tx, hid, { ...by, kind: "pot_moved", title, ...(reason && { body: reason }), amount, ref: { type: "pot_move", id } });
    await observeRunway(tx, hid);
    return true;
  });
  if (refresh) await refreshSuggestions(db, hid, "movePot");
  return id;
}

/** `confirmPending` for a pending move (both rows of a carry): it counts from now on, after the same refusals as `movePot`. False when nothing pending matches. The caller holds the household lock. */
export async function confirmMove(tx: Db, householdId: string, id: string): Promise<boolean> {
  const hid = requireHousehold(householdId);
  const [household] = await tx.select({ previous: households.runwayShort, isDemo: households.isDemo, fixedToday: households.fixedToday, timeZone: households.timeZone }).from(households).where(eq(households.id, hid));
  if (!household) return false;
  const [row] = await tx.select().from(potMoves).where(and(eq(potMoves.householdId, hid), eq(potMoves.id, id), eq(potMoves.status, "pending")));
  if (!row) return false;
  const rows = row.pairId === null ? [row] : await tx.select().from(potMoves).where(and(eq(potMoves.householdId, hid), eq(potMoves.pairId, row.pairId), eq(potMoves.status, "pending")));
  if (household.previous === null) await observeRunway(tx, hid);
  await requireMovable(tx, hid, rows);
  await writeMove(tx, hid, { confirm: { ids: rows.map(r => r.id), movedOn: clockForHousehold(household).today, confirmedAt: householdMoment(household) } });
  const currency = Currency.parse(row.currency);
  const names = new Map((await tx.select({ id: pots.id, name: pots.name }).from(pots).where(and(eq(pots.householdId, hid), inArray(pots.id, rows.map(r => r.potId))))).map(p => [p.id, p.name]));
  const from = rows.find(r => r.kind !== "carry" || r.amountMinor < 0)!, other = rows.find(r => r !== from);
  const size = Math.abs(from.amountMinor);
  await recordEvent(tx, hid, { madeBy: "form", kind: "pot_moved", title: moveTitle(from.kind, size, currency, names.get(from.potId) ?? "a pot", other && names.get(other.potId)),
    ...(from.reason && { body: from.reason }), amount: { value: fromMinor(size, row.currency), currency: row.currency }, ref: { type: "pot_move", id: from.id } });
  await observeRunway(tx, hid);
  return true;
}

/** Removes a move that still waits in To check (and its partner row, for a carry). False when this household has no such pending move. */
export async function removePendingMove(db: Db, householdId: string, id: string): Promise<boolean> {
  const hid = requireHousehold(householdId);
  const moveId = z.uuid().parse(id);
  return withHousehold(db, hid, async tx => {
    await lockHousehold(tx, hid);
    const [row] = await tx.select().from(potMoves).where(and(eq(potMoves.householdId, hid), eq(potMoves.id, moveId), eq(potMoves.status, "pending")));
    if (!row) return false;
    await tx.delete(potMoves).where(and(eq(potMoves.householdId, hid), eq(potMoves.status, "pending"), row.pairId === null ? eq(potMoves.id, moveId) : eq(potMoves.pairId, row.pairId)));
    return true;
  });
}

/** Marks a confirmed pot done today: set once, never cleared. False when this household has no such confirmed pot, or it is done already. */
export async function markPotDone(db: Db, householdId: string, id: string): Promise<boolean> {
  const hid = requireHousehold(householdId);
  const potId = z.uuid().parse(id);
  return withHousehold(db, hid, async tx => {
    const household = await lockHousehold(tx, hid);
    const [row] = await tx.update(pots).set({ doneOn: clockForHousehold(household).today })
      .where(and(eq(pots.householdId, hid), eq(pots.id, potId), eq(pots.status, "confirmed"), isNull(pots.doneOn))).returning({ name: pots.name });
    if (!row) return false;
    await recordEvent(tx, hid, { madeBy: "form", kind: "pot_done", title: `${row.name} marked done`, ref: { type: "pot", id: potId } });
    return true;
  });
}

/**
 * A client payment of `creditedMinor` (in the household's home currency) for the invoice `invoiceId` has just been credited. Inside the
 * caller's transaction, adds round(credited x fill share) to every confirmed pot with a fill rule that is not done, as a `fill` move
 * that names the invoice, and records one event per pot, such as "Set aside ¥15,000 for Tax (25% of Lumen Studio's payment)". The
 * event is recorded first and its id is the move's id. The caller holds the household lock and observes the runway after the credit,
 * which covers these moves. Returns how many pots were filled.
 */
export async function fillPots(tx: Db, householdId: string, creditedMinor: number, invoiceId: string, sourceLabel: string): Promise<number> {
  const hid = requireHousehold(householdId);
  if (!Number.isSafeInteger(creditedMinor) || creditedMinor < 0) throw new Error("A credited amount must be a non-negative integer");
  if (creditedMinor === 0) return 0;
  const invoice = z.uuid().parse(invoiceId);
  const [household] = await tx.select({ isDemo: households.isDemo, fixedToday: households.fixedToday, timeZone: households.timeZone }).from(households).where(eq(households.id, hid));
  if (!household) throw new Error("Household not found");
  const rules = await tx.select().from(pots)
    .where(and(eq(pots.householdId, hid), eq(pots.status, "confirmed"), isNotNull(pots.fillBp), isNull(pots.doneOn)))
    .orderBy(pots.createdAt, pots.name, pots.id);
  let filled = 0;
  for (const pot of rules) {
    const share = fillShare(creditedMinor, pot.fillBp!);
    if (share === 0) continue;
    const eventId = await recordEvent(tx, hid, { madeBy: "form",
      kind: "pot_filled",
      title: `Set aside ${minorMoney(share, Currency.parse(pot.currency))} for ${pot.name} (${percentText(pot.fillBp!)}% of ${sourceLabel})`,
      amount: { value: fromMinor(share, pot.currency), currency: pot.currency },
      ref: { type: "pot", id: pot.id },
    });
    await writeMove(tx, hid, { insert: [{
      id: eventId, potId: pot.id, kind: "fill", amountMinor: share, currency: pot.currency, reason: null, memberId: null, invoiceId: invoice,
      status: "confirmed", movedOn: clockForHousehold(household).today, confirmedAt: householdMoment(household), madeBy: "form", askId: null,
    }] });
    filled += 1;
  }
  return filled;
}
