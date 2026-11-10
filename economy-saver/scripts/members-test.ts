// Stage 30A (D68). PGlite with fictional verified Auth identities and direct route calls.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import Module from "node:module";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { accountHousehold, accountMembership, deleteOwnedHousehold, finishSetup, setupForm } from "@/db/account";
import { acceptInvite, activeInvites, cancelInvite, createInvite, inviteMatchesEmail, inviteView, leaveHousehold } from "@/db/invites";
import { addMember } from "@/db/people";
import { seedBen } from "@/db/seed";
import * as schema from "@/db/schema";

const ORIGIN = "https://saver.example.test";
const NOW = new Date("2026-11-14T03:00:00Z");
const EXPIRES = new Date("2026-11-21T03:00:00Z");
const emailFor = (label: string) => label + "@example.test";
const identity = (label: string) => ({ uid: randomUUID(), email: emailFor(label) });
type Identity = ReturnType<typeof identity>;

import { demoCookies } from "./demo-cookie";
async function main() {
  const pg = new PGlite({ extensions: { pg_trgm } });
  const db = drizzle(pg, { schema });
  const tokenFor = demoCookies(db); // the Try it cookie is a token (D34)
  let passed = 0;
  async function check(name: string, run: () => Promise<void>) {
    await run();
    passed++;
    console.log("✓ " + name);
  }

  let signedIn: Identity | null = null;
  let demoCookie: string | null = null;
  let paypalCalls = 0;
  let modelCalls = 0;
  const settings = {
    APP_URL: ORIGIN, SUPABASE_URL: "https://auth.example.test", SUPABASE_ANON_KEY: "fictional-test-key",
    MCP_TOKEN_KEY: Buffer.alloc(32, 23).toString("base64url"),
  };
  const saved = Object.fromEntries(Object.keys(settings).map(key => [key, process.env[key]]));
  Object.assign(process.env, settings);
  const loader = Module as unknown as { _load: (request: string, parent: unknown, isMain: boolean) => unknown; _resolveFilename: (request: string, parent: unknown, isMain: boolean) => string };
  const realLoad = loader._load;
  loader._load = function (request, parent, isMain) {
    if (request === "next/headers") return { cookies: async () => {
      const demo = await tokenFor(demoCookie);
      const entries = [...(signedIn ? [{ name: "pes-auth", value: "fixture-session" }] : []), ...(demo ? [{ name: "household", value: demo }] : [])];
      return { getAll: () => entries, get: (name: string) => entries.find(cookie => cookie.name === name) };
    } };
    if (request === "@supabase/ssr") return { createServerClient: () => ({ auth: {
      getUser: async () => ({ data: { user: signedIn ? { id: signedIn.uid, email: signedIn.email, email_confirmed_at: NOW.toISOString() } : null }, error: null }),
    } }) };
    const path = (() => { try { return loader._resolveFilename(request, parent, isMain); } catch { return ""; } })();
    if (path.endsWith("/src/db/client.ts")) return { db: () => db, MissingDatabaseUrl: class extends Error {} };
    if (path.endsWith("/src/lib/paypal/toolkit.ts")) return { runTool: async () => { paypalCalls++; throw new Error("Unexpected PayPal transport call"); } };
    if (path.endsWith("/src/lib/ai/check.ts")) return { checkConnection: async () => { modelCalls++; throw new Error("Unexpected model call"); } };
    return realLoad.call(this, request, parent, isMain);
  };
  const restoreHarness = () => {
    loader._load = realLoad;
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  };

  try {
    await migrate(db, { migrationsFolder: "./drizzle" });
    const makeHousehold = async (name: string) => {
      const owner = identity(name.toLowerCase().replaceAll(" ", "-"));
      const householdId = await finishSetup(db, owner.uid, setupForm.parse({ name, timeZone: "Asia/Tokyo", currency: "USD", bank: "1250" }), null);
      const membership = await accountMembership(db, owner.uid);
      assert.ok(membership);
      assert.deepEqual([membership.householdId, membership.role], [householdId, "owner"]);
      return { householdId, owner, memberId: membership.memberId };
    };
    const a = await makeHousehold("Fictional Lantern"), b = await makeHousehold("Fictional Maple");
    const hid = a.householdId;
    const inviteRows = () => db.select().from(schema.invites).where(eq(schema.invites.householdId, hid));
    const people = () => db.select().from(schema.members).where(eq(schema.members.householdId, hid)).orderBy(schema.members.id);
    const form = (path: string, fields: Record<string, string>) =>
      new Request(ORIGIN + path, { method: "POST", body: new URLSearchParams(fields), headers: { origin: ORIGIN } });

    const guest = identity("sora-guest");
    const existing = await addMember(db, hid, { name: "Fictional Sora" });
    let token = "";
    let inviteId = "";

    await check("the owner can invite an existing person without changing their share, and only a token hash is stored", async () => {
      const before = await people();
      const invitation = await createInvite(db, hid, a.owner.uid, { email: " SORA-GUEST@example.test ", memberId: existing }, NOW);
      ({ token, id: inviteId } = invitation);
      assert.ok(token.length >= 32);
      assert.equal(new Date(invitation.expiresAt).toISOString(), EXPIRES.toISOString());
      const [stored] = await inviteRows();
      assert.deepEqual([stored.id, stored.memberId, stored.createdByMemberId, stored.email, stored.acceptedAt], [inviteId, existing, a.memberId, guest.email, null]);
      assert.equal(stored.tokenHash, createHash("sha256").update(token).digest("hex"));
      assert.ok(!JSON.stringify(stored).includes(token));
      assert.deepEqual(await people(), before);
      const [active] = await activeInvites(db, hid, a.owner.uid, NOW);
      assert.deepEqual([active.id, active.memberId, active.name, active.email], [inviteId, existing, "Fictional Sora", guest.email]);
      assert.ok(!JSON.stringify(active).includes(token) && !JSON.stringify(active).includes(stored.tokenHash));
      assert.deepEqual(await inviteView(db, token, NOW), { householdName: "Fictional Lantern", memberName: "Fictional Sora" });
      assert.equal(await inviteMatchesEmail(db, token, "  SORA-GUEST@example.test ", NOW), true);
      assert.equal(await inviteMatchesEmail(db, token, b.owner.email, NOW), false);
      assert.equal(await inviteView(db, "made-up-token", NOW), null);
    });

    await check("wrong email, another household's owner, and cross-household person IDs cannot consume or create the invitation", async () => {
      assert.equal(await acceptInvite(db, token, { ...guest, email: b.owner.email }, NOW), null);
      await assert.rejects(acceptInvite(db, token, { uid: b.owner.uid, email: guest.email }, NOW));
      assert.equal(await accountMembership(db, guest.uid), null);
      assert.equal((await inviteRows())[0].acceptedAt, null);
      assert.equal(await cancelInvite(db, b.householdId, b.owner.uid, inviteId, NOW), false);
      await assert.rejects(createInvite(db, hid, b.owner.uid, { email: guest.email, memberId: existing }, NOW));
      await assert.rejects(createInvite(db, hid, a.owner.uid, { email: emailFor("foreign-person"), memberId: b.memberId }, NOW));
      const before = await people();
      await assert.rejects(createInvite(db, hid, a.owner.uid, { email: guest.email, name: "Fictional Duplicate Invite" }, NOW), /current invitation/);
      assert.deepEqual(await people(), before, "a refused invitation creates no person or share change");
      assert.equal((await inviteRows()).length, 1);
    });

    await check("the matching verified identity joins the existing member and replay cannot create another login", async () => {
      assert.equal(await acceptInvite(db, token, guest, NOW), hid);
      assert.deepEqual(await accountMembership(db, guest.uid), { householdId: hid, memberId: existing, role: "member" });
      assert.equal(await accountHousehold(db, guest.uid), hid);
      assert.equal(await inviteView(db, token, NOW), null);
      assert.deepEqual(await activeInvites(db, hid, a.owner.uid, NOW), []);
      const [accepted] = await inviteRows();
      assert.equal(accepted.acceptedAt?.toISOString(), NOW.toISOString());
      assert.equal(await acceptInvite(db, token, guest, NOW), hid, "replaying the same verified login is idempotent");
      assert.equal(await acceptInvite(db, token, { ...guest, uid: randomUUID() }, NOW), null);
      assert.equal((await db.select().from(schema.users).where(and(eq(schema.users.householdId, hid), eq(schema.users.memberId, existing)))).length, 1);
      await assert.rejects(createInvite(db, hid, guest.uid, { email: emailFor("no-invite"), name: "Fictional Refused" }, NOW));
      assert.equal(await deleteOwnedHousehold(db, guest.uid), false);
    });

    await check("new people can be invited, and expiry or cancellation revokes the link", async () => {
      const expired = identity("expires");
      const old = await createInvite(db, hid, a.owner.uid, { email: expired.email, name: "Fictional Expiry" }, NOW);
      const [active] = await activeInvites(db, hid, a.owner.uid, NOW);
      assert.equal(active.name, "Fictional Expiry");
      assert.equal(await accountMembership(db, expired.uid), null);
      assert.equal(await inviteView(db, old.token, EXPIRES), null);
      assert.equal(await inviteMatchesEmail(db, old.token, expired.email, EXPIRES), false);
      assert.equal(await acceptInvite(db, old.token, expired, EXPIRES), null);

      const cancelled = identity("cancelled");
      const invitation = await createInvite(db, hid, a.owner.uid, { email: cancelled.email, name: "Fictional Cancel" }, NOW);
      assert.equal(await cancelInvite(db, hid, a.owner.uid, invitation.id, NOW), true);
      assert.equal(await cancelInvite(db, hid, a.owner.uid, invitation.id, NOW), false);
      assert.equal(await inviteView(db, invitation.token, NOW), null);
      assert.equal(await acceptInvite(db, invitation.token, cancelled, NOW), null);
      assert.deepEqual(await activeInvites(db, hid, a.owner.uid, EXPIRES), []);
    });

    await check("concurrent redemption links only one login to the invited member", async () => {
      const first = identity("only-one-login"), second = { ...first, uid: randomUUID() };
      const invitation = await createInvite(db, hid, a.owner.uid, { email: first.email, name: "Fictional Rei" }, NOW);
      const claimed = await Promise.allSettled([acceptInvite(db, invitation.token, first, NOW), acceptInvite(db, invitation.token, second, NOW)]);
      assert.equal(claimed.filter(outcome => outcome.status === "fulfilled" && outcome.value === hid).length, 1);
      const accounts = await Promise.all([accountMembership(db, first.uid), accountMembership(db, second.uid)]);
      assert.equal(accounts.filter(Boolean).length, 1);
      assert.equal(accounts.find(Boolean)?.role, "member");
    });

    const approve = (await import("@/app/api/approve/route")).POST;
    const model = (await import("@/app/api/settings/ai-model/route")).POST;
    const models = (await import("@/app/api/settings/ai-model/models/route")).POST;
    const editPeople = (await import("@/app/api/people/route")).POST;
    const deleteHousehold = (await import("@/app/api/household/route")).POST;
    const invitations = (await import("@/app/api/invites/route")).POST;
    const mcpTokens = (await import("@/app/api/mcp/tokens/route")).POST;
    const familyLinks = (await import("@/app/api/family-links/route")).POST;
    const readEvents = (await import("@/app/api/events/route")).GET;
    const { currentHouseholdId } = await import("@/lib/session");
    const changeToken = (body: Record<string, unknown>) => mcpTokens(new Request(ORIGIN + "/api/mcp/tokens", {
      method: "POST", body: JSON.stringify(body), headers: { origin: ORIGIN, "content-type": "application/json" },
    }));
    const changeFamily = (body: Record<string, string>) => familyLinks(form("/api/family-links", body));
    const issue = { name: "Fictional key", scopes: ["read"] };
    const share = { kind: "create" };

    await check("the member session can write to People while owner actions refuse it before any external calls", async () => {
      signedIn = guest;
      const otherPerson = await addMember(db, hid, { name: "Fictional Removable" });
      assert.equal((await editPeople(form("/api/people", { kind: "add", name: "Fictional Add by Member", householdId: b.householdId }))).status, 200);
      assert.ok((await people()).some(person => person.displayName === "Fictional Add by Member"));
      assert.equal((await db.select().from(schema.members).where(eq(schema.members.householdId, b.householdId))).length, 1);
      for (const action of ["send", "remind"]) {
        assert.equal((await approve(form("/api/approve", { action, approve_key: randomUUID() }))).status, 403);
      }
      assert.equal((await model(form("/api/settings/ai-model", { kind: "default" }))).status, 403);
      assert.equal((await model(form("/api/settings/ai-model", { kind: "save", provider: "openai" }))).status, 403);
      const catalogue = await models(form("/api/settings/ai-model/models", { provider: "openai" }));
      assert.deepEqual([catalogue.status, catalogue.headers.get("cache-control")], [403, "private, no-store"]);
      assert.deepEqual(await db.select().from(schema.requestBuckets).where(and(
        eq(schema.requestBuckets.householdId, hid), eq(schema.requestBuckets.purpose, "ai-model-list"),
      )), [], "a member cannot spend the owner's model list quota");
      assert.equal((await editPeople(form("/api/people", { kind: "remove", id: otherPerson }))).status, 403);
      assert.equal((await deleteHousehold(form("/api/household", { confirmation: "delete" }))).status, 403);
      assert.deepEqual([paypalCalls, modelCalls], [0, 0]);

      signedIn = a.owner;
      assert.ok((await editPeople(form("/api/people", { kind: "remove", id: otherPerson }))).status < 400);
      assert.ok(!(await people()).some(person => person.id === otherPerson));
      assert.equal((await approve(form("/api/approve", {}))).status, 400, "an owner reaches approval input validation");
      assert.equal((await model(form("/api/settings/ai-model", {}))).status, 400, "an owner reaches model input validation");

      signedIn = null;
      demoCookie = await seedBen(db, { isDemo: true });
      assert.equal((await approve(form("/api/approve", {}))).status, 400, "Try it keeps its own sandbox approval flow");
      demoCookie = null;
    });

    await check("only the owner can manage MCP keys and family links, while Try it keeps its controls", async () => {
      signedIn = a.owner;
      const key = await changeToken(issue);
      assert.equal(key.status, 201);
      const { info: { id: keyId } } = await key.json() as { info: { id: string } };
      const link = await changeFamily(share);
      assert.equal(link.status, 200);
      const { id: linkId } = await link.json() as { id: string };
      const keys = () => db.select().from(schema.apiTokens).where(eq(schema.apiTokens.householdId, hid));
      const links = () => db.select().from(schema.familyLinks).where(eq(schema.familyLinks.householdId, hid));
      const [beforeKeys, beforeLinks] = await Promise.all([keys(), links()]);

      signedIn = guest;
      assert.equal((await changeToken(issue)).status, 403);
      assert.equal((await changeToken({ revoke: keyId })).status, 403);
      assert.equal((await changeFamily(share)).status, 403);
      assert.equal((await changeFamily({ kind: "stop", id: linkId })).status, 403);
      assert.deepEqual(await keys(), beforeKeys);
      assert.deepEqual(await links(), beforeLinks);

      signedIn = a.owner;
      assert.equal((await changeToken({ revoke: keyId })).status, 204);
      assert.equal((await changeFamily({ kind: "stop", id: linkId })).status, 200);

      signedIn = null;
      demoCookie = await seedBen(db, { isDemo: true });
      assert.equal((await changeToken(issue)).status, 201);
      assert.equal((await changeFamily(share)).status, 200);
      demoCookie = null;
    });

    await check("the invitation route reveals a link to the owner once and protects cancellation and verified acceptance", async () => {
      const post = (fields: Record<string, string>) => invitations(form("/api/invites", fields));
      const pending = identity("route-pending");
      const create = (target: Identity, name: string) => post({ kind: "create", email: target.email, name });
      assert.equal((await create(pending, "Fictional Signed Out")).status, 401);
      signedIn = a.owner;
      const created = await create(pending, "Fictional Pending Route");
      assert.equal(created.status, 201);
      const url = new URL((await created.json()).url);
      assert.equal(url.origin, ORIGIN);
      assert.match(url.pathname, /^\/join\/[A-Za-z0-9_-]{43}$/);
      const pendingToken = url.pathname.slice("/join/".length);
      const pendingRow = (await activeInvites(db, hid, a.owner.uid)).find(row => row.email === pending.email);
      assert.ok(pendingRow);
      assert.ok(!JSON.stringify(pendingRow).includes(pendingToken));

      signedIn = guest;
      assert.equal((await create(pending, "Fictional Denied Route")).status, 403);
      assert.equal((await post({ kind: "cancel", id: pendingRow.id })).status, 403);
      assert.ok(await inviteView(db, pendingToken));
      signedIn = a.owner;
      assert.equal((await post({ kind: "cancel", id: pendingRow.id })).status, 303);
      assert.equal(await inviteView(db, pendingToken), null);

      const recipient = identity("route-accept");
      const reply = await create(recipient, "Fictional Accepted Route");
      assert.equal(reply.status, 201);
      const freshToken = new URL((await reply.json()).url).pathname.slice("/join/".length);
      signedIn = identity("wrong-verified-email");
      const denied = await post({ kind: "accept", token: freshToken });
      assert.ok(denied.status >= 400);
      assert.equal(await accountMembership(db, signedIn.uid), null);
      assert.ok(await inviteView(db, freshToken));
      signedIn = recipient;
      assert.equal((await post({ kind: "accept", token: freshToken })).status, 303);
      const membership = await accountMembership(db, recipient.uid);
      assert.ok(membership);
      assert.deepEqual([membership.householdId, membership.role], [hid, "member"]);

      signedIn = a.owner;
      assert.ok((await editPeople(form("/api/people", { kind: "remove", id: membership.memberId }))).status < 400);
      assert.equal(await accountMembership(db, recipient.uid), null, "owner removal revokes the member’s access");
      signedIn = recipient;
      assert.equal(await currentHouseholdId(), null);
      assert.equal((await readEvents(new Request(ORIGIN + "/api/events"))).status, 401);
    });

    await check("leaving unlinks login and delivery preferences while preserving the member, share and bill", async () => {
      const record = { householdId: hid, memberId: existing };
      const owner = { householdId: hid, memberId: a.memberId };
      await db.insert(schema.reminderSettings).values([{ ...record, emailOn: true, email: guest.email }, owner]);
      await db.insert(schema.pushSubscriptions).values([
        { ...record, endpoint: "https://push.example.test/member", p256dh: "fixture-member", auth: "fixture-member" },
        { ...owner, endpoint: "https://push.example.test/owner", p256dh: "fixture-owner", auth: "fixture-owner" },
      ]);
      const [bill] = await db.insert(schema.bills).values({ ...record, biller: "Fictional member bill", amountMinor: 1_200,
        currency: "USD", due: "2026-11-16", category: "utilities",
      }).returning();
      const memberBefore = (await people()).find(person => person.id === existing)!;
      assert.equal(await leaveHousehold(db, b.householdId, guest.uid), false);
      assert.equal(await leaveHousehold(db, hid, a.owner.uid), false);
      signedIn = guest;
      assert.equal((await invitations(form("/api/invites", { kind: "leave" }))).status, 303);
      assert.equal(await leaveHousehold(db, hid, guest.uid), false);
      assert.equal(await accountMembership(db, guest.uid), null);
      assert.deepEqual((await people()).find(person => person.id === existing), { ...memberBefore, authUserId: null });
      assert.deepEqual((await db.select().from(schema.bills).where(and(eq(schema.bills.householdId, hid), eq(schema.bills.id, bill.id))))[0], bill);
      const prefs = await db.select().from(schema.reminderSettings).where(eq(schema.reminderSettings.householdId, hid));
      const endpoints = await db.select().from(schema.pushSubscriptions).where(eq(schema.pushSubscriptions.householdId, hid));
      assert.deepEqual(prefs.map(row => row.memberId), [a.memberId]);
      assert.deepEqual(endpoints.map(row => row.memberId), [a.memberId]);
      assert.equal(await currentHouseholdId(), null);
      assert.equal((await readEvents(new Request(ORIGIN + "/api/events"))).status, 401);
      assert.equal((await editPeople(form("/api/people", { kind: "add", name: "Fictional After Leave" }))).status, 401);
      assert.equal((await changeToken(issue)).status, 401);
      assert.equal((await changeFamily(share)).status, 401);
      signedIn = null;
    });

    await check("an invitation cannot reference either a member or a creator from another household", async () => {
      const row = { householdId: hid, email: emailFor("bad-ref"), tokenHash: "a".repeat(64), expiresAt: EXPIRES };
      await assert.rejects(db.insert(schema.invites).values({ ...row, memberId: b.memberId, createdByMemberId: a.memberId }));
      await assert.rejects(db.insert(schema.invites).values({ ...row, memberId: existing, createdByMemberId: b.memberId }));
    });
    restoreHarness();
    const { runInviteAuthChecks } = await import("./invite-auth-test");
    await runInviteAuthChecks(db, check);
  } finally {
    restoreHarness();
    await pg.close();
  }
  console.log(String(passed) + " member checks passed");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
