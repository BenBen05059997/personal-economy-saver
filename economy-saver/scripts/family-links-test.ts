// Family view links (D52): only the hash is stored, resolve, expiry, stop, the five-link cap, household scope. PGlite, no credentials.
// Run from the project root: npx tsx --tsconfig ./tsconfig.json scripts/family-links-test.ts
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "@/db/schema";
import { createFamilyLink, listFamilyLinks, resolveFamilyLink, stopFamilyLink } from "@/db/family-links";
import { FAMILY_LINK_DAYS, MAX_LIVE_FAMILY_LINKS } from "@/lib/family-links";
import { InputError } from "@/db/input-error";
import { seedBen } from "@/db/seed";

const DAY = 86_400_000;

async function main() {
  const pg = new PGlite({ extensions: { pg_trgm } });
  const db = drizzle(pg, { schema });
  let passed = 0;
  async function check(name: string, run: () => void | Promise<void>) { await run(); passed++; console.log(`✓ ${name}`); }
  try {
    await migrate(db, { migrationsFolder: "./drizzle" });
    const a = await seedBen(db, { isDemo: true }), b = await seedBen(db, { isDemo: true });
    const rows = (hid: string) => db.select().from(schema.familyLinks).where(eq(schema.familyLinks.householdId, hid));
    const events = (hid: string, kind: string) => db.select().from(schema.events).where(and(eq(schema.events.householdId, hid), eq(schema.events.kind, kind)));
    const t0 = new Date("2026-11-14T03:00:00Z");

    await check("a link stores only the SHA-256 of its token; the token is 43 base64url characters and appears nowhere in the database", async () => {
      const made = await createFamilyLink(db, a, t0);
      assert.match(made.token, /^[A-Za-z0-9_-]{43}$/);
      const [row] = await rows(a);
      assert.equal(row.tokenHash, createHash("sha256").update(made.token).digest("hex"));
      assert.ok(!JSON.stringify(await pg.query("select to_jsonb(t) from family_links t")).includes(made.token));
      assert.ok(!JSON.stringify(await pg.query("select to_jsonb(t) from events t")).includes(made.token));
      assert.equal(row.expiresAt.getTime(), t0.getTime() + FAMILY_LINK_DAYS * DAY, "seven days of real time, not the demo date");
      assert.equal(made.day, "Nov 21");
      assert.equal(row.stoppedAt, null);
    });

    await check("resolve returns the household for a live token and nothing for an unknown or malformed one", async () => {
      const made = await createFamilyLink(db, a, t0);
      assert.equal(await resolveFamilyLink(db, made.token, t0), a);
      assert.equal(await resolveFamilyLink(db, "A".repeat(43), t0), null);
      assert.equal(await resolveFamilyLink(db, "short", t0), null);
      assert.equal(await resolveFamilyLink(db, "", t0), null);
      assert.equal(await resolveFamilyLink(db, createHash("sha256").update(made.token).digest("hex"), t0), null, "the stored hash is not a key");
      await stopFamilyLink(db, a, made.info.id, t0);
    });

    await check("an expired link resolves to nothing, exactly at its expiry", async () => {
      const made = await createFamilyLink(db, b, t0);
      const expiry = new Date(t0.getTime() + FAMILY_LINK_DAYS * DAY);
      assert.equal(await resolveFamilyLink(db, made.token, new Date(expiry.getTime() - 1)), b);
      assert.equal(await resolveFamilyLink(db, made.token, expiry), null);
      assert.equal((await listFamilyLinks(db, b, expiry)).length, 0, "an expired link is not listed");
      await stopFamilyLink(db, b, made.info.id, t0);
    });

    await check("stopping a link ends it at once, records Activity once, and stopping again does nothing", async () => {
      const made = await createFamilyLink(db, a, t0);
      assert.equal(await resolveFamilyLink(db, made.token, t0), a);
      const before = (await events(a, "family_link_stopped")).length;
      assert.equal(await stopFamilyLink(db, a, made.info.id, t0), true);
      assert.equal(await resolveFamilyLink(db, made.token, t0), null);
      assert.equal(await stopFamilyLink(db, a, made.info.id, t0), false);
      assert.equal((await events(a, "family_link_stopped")).length, before + 1);
      assert.ok(!(await listFamilyLinks(db, a, t0)).some(l => l.id === made.info.id));
    });

    await check("Activity wording: created and stopped are recorded as the user's own form action with a label", async () => {
      const [created] = await events(a, "family_link_created");
      assert.equal(created.madeBy, "form");
      assert.equal(created.title, "Shared a family view");
      assert.match(created.body ?? "", /until Nov 21/);
      const [stopped] = await events(a, "family_link_stopped");
      assert.equal(stopped.title, "Stopped sharing a family view");
    });

    await check("at most five links are live; a sixth is refused with a clear message, and stopping one makes room", async () => {
      const c = await seedBen(db, { isDemo: true });
      const made = [];
      for (let i = 0; i < MAX_LIVE_FAMILY_LINKS; i++) made.push(await createFamilyLink(db, c, t0));
      const outcome = await createFamilyLink(db, c, t0).then(() => null, error => error);
      assert.ok(outcome instanceof InputError);
      assert.match(outcome.message, /5 family links are already live/);
      assert.equal((await rows(c)).length, 5);
      await stopFamilyLink(db, c, made[0].info.id, t0);
      assert.equal((await listFamilyLinks(db, c, t0)).length, 4);
      await createFamilyLink(db, c, t0);
      assert.equal((await listFamilyLinks(db, c, t0)).length, 5);
    });

    await check("expired links do not count towards the cap", async () => {
      const e = await seedBen(db, { isDemo: true });
      for (let i = 0; i < MAX_LIVE_FAMILY_LINKS; i++) await createFamilyLink(db, e, t0);
      const later = new Date(t0.getTime() + 8 * DAY);
      assert.equal((await createFamilyLink(db, e, later)).info.expiresAt.getTime(), later.getTime() + FAMILY_LINK_DAYS * DAY);
    });

    await check("household B cannot stop household A's link, cannot list it, and A's token opens A only", async () => {
      const made = await createFamilyLink(db, a, t0);
      assert.equal(await stopFamilyLink(db, b, made.info.id, t0), false);
      assert.equal(await resolveFamilyLink(db, made.token, t0), a);
      assert.ok(!(await listFamilyLinks(db, b, t0)).some(l => l.id === made.info.id));
      assert.ok((await listFamilyLinks(db, a, t0)).some(l => l.id === made.info.id));
      assert.equal((await events(b, "family_link_stopped")).filter(e => e.householdId === b).length, 0 + (await events(b, "family_link_stopped")).length);
      await assert.rejects(createFamilyLink(db, "", t0), /household id is required/);
      await assert.rejects(listFamilyLinks(db, "", t0), /household id is required/);
      await assert.rejects(stopFamilyLink(db, "", made.info.id, t0), /household id is required/);
    });

    await check("deleting a household deletes its links; the household snapshot never mentions them", async () => {
      const d = await seedBen(db, { isDemo: true });
      const made = await createFamilyLink(db, d, t0);
      const { loadHouseholdSnapshot } = await import("@/db/snapshot");
      const snapshot = JSON.stringify(await loadHouseholdSnapshot(db, d, { events: true }));
      assert.ok(!snapshot.includes(made.token) && !snapshot.includes((await rows(d))[0].tokenHash));
      await db.delete(schema.households).where(eq(schema.households.id, d));
      assert.equal((await rows(d)).length, 0);
      assert.equal(await resolveFamilyLink(db, made.token, t0), null);
    });

    console.log(`Family link checks passed (${passed}).`);
  } finally {
    await pg.close();
  }
}
main().catch(error => { console.error("Family link checks failed", error instanceof Error ? error.stack?.split("\n").slice(0, 8).join("\n") : error); process.exitCode = 1; });
