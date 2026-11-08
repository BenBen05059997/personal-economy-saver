// The hourly selector and the per-household daily pass, on PGlite and a fake reference-rate fetch.
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "@/db/schema";
import { dueHouseholds, runDaily } from "@/db/daily";
import { seedBen } from "@/db/seed";
import { openSuggestions } from "@/db/suggestions";

async function main() {
  const pg = new PGlite();
  const db = drizzle(pg, { schema });
  let passed = 0;
  async function check(name: string, run: () => Promise<void>) { await run(); passed++; console.log("✓ " + name); }
  const realFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async input => {
    calls.push(String(input));
    return new Response("<Cube time='2026-11-20'><Cube currency='USD' rate='1.1'/><Cube currency='JPY' rate='165'/></Cube>");
  };
  try {
    await migrate(db, { migrationsFolder: "./drizzle" });
    const at = (instant: string) => new Date(instant);
    const tokyo = await seedBen(db);
    const pacific = await seedBen(db);
    const demo = await seedBen(db, { isDemo: true });
    await db.update(schema.households).set({ timeZone: "America/Los_Angeles" }).where(eq(schema.households.id, pacific));
    const [owner] = await db.select().from(schema.members).where(eq(schema.members.householdId, tokyo));
    await db.insert(schema.reminderSettings).values({ householdId: tokyo, memberId: owner.id, hour: 9 });

    await check("selection follows each local date and hour, using 08:00 by default and skipping demos", async () => {
      assert.deepEqual(await dueHouseholds(db, at("2026-11-20T23:00:00Z")), [pacific]); // Tokyo 08:00 tomorrow, Pacific 15:00 today
      assert.deepEqual(new Set(await dueHouseholds(db, at("2026-11-21T00:00:00Z"))), new Set([tokyo, pacific]));
      assert.deepEqual(await dueHouseholds(db, at("2026-11-21T10:00:00Z")), [tokyo]); // Pacific 02:00
      assert.equal((await dueHouseholds(db, at("2026-11-21T18:00:00Z"))).includes(demo), false);
    });

    await check("the daily pass stamps the local date once and prunes only its own old Ask receipts", async () => {
      const now = at("2026-11-23T01:00:00Z");
      const old = new Date(0);
      const mine = crypto.randomUUID(), theirs = crypto.randomUUID(), fresh = crypto.randomUUID();
      await db.insert(schema.askReceipts).values([{ householdId: tokyo, askId: mine, createdAt: old },
        { householdId: tokyo, askId: fresh, createdAt: new Date() }, { householdId: pacific, askId: theirs, createdAt: old }]);
      await Promise.all([runDaily(db, tokyo, now), runDaily(db, tokyo, now)]);
      const [row] = await db.select().from(schema.households).where(eq(schema.households.id, tokyo));
      assert.equal(row.dailyRanOn, "2026-11-23");
      assert.equal((await dueHouseholds(db, now)).includes(tokyo), false);
      assert.equal((await dueHouseholds(db, at("2026-11-24T01:00:00Z"))).includes(tokyo), true);
      assert.deepEqual(new Set((await db.select().from(schema.askReceipts)).map(row => row.askId)), new Set([theirs, fresh]));
      const before = calls.length;
      await runDaily(db, tokyo, now);
      assert.equal(calls.length, before, "a repeated day skips even the reference fetch");
      const open = await openSuggestions(db, tokyo);
      assert.equal(open.filter(row => row.title === "Card A statement due Nov 26").length, 1);
      const oldEvents = (await db.select().from(schema.events).where(eq(schema.events.householdId, tokyo)))
        .filter(row => row.kind === "daily_reminder" || row.kind === "nudge_suggested");
      assert.deepEqual(oldEvents, []);
      assert.ok(calls.every(url => url.includes("ecb.europa.eu")), "the job calls only the reference-rate source");
    });

    await check("the selector caps a run at 100 and prioritizes households still waiting", async () => {
      const group = Array.from({ length: 105 }, () => ({ name: "Fictional household", homeCurrency: "USD", timeZone: "UTC" }));
      await db.insert(schema.households).values(group);
      const now = at("2026-11-24T18:00:00Z");
      const due = await dueHouseholds(db, now);
      assert.equal(due.length, 100);
      assert.equal(due.includes(tokyo), false, "the household served most recently goes behind those waiting");
      await db.update(schema.households).set({ dailyRanOn: "2026-11-24" }).where(and(eq(schema.households.isDemo, false), eq(schema.households.id, due[0])));
      const next = await dueHouseholds(db, now);
      assert.equal(next.length, 100);
      assert.equal(next.includes(due[0]), false);
      assert.equal(next.filter(id => !due.includes(id)).length, 1);
    });
  } finally {
    globalThis.fetch = realFetch;
    await pg.close();
  }
  console.log("cron: " + passed + " passed");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
