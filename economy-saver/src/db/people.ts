// People (D45): who is in the household and what share of the shared costs each pays. One function per job, called by
// Settings → People. Shares are basis points and a household's members always total exactly 10,000; adding the second
// member starts the split (`households.split_since` = the household's today). The split moves no money in the engine,
// so nothing here observes the runway.
import { and, desc, eq, or, sql } from "drizzle-orm";
import { z } from "zod";
import { householdClock } from "./account";
import { InputError } from "./input-error";
import { loadSplitState, recordEvent, requireHousehold, usdRateMicro, type Db } from "./household";
import { convertMinor, fromRateMicro } from "./money";
import { bills, cards, charges, households, members, pots, settlements } from "./schema";
import { Currency } from "@/lib/catalogue/types";
import { SHARE_TOTAL_BP, splitBalance } from "@/lib/money/split";

const memberName = z.string().trim().min(1).max(80);
export const addMemberInput = z.object({ name: memberName });
export const savePeopleInput = z.object({ people: z.array(z.object({ id: z.string().uuid(), name: memberName, percent: z.string().trim().optional() })).min(1) });

/** "40" or "33.33" as basis points (4000, 3333); 0 to 100 percent. */
export function parseShareBp(text: string): number {
  const match = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(text.trim());
  const bp = match ? Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0")) : -1;
  if (bp < 0 || bp > SHARE_TOTAL_BP) throw new InputError("Enter each share as a percentage from 0 to 100, such as 40");
  return bp;
}

/** The shares of `count` people split equally, as basis points in member order; the remainder goes to the first (the owner). */
export function equalShares(count: number): number[] {
  const each = Math.floor(SHARE_TOTAL_BP / count);
  return Array.from({ length: count }, (_, i) => (i === 0 ? SHARE_TOTAL_BP - each * (count - 1) : each));
}

const percent = (bp: number) => String(bp / 100);

async function lockHousehold(tx: Db, hid: string) {
  const [household] = await tx.select({ id: households.id, splitSince: households.splitSince }).from(households).where(eq(households.id, hid)).for("update");
  if (!household) throw new InputError("Household not found");
  return household;
}

/** The household's members, the owner first, as the split orders them. The caller holds the household lock for writes. */
async function orderedMembers(tx: Db, hid: string) {
  return tx.select({ id: members.id, name: members.displayName, shareBp: members.shareBp }).from(members)
    .where(eq(members.householdId, hid)).orderBy(sql`(${members.role} = 'owner') desc`, members.createdAt, members.id);
}

export async function memberCount(db: Db, householdId: string): Promise<number> {
  const hid = requireHousehold(householdId);
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(members).where(eq(members.householdId, hid));
  return row.n;
}

/** The member of this household with that display name (case does not matter), for the agent and MCP. */
export async function memberByName(db: Db, householdId: string, name: string): Promise<{ id: string; name: string }> {
  const hid = requireHousehold(householdId);
  const wanted = name.trim().toLowerCase();
  const found = (await orderedMembers(db, hid)).find(m => m.name.trim().toLowerCase() === wanted);
  if (!found) throw new InputError(`Nobody called ${name.trim()} is in this household`);
  return { id: found.id, name: found.name };
}

/**
 * Adds a person to the household. Everyone's share is reset to an equal split (the remainder to the owner) until the owner
 * changes it; the second member also starts the split at the household's today, and later members leave that day alone.
 * Names are unique within a household, because the agent finds a member by name. A new member has no sign-in.
 */
export async function addMember(db: Db, householdId: string, input: z.infer<typeof addMemberInput>): Promise<string> {
  const hid = requireHousehold(householdId);
  const data = addMemberInput.parse(input);
  return db.transaction(async tx => {
    const household = await lockHousehold(tx, hid);
    const before = await orderedMembers(tx, hid);
    if (before.some(m => m.name.trim().toLowerCase() === data.name.toLowerCase())) throw new InputError("Someone with that name is already in this household");
    const shares = equalShares(before.length + 1);
    const [added] = await tx.insert(members).values({ householdId: hid, displayName: data.name, role: "member", shareBp: 0 }).returning({ id: members.id });
    const after = [...before, { id: added.id, name: data.name, shareBp: 0 }];
    for (const [i, m] of after.entries()) {
      await tx.update(members).set({ shareBp: shares[i] }).where(and(eq(members.householdId, hid), eq(members.id, m.id)));
    }
    if (household.splitSince === null) {
      await tx.update(households).set({ splitSince: (await householdClock(tx, hid)).today }).where(eq(households.id, hid));
    }
    await recordEvent(tx, hid, { madeBy: "form",
      kind: "member_added", title: `${data.name} joined the household`,
      body: "Shares: " + after.map((m, i) => `${m.name} ${percent(shares[i])}%`).join(", "), ref: { type: "member", id: added.id },
    });
    return added.id;
  });
}

/**
 * Saves the People list in one go: each person's name and, with two or more people, each share of the shared costs. All
 * members must be named, once each; names are unique within a household (the agent finds a member by name); the shares
 * must total exactly 100%. Items already settled are never recomputed; the unsettled ones are split at the new shares
 * from now on. A rename records one event each and a share change one event; saving the same values records nothing.
 */
export async function savePeople(db: Db, householdId: string, input: z.infer<typeof savePeopleInput>): Promise<void> {
  const hid = requireHousehold(householdId);
  const data = savePeopleInput.parse(input);
  await db.transaction(async tx => {
    await lockHousehold(tx, hid);
    const current = await orderedMembers(tx, hid);
    const given = new Map(data.people.map(p => [p.id, p]));
    if (given.size !== data.people.length) throw new InputError("Name each person once");
    if (given.size !== current.length || current.some(m => !given.has(m.id))) throw new InputError("Give a name and share for every person in this household");
    const names = data.people.map(p => p.name.toLowerCase());
    if (new Set(names).size !== names.length) throw new InputError("Someone with that name is already in this household");
    const shares = current.length === 1 ? [SHARE_TOTAL_BP] : current.map(m => {
      const wanted = given.get(m.id)!.percent;
      if (wanted === undefined) throw new InputError("Give a share for every person in this household");
      return parseShareBp(wanted);
    });
    const total = shares.reduce((a, b) => a + b, 0);
    if (total !== SHARE_TOTAL_BP) throw new InputError(`The shares must total 100%; these total ${percent(total)}%`);
    for (const m of current) {
      const name = given.get(m.id)!.name;
      if (name === m.name) continue;
      await tx.update(members).set({ displayName: name }).where(and(eq(members.householdId, hid), eq(members.id, m.id)));
      await recordEvent(tx, hid, { madeBy: "form", kind: "member_renamed", title: `${m.name} is now called ${name}`, ref: { type: "member", id: m.id } });
    }
    if (current.every((m, i) => shares[i] === m.shareBp)) return;
    for (const [i, m] of current.entries()) await tx.update(members).set({ shareBp: shares[i] }).where(and(eq(members.householdId, hid), eq(members.id, m.id)));
    await recordEvent(tx, hid, { madeBy: "form",
      kind: "shares_updated", title: "Shared-cost shares updated",
      body: current.map((m, i) => `${given.get(m.id)!.name} ${percent(m.shareBp)}% → ${percent(shares[i])}%`).join("; "),
    });
  });
}

export const removeMemberInput = z.object({ id: z.string().uuid() });

/**
 * Removes a person from the household (Settings → People). The rule:
 * - The owner and the last person cannot be removed.
 *   Removing a member with a login also revokes that household access.
 * - Who owes whom between them and the household must be zero, at the household's today (lib/money/split.ts); otherwise
 *   "Settle up with Wife first." Their transfers are then already in the settlements, so nothing they owe or are owed is lost.
 * - Their own bills become shared and paid by the owner; shared bills they paid are now paid by the owner.
 * - A card they own becomes the household's (owner null), unless it carries shared charges: a shared charge is paid by its
 *   card's owner (D45), so that card becomes the owner's. Their pots become the household's.
 * - Their settlement rows go with them (a settlement names both people); the household's latest settlement must survive,
 *   because it is where the next balance starts counting. With one person left the split ends (`split_since` is cleared,
 *   so a person added later starts a new split that day); otherwise everyone's share is equal again, the remainder to the owner.
 * - Family links they made go with them (the foreign key cascades; links are made by the owner today). One `person_removed` event says all of it.
 * False when this household has no such person.
 */
export async function removeMember(db: Db, householdId: string, input: z.infer<typeof removeMemberInput>): Promise<boolean> {
  const hid = requireHousehold(householdId);
  const { id } = removeMemberInput.parse(input);
  return db.transaction(async tx => {
    const household = await lockHousehold(tx, hid);
    const [home] = await tx.select({ currency: households.homeCurrency }).from(households).where(eq(households.id, hid));
    const [person] = await tx.select({ id: members.id, name: members.displayName, role: members.role }).from(members).where(and(eq(members.householdId, hid), eq(members.id, id)));
    if (!person) return false;
    const current = await orderedMembers(tx, hid);
    if (current.length < 2) throw new InputError("The last person in a household cannot be removed");
    if (person.role === "owner") throw new InputError("The household’s owner cannot be removed");
    const owner = current[0];
    const today = (await householdClock(tx, hid)).today;
    const currency = Currency.parse(home.currency);
    const fxPerUsd = fromRateMicro(await usdRateMicro(tx, hid, currency, today));
    const split = await loadSplitState(tx, hid, household.splitSince, today, (minor, from) => convertMinor(minor, from, currency, fxPerUsd));
    const balance = splitBalance(split, today).members.find(m => m.id === id);
    if (balance && balance.netMinor !== 0) throw new InputError(`Settle up with ${person.name} first.`);

    const latest = async () => (await tx.select({ through: settlements.through, settledAt: settlements.settledAt }).from(settlements)
      .where(eq(settlements.householdId, hid)).orderBy(desc(settlements.through), desc(settlements.settledAt)).limit(1))[0] ?? null;
    const before = await latest();
    await tx.delete(settlements).where(and(eq(settlements.householdId, hid), or(eq(settlements.fromMemberId, id), eq(settlements.toMemberId, id))));
    const after = await latest();
    const left = current.filter(m => m.id !== id);
    if (left.length > 1 && before !== null && (after === null || after.through !== before.through || after.settledAt.getTime() !== before.settledAt.getTime())) {
      throw new InputError(`The last settle-up was only with ${person.name}; settle up between the others once before removing them`);
    }

    const ownBills = await tx.update(bills).set({ memberId: null, paidByMemberId: owner.id }).where(and(eq(bills.householdId, hid), eq(bills.memberId, id))).returning({ id: bills.id });
    const paidBills = await tx.update(bills).set({ paidByMemberId: owner.id }).where(and(eq(bills.householdId, hid), eq(bills.paidByMemberId, id))).returning({ id: bills.id });
    const theirCards = await tx.select({ id: cards.id, label: cards.label }).from(cards).where(and(eq(cards.householdId, hid), eq(cards.memberId, id)));
    const cardWords: string[] = [];
    for (const card of theirCards) {
      const [shared] = await tx.select({ id: charges.id }).from(charges).where(and(eq(charges.householdId, hid), eq(charges.cardId, card.id), eq(charges.shared, true))).limit(1);
      await tx.update(cards).set({ memberId: shared ? owner.id : null }).where(and(eq(cards.householdId, hid), eq(cards.id, card.id)));
      cardWords.push(shared ? `${card.label} is now ${owner.name}’s (it has shared charges)` : `${card.label} is now a household card`);
    }
    const theirPots = await tx.update(pots).set({ memberId: null }).where(and(eq(pots.householdId, hid), eq(pots.memberId, id))).returning({ id: pots.id });
    await tx.delete(members).where(and(eq(members.householdId, hid), eq(members.id, id)));

    const shares = equalShares(left.length);
    for (const [i, m] of left.entries()) await tx.update(members).set({ shareBp: shares[i] }).where(and(eq(members.householdId, hid), eq(members.id, m.id)));
    if (left.length === 1) await tx.update(households).set({ splitSince: null }).where(eq(households.id, hid));
    const billCount = ownBills.length + paidBills.length;
    const body = [
      ...(billCount ? [`${billCount === 1 ? "1 bill is" : `${billCount} bills are`} now shared and paid by ${owner.name}`] : []),
      ...cardWords,
      ...(theirPots.length ? [`${theirPots.length === 1 ? "1 pot is" : `${theirPots.length} pots are`} now the household’s`] : []),
      left.length > 1 ? "Shares: " + left.map((m, i) => `${m.name} ${percent(shares[i])}%`).join(", ") : "Nothing is split while one person is in the household",
    ];
    await recordEvent(tx, hid, { madeBy: "form", kind: "person_removed", title: `${person.name} left the household`, body: body.join(" · "), ref: { type: "member", id } });
    return true;
  });
}
