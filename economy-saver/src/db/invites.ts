import { and, desc, eq, gt, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { accountMembership } from "./account";
import { recordEvent, requireHousehold, withHousehold, type Db } from "./household";
import { InputError } from "./input-error";
import { addMember } from "./people";
import { households, invites, members, pushSubscriptions, reminderSettings, users } from "./schema";

export const INVITE_TOKEN = /^[A-Za-z0-9_-]{43}$/;
const SEVEN_DAYS = 7 * 86_400_000;
const Email = z.string().trim().toLowerCase().max(254).email();
const InviteInput = z.object({ email: Email, memberId: z.string().uuid().optional(), name: z.string().trim().min(1).max(80).optional() })
  .refine(input => Boolean(input.memberId) !== Boolean(input.name), "Choose an existing person or enter one name.");
type InvitationInput = z.input<typeof InviteInput>;
type Identity = { uid: string; email: string | null };

const open = (now: Date) => and(isNull(invites.acceptedAt), gt(invites.expiresAt, now));
const sameInvite = (hid: string, id: string) => and(eq(invites.householdId, hid), eq(invites.id, id));

async function hashToken(token: string) {
  return Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))).toString("hex");
}

async function ownerMember(db: Db, hid: string, uid: string) {
  const [owner] = await db.select({ id: members.id }).from(users)
    .innerJoin(members, and(eq(members.householdId, hid), eq(members.id, users.memberId), eq(members.role, "owner")))
    .innerJoin(households, and(eq(households.id, hid), eq(households.isDemo, false)))
    .where(and(eq(users.householdId, hid), eq(users.authUserId, requireHousehold(uid))));
  if (!owner) throw new InputError("Only the household owner can manage invitations.");
  return owner.id;
}

async function lockHousehold(tx: Db, hid: string) {
  await tx.select({ id: households.id }).from(households).where(eq(households.id, hid)).for("update");
}

const listColumns = { id: invites.id, memberId: invites.memberId, name: members.displayName, email: invites.email, expiresAt: invites.expiresAt };

export async function activeInvites(db: Db, id: string, uid: string, now = new Date()) {
  const hid = requireHousehold(id);
  await ownerMember(db, hid, uid);
  return db.select(listColumns).from(invites)
    .innerJoin(members, and(eq(members.householdId, hid), eq(members.id, invites.memberId)))
    .where(and(eq(invites.householdId, hid), open(now))).orderBy(desc(invites.createdAt));
}

export async function createInvite(db: Db, id: string, uid: string, input: InvitationInput, now = new Date()) {
  const hid = requireHousehold(id);
  const data = InviteInput.safeParse(input);
  if (!data.success) throw new InputError("Enter a valid email and choose an existing person or enter a new name.");
  const { email, name, memberId } = data.data;
  const token = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
  const tokenHash = await hashToken(token);
  const expiresAt = new Date(now.getTime() + SEVEN_DAYS);
  return withHousehold(db, hid, async tx => {
    await lockHousehold(tx, hid);
    const createdByMemberId = await ownerMember(tx, hid, uid);
    const [existing] = await tx.select({ id: invites.id }).from(invites).where(and(eq(invites.householdId, hid), open(now),
      or(eq(invites.email, email), memberId ? eq(invites.memberId, memberId) : undefined)));
    if (existing) throw new InputError("Cancel the current invitation before making another for this email or person.");
    const targetId = memberId ?? await addMember(tx, hid, { name: name! });
    const [target] = await tx.select({ id: members.id, name: members.displayName }).from(members)
      .where(and(eq(members.householdId, hid), eq(members.id, targetId), eq(members.role, "member"), isNull(members.authUserId)));
    const [login] = await tx.select({ id: users.id }).from(users).where(and(eq(users.householdId, hid), eq(users.memberId, targetId))).limit(1);
    if (!target || login) throw new InputError("Choose a person in this household who does not already sign in.");
    const [row] = await tx.insert(invites).values({ householdId: hid, memberId: target.id, createdByMemberId, tokenHash, email, expiresAt, createdAt: now })
      .returning({ id: invites.id });
    await recordEvent(tx, hid, { madeBy: "form", kind: "invite_created", title: "Invitation created for " + target.name });
    return { token, id: row.id, expiresAt };
  });
}

export async function cancelInvite(db: Db, id: string, uid: string, inviteId: string, now = new Date()) {
  const hid = requireHousehold(id);
  return withHousehold(db, hid, async tx => {
    await lockHousehold(tx, hid);
    await ownerMember(tx, hid, uid);
    const [removed] = await tx.delete(invites).where(and(sameInvite(hid, inviteId), open(now))).returning({ id: invites.id });
    if (!removed) return false;
    await recordEvent(tx, hid, { madeBy: "form", kind: "invite_cancelled", title: "Invitation cancelled" });
    return true;
  });
}

async function findByToken(db: Db, token: string) {
  if (!INVITE_TOKEN.test(token)) return null;
  // The bearer hash is the routing key. Once found, further reads and writes use this household and row id.
  const [found] = await db.select().from(invites).where(eq(invites.tokenHash, await hashToken(token)));
  return found ?? null;
}

export async function inviteView(db: Db, token: string, now = new Date()) {
  const row = await findByToken(db, token);
  if (!row || row.acceptedAt || row.expiresAt <= now) return null;
  const [result] = await withHousehold(db, row.householdId, async tx => tx.select({ householdName: households.name, memberName: members.displayName }).from(members)
    .innerJoin(households, and(eq(households.id, row.householdId), eq(households.isDemo, false)))
    .where(and(eq(members.householdId, row.householdId), eq(members.id, row.memberId), isNull(members.authUserId), eq(members.role, "member"))));
  return result ?? null;
}

export async function inviteMatchesEmail(db: Db, token: string, email: string, now = new Date()) {
  const row = await findByToken(db, token);
  return Boolean(row && row.acceptedAt === null && row.expiresAt > now && row.email === email.trim().toLowerCase());
}

export async function acceptInvite(db: Db, token: string, identity: Identity, now = new Date()) {
  if (!identity.email) return null;
  const email = identity.email.trim().toLowerCase();
  const found = await findByToken(db, token);
  if (!found || found.email !== email || found.expiresAt <= now) return null;
  const hid = found.householdId;
  const uid = requireHousehold(identity.uid);
  const membership = await accountMembership(db, uid);
  if (membership && membership.householdId !== hid) throw new InputError("This login already belongs to a household.");
  return withHousehold(db, hid, async tx => {
    await lockHousehold(tx, hid);
    const [invite] = await tx.select().from(invites).where(sameInvite(hid, found.id));
    if (!invite || invite.expiresAt <= now || invite.email !== email) return null;
    const current = await accountMembership(tx, uid);
    if (current) {
      if (current.householdId === hid && current.memberId === invite.memberId && invite.acceptedAt) return hid;
      throw new InputError("This login already belongs to a household.");
    }
    if (invite.acceptedAt) return null;
    const [person] = await tx.select({ name: members.displayName }).from(members).where(and(eq(members.householdId, hid), eq(members.id, invite.memberId),
      eq(members.role, "member"), isNull(members.authUserId)));
    const [occupied] = await tx.select({ id: users.id }).from(users)
      .where(and(eq(users.householdId, hid), eq(users.memberId, invite.memberId))).limit(1);
    if (!person || occupied) return null;
    const [linked] = await tx.insert(users).values({ householdId: hid, memberId: invite.memberId, authUserId: uid })
      .onConflictDoNothing({ target: users.authUserId }).returning({ id: users.id });
    if (!linked) throw new InputError("This login already belongs to a household.");
    await tx.update(members).set({ authUserId: uid }).where(and(eq(members.householdId, hid), eq(members.id, invite.memberId)));
    await tx.update(invites).set({ acceptedAt: now }).where(sameInvite(hid, invite.id));
    await recordEvent(tx, hid, { madeBy: "form", kind: "invite_accepted", title: person.name + " joined the household" });
    return hid;
  });
}

export async function leaveHousehold(db: Db, id: string, uid: string) {
  const hid = requireHousehold(id);
  return withHousehold(db, hid, async tx => {
    await lockHousehold(tx, hid);
    const [person] = await tx.select({ id: members.id, name: members.displayName }).from(users)
      .innerJoin(members, and(eq(members.householdId, hid), eq(members.id, users.memberId), eq(members.role, "member")))
      .where(and(eq(users.householdId, hid), eq(users.authUserId, requireHousehold(uid))));
    if (!person) return false;
    await tx.delete(users).where(and(eq(users.householdId, hid), eq(users.memberId, person.id), eq(users.authUserId, uid)));
    await tx.update(members).set({ authUserId: null }).where(and(eq(members.householdId, hid), eq(members.id, person.id)));
    await tx.delete(reminderSettings).where(and(eq(reminderSettings.householdId, hid), eq(reminderSettings.memberId, person.id)));
    await tx.delete(pushSubscriptions).where(and(eq(pushSubscriptions.householdId, hid), eq(pushSubscriptions.memberId, person.id)));
    await tx.delete(invites).where(and(eq(invites.householdId, hid), eq(invites.memberId, person.id), isNull(invites.acceptedAt)));
    await recordEvent(tx, hid, { madeBy: "form", kind: "member_left", title: person.name + " left the household" });
    return true;
  });
}
