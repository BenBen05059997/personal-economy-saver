// The demo sweeper (D49): which demo households it deletes, what goes with them, the cap, and the cascade over every table. PGlite, no credentials.
// Run from the project root: npx tsx --tsconfig ./tsconfig.json scripts/sweep-test.ts
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { eq, getTableName } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "@/db/schema";
import { DEMO_LIFETIME_DAYS, SWEEP_LIMIT, resetDemoHousehold, sweepDemoHouseholds } from "@/db/demo";
import { recordEvent, type Db } from "@/db/household";
import { seedBen } from "@/db/seed";

const DAY = 86_400_000;
const NOW = new Date("2026-11-20T04:00:00Z");
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);

async function main() {
  const pg = new PGlite();
  const db = drizzle(pg, { schema });
  const store = db as unknown as Db;
  let passed = 0;
  async function check(name: string, run: () => Promise<void>) { await run(); passed++; console.log(`✓ ${name}`); }
  const exists = async (id: string) => (await db.select().from(schema.households).where(eq(schema.households.id, id))).length === 1;
  const age = (id: string, days: number) => db.update(schema.households).set({ createdAt: ago(days) }).where(eq(schema.households.id, id));
  const quiet = (id: string) => db.delete(schema.events).where(eq(schema.events.householdId, id));
  const rowsOf = async (id: string) => {
    const counts: Record<string, number> = {};
    for (const table of Object.values(schema)) {
      if (typeof table !== "object" || !table || !("householdId" in table)) continue;
      const name = getTableName(table as never);
      const result = await pg.query<{ n: number }>(`select count(*)::int as n from "${name}" where household_id = $1`, [id]);
      counts[name] = result.rows[0].n;
    }
    return counts;
  };
  const total = (counts: Record<string, number>) => Object.values(counts).reduce((a, b) => a + b, 0);

  try {
    await migrate(db, { migrationsFolder: "./drizzle" });

    await check("the lifetime is seven days and the cap is 200", async () => {
      assert.equal(DEMO_LIFETIME_DAYS, 7);
      assert.equal(SWEEP_LIMIT, 200);
    });

    await check("every foreign key that points at households cascades on delete", async () => {
      const { rows } = await pg.query<{ tbl: string; rule: string }>(
        `select c.conrelid::regclass::text as tbl, c.confdeltype as rule from pg_constraint c
         where c.contype = 'f' and c.confrelid = 'public.households'::regclass`);
      assert.ok(rows.length >= 20, "the household tables were found");
      assert.deepEqual(rows.filter(r => r.rule !== "c").map(r => r.tbl), [], "all cascade");
    });

    await check("an 8-day-old demo with no events is swept; a recent event, a 3-day-old demo and an 8-day-old real household are kept; other rows stay", async () => {
      const [oldQuiet, oldBusy, young, oldReal, unrelated] = [await seedBen(db, { isDemo: true }), await seedBen(db, { isDemo: true }), await seedBen(db, { isDemo: true }), await seedBen(db), await seedBen(db, { isDemo: true })];
      for (const id of [oldQuiet, oldBusy, oldReal]) await age(id, 8);
      await age(young, 3); await age(unrelated, 1);
      for (const id of [oldQuiet, oldBusy, oldReal, young, unrelated]) await quiet(id);
      await db.insert(schema.events).values({ householdId: oldBusy, kind: "sweep_probe", title: "Two days ago", createdAt: ago(2) });
      const before = Object.fromEntries(await Promise.all([oldBusy, young, oldReal, unrelated].map(async id => [id, await rowsOf(id)])));
      const doomed = await rowsOf(oldQuiet);
      assert.ok(doomed.bills > 0 && doomed.charges > 0 && doomed.clients > 0 && doomed.invoices > 0 && doomed.members > 0 && doomed.cards > 0, "the demo to sweep has rows in the main tables");
      const result = await sweepDemoHouseholds(store, NOW);
      assert.deepEqual(result, { swept: 1, failed: 0 });
      assert.equal(await exists(oldQuiet), false);
      for (const id of [oldBusy, young, oldReal, unrelated]) { assert.equal(await exists(id), true); assert.deepEqual(await rowsOf(id), before[id]); }
      assert.equal(total(await rowsOf(oldQuiet)), 0, "not one row of the swept household is left, in any table");
      assert.deepEqual(await sweepDemoHouseholds(store, NOW), { swept: 0, failed: 0 }, "a second run finds nothing");
      for (const id of [oldBusy, young, oldReal, unrelated]) await db.delete(schema.households).where(eq(schema.households.id, id));
    });

    await check("an event older than seven days does not keep a demo alive; one just under seven days does", async () => {
      const [stale, fresh] = [await seedBen(db, { isDemo: true }), await seedBen(db, { isDemo: true })];
      for (const id of [stale, fresh]) { await age(id, 20); await quiet(id); }
      await db.insert(schema.events).values({ householdId: stale, kind: "sweep_probe", title: "Eight days ago", createdAt: ago(8) });
      await db.insert(schema.events).values({ householdId: fresh, kind: "sweep_probe", title: "Six days ago", createdAt: ago(6) });
      assert.deepEqual(await sweepDemoHouseholds(store, NOW), { swept: 1, failed: 0 });
      assert.equal(await exists(stale), false);
      assert.equal(await exists(fresh), true);
      await db.delete(schema.households).where(eq(schema.households.id, fresh));
    });

    await check("the cap holds and the oldest go first", async () => {
      const ids: string[] = [];
      for (let i = 0; i < 5; i++) { const id = await seedBen(db, { isDemo: true }); await quiet(id); await age(id, 10 + i); ids.push(id); } // ids[4] is oldest
      assert.deepEqual(await sweepDemoHouseholds(store, NOW, 2), { swept: 2, failed: 0 });
      assert.deepEqual(await Promise.all(ids.map(exists)), [true, true, true, false, false], "the two oldest");
      assert.deepEqual(await sweepDemoHouseholds(store, NOW), { swept: 3, failed: 0 });
      assert.deepEqual(await Promise.all(ids.map(exists)), [false, false, false, false, false]);
    });

    await check("a failing deletion is counted and the others still go", async () => {
      const [bad, good] = [await seedBen(db, { isDemo: true }), await seedBen(db, { isDemo: true })];
      for (const [id, days] of [[bad, 12], [good, 9]] as const) { await quiet(id); await age(id, days); }
      // A document row makes the cleanup go to Storage, which is not configured here, so that deletion throws.
      await db.insert(schema.documents).values({ householdId: bad, storagePath: `${bad}/probe.pdf`, kind: "upload", mime: "application/pdf" });
      const originalError = console.error; console.error = () => {};
      let result;
      try { result = await sweepDemoHouseholds(store, NOW); } finally { console.error = originalError; }
      assert.deepEqual(result, { swept: 1, failed: 1 });
      assert.equal(await exists(bad), true, "the failed one is rolled back whole");
      assert.equal(await exists(good), false);
      await db.delete(schema.documents).where(eq(schema.documents.householdId, bad));
      await db.delete(schema.households).where(eq(schema.households.id, bad));
    });

    await check("Reset still deletes the household and returns a fresh demo", async () => {
      const first = await seedBen(db, { isDemo: true });
      const fresh = await resetDemoHousehold(store, first);
      assert.ok(fresh && fresh !== first);
      assert.equal(await exists(first), false);
      assert.equal(await exists(fresh), true);
      assert.equal(await resetDemoHousehold(store, first), null);
      const real = await seedBen(db);
      assert.equal(await resetDemoHousehold(store, real), null);
      assert.equal(await exists(real), true);
      await recordEvent(store, fresh, { madeBy: "form", kind: "sweep_probe", title: "A change" });
    });
  } finally {
    await pg.close();
  }
  console.log(`${passed} sweep checks passed`);
}

main().catch(error => { console.error(error); process.exit(1); });
