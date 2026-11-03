// People (D45): who is in the household and what share of the shared costs each pays. One function per job, called by
// Settings → People. Shares are basis points and a household's members always total exactly 10,000; adding the second
// member starts the split (`households.split_since` = the household's today). The split moves no money in the engine,
// so nothing here observes the runway.
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { householdClock } from "./account";
import { InputError } from "./input-error";
import { recordEvent, requireHousehold, type Db } from "./household";
import { households, members } from "./schema";
import { SHARE_TOTAL_BP } from "@/lib/money/split";

export const memberName = z.string().trim().min(1).max(80);
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
    await recordEvent(tx, hid, {
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
      await recordEvent(tx, hid, { kind: "member_renamed", title: `${m.name} is now called ${name}`, ref: { type: "member", id: m.id } });
    }
    if (current.every((m, i) => shares[i] === m.shareBp)) return;
    for (const [i, m] of current.entries()) await tx.update(members).set({ shareBp: shares[i] }).where(and(eq(members.householdId, hid), eq(members.id, m.id)));
    await recordEvent(tx, hid, {
      kind: "shares_updated", title: "Shared-cost shares updated",
      body: current.map((m, i) => `${given.get(m.id)!.name} ${percent(m.shareBp)}% → ${percent(shares[i])}%`).join("; "),
    });
  });
}
