// Family view links (D52): a read-only page shared by a link that needs no sign-in. The link carries a random token; only its
// SHA-256 is stored, so the full link exists once, on the screen right after it is made. A link lasts seven days of real time
// (never the household's fixed demo date), can be stopped at once, and at most five are live at a time. Not part of the
// household snapshot (D44), like MCP tokens.
import { and, asc, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { FAMILY_LINK_DAYS, MAX_LIVE_FAMILY_LINKS } from "@/lib/family-links";
import { InputError } from "./input-error";
import { householdClockRow, loadMoneyState, recordEvent, requireHousehold, type Db } from "./household";
import { loadViewContext } from "@/lib/views/load";
import { clockForHousehold, householdMoment, type ClockHousehold } from "./clock";
import { familyLinks, households, members } from "./schema";

const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/; // 32 random bytes, base64url

async function digest(token: string) {
  return Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))).toString("hex");
}

const live = (now: Date) => and(isNull(familyLinks.stoppedAt), gt(familyLinks.expiresAt, now));
const publicColumns = { id: familyLinks.id, createdAt: familyLinks.createdAt, expiresAt: familyLinks.expiresAt };
type FamilyLinkInfo = { id: string; createdAt: Date; expiresAt: Date };
type FamilyLinkRow = FamilyLinkInfo & { made: string; until: string };

/**
 * "Nov 21" on the household's clock. A link's times are real, but a Try it household lives on its fixed date (D51), so the
 * days shown move with it: made today and lasting seven days reads "Nov 14" and "Nov 21" there, never a day before its today.
 */
export function linkDay(date: Date, household: ClockHousehold, now = new Date()) {
  const shift = householdMoment(household, now).getTime() - now.getTime();
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: household.timeZone }).format(new Date(date.getTime() + shift));
}

async function clockRow(db: Db, hid: string): Promise<ClockHousehold> {
  const household = await householdClockRow(db, hid);
  if (!household) throw new InputError("Household not found");
  return household;
}

/** The household's live links, newest first, with the days they were made and last until. */
export async function listFamilyLinks(db: Db, householdId: string, now = new Date()): Promise<FamilyLinkRow[]> {
  const hid = requireHousehold(householdId);
  const household = await clockRow(db, hid);
  const rows = await db.select(publicColumns).from(familyLinks).where(and(eq(familyLinks.householdId, hid), live(now))).orderBy(desc(familyLinks.createdAt));
  return rows.map(row => ({ ...row, made: linkDay(row.createdAt, household, now), until: linkDay(row.expiresAt, household, now) }));
}

/** Makes a link and returns its token, which is not stored anywhere. Refuses when five links are already live. */
export async function createFamilyLink(db: Db, householdId: string, now = new Date()): Promise<{ token: string; info: FamilyLinkInfo; day: string }> {
  const hid = requireHousehold(householdId);
  const token = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
  const tokenHash = await digest(token);
  const expiresAt = new Date(now.getTime() + FAMILY_LINK_DAYS * 86_400_000);
  return db.transaction(async tx => {
    await tx.select({ id: households.id }).from(households).where(eq(households.id, hid)).for("update"); // two taps cannot both pass the cap
    const household = await clockRow(tx, hid);
    const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(familyLinks).where(and(eq(familyLinks.householdId, hid), live(now)));
    if (n >= MAX_LIVE_FAMILY_LINKS) throw new InputError(`${MAX_LIVE_FAMILY_LINKS} family links are already live. Stop sharing one to make another.`);
    const [owner] = await tx.select({ id: members.id }).from(members).where(eq(members.householdId, hid))
      .orderBy(sql`(${members.role} = 'owner') desc`, asc(members.createdAt), asc(members.id)).limit(1);
    if (!owner) throw new InputError("Household not found");
    const [info] = await tx.insert(familyLinks).values({ householdId: hid, tokenHash, createdByMemberId: owner.id, createdAt: now, expiresAt }).returning(publicColumns);
    const day = linkDay(expiresAt, household, now);
    await recordEvent(tx, hid, { madeBy: "form", kind: "family_link_created", title: "Shared a family view", body: `Anyone with the link can see the month until ${day}.` });
    return { token, info, day };
  });
}

/** Stops sharing one link of this household at once; false when it is not a live link of this household. */
export async function stopFamilyLink(db: Db, householdId: string, linkId: string, now = new Date()): Promise<boolean> {
  const hid = requireHousehold(householdId);
  return db.transaction(async tx => {
    const rows = await tx.update(familyLinks).set({ stoppedAt: now })
      .where(and(eq(familyLinks.householdId, hid), eq(familyLinks.id, linkId), live(now))).returning({ id: familyLinks.id });
    if (rows.length === 0) return false;
    await recordEvent(tx, hid, { madeBy: "form", kind: "family_link_stopped", title: "Stopped sharing a family view", body: "That link no longer opens." });
    return true;
  });
}

/** The household a token opens, or null when it is unknown, expired or stopped (the page cannot tell which). */
export async function resolveFamilyLink(db: Db, token: string, now = new Date()): Promise<string | null> {
  if (!TOKEN_SHAPE.test(token)) return null;
  const [row] = await db.select({ householdId: familyLinks.householdId }).from(familyLinks)
    .where(and(eq(familyLinks.tokenHash, await digest(token)), live(now)));
  return row?.householdId ?? null;
}

/** What the family page shows for a household the token opened: its name and what the views draw from, at the household's own clock. Read only; no PayPal details and no emails. The page draws the month by category and by person, who owes whom and the shared bills; only the month needs the spending. */
export async function loadFamilyView(db: Db, householdId: string) {
  const hid = requireHousehold(householdId);
  return db.transaction(async tx => {
    const [household] = await tx.select().from(households).where(eq(households.id, hid));
    if (!household) throw new Error("Household not found");
    const { today } = clockForHousehold(household);
    const state = await loadMoneyState(tx, hid, today, household);
    return { name: household.name, state, context: await loadViewContext(tx, hid, ["spending"], { state }) };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}
