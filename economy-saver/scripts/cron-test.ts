// The hourly selector and the per-household daily pass, on PGlite and a fake reference-rate fetch.
import assert from "node:assert/strict";
import Module from "node:module";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "@/db/schema";
import { dueHouseholds, runDaily } from "@/db/daily";
import { loadMoneyState } from "@/db/household";
import { CRON_BATCH_SIZE, dispatchCron } from "@/lib/cron";
import { seedBen } from "@/db/seed";
import { openSuggestions } from "@/db/suggestions";

async function main() {
  const pg = new PGlite({ extensions: { pg_trgm } });
  const db = drizzle(pg, { schema });
  let passed = 0;
  async function check(name: string, run: () => Promise<void>) { await run(); passed++; console.log("✓ " + name); }
  const realFetch = globalThis.fetch;
  const calls: string[] = [];
  let failEcb = false;
  globalThis.fetch = async input => {
    calls.push(String(input));
    if (failEcb) return new Response("Untrusted upstream response", { status: 503 });
    return new Response("<Cube time='2026-11-20'><Cube currency='USD' rate='1.1'/><Cube currency='JPY' rate='169.4'/></Cube>");
  };
  try {
    await migrate(db, { migrationsFolder: "./drizzle" });
    // Housekeeping sweeps saved-key secrets; Supabase Vault's table is stood in for here.
    await pg.exec(`create schema vault; create table vault.secrets(id uuid primary key default gen_random_uuid(), name text unique, decrypted_secret text);`);
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

    await check("an ECB outage logs once and the pass uses this household’s stored rate", async () => {
      const date = "2026-11-23";
      const now = at(date + "T18:00:00Z");
      const before = (await loadMoneyState(db, pacific, date)).fxPerUsd;
      const lines: unknown[] = [];
      const errorLog = console.error;
      console.error = (...line: unknown[]) => { lines.push(...line); };
      failEcb = true;
      try {
        await runDaily(db, pacific, now);
      } finally {
        failEcb = false;
        console.error = errorLog;
      }
      const [row] = await db.select().from(schema.households).where(eq(schema.households.id, pacific));
      assert.equal(row.dailyRanOn, date);
      assert.equal((await loadMoneyState(db, pacific, date)).fxPerUsd, before);
      assert.equal((await db.select().from(schema.fxRates).where(eq(schema.fxRates.householdId, pacific))).length, 1);
      assert.ok((await openSuggestions(db, pacific)).length > 0);
      assert.deepEqual(lines.map(line => JSON.parse(String(line))), [
        { at: "cron_fx_unavailable", householdId: pacific, name: "Error", message: "ECB reference rate unavailable" },
      ]);
    });

    await check("an ECB outage with no stored rate leaves a real JPY household due for retry", async () => {
      const [household] = await db.insert(schema.households).values({ name: "Fictional no rate", homeCurrency: "JPY", timeZone: "UTC" }).returning();
      const now = at("2026-11-23T18:00:00Z");
      const lines: unknown[] = [];
      const errorLog = console.error;
      console.error = (...line: unknown[]) => { lines.push(...line); };
      failEcb = true;
      try {
        await assert.rejects(runDaily(db, household.id, now), /No USD\/JPY rate on or before 2026-11-23/);
      } finally {
        failEcb = false;
        console.error = errorLog;
      }
      assert.equal(lines.length, 1);
      assert.equal((await dueHouseholds(db, now)).includes(household.id), true);
      await db.delete(schema.households).where(eq(schema.households.id, household.id));
    });

    await check("a failed pass keeps the committed rate and retries before stamping the date", async () => {
      const hid = await seedBen(db);
      const now = at("2026-11-23T01:00:00Z");
      await pg.exec(`
        create function refuse_suggestion_for_cron_test() returns trigger language plpgsql as $$
        begin raise exception 'Fictional retry error'; end; $$;
        create trigger refuse_suggestion_for_cron_test before insert on suggestions
          for each row execute function refuse_suggestion_for_cron_test()
      `);
      try {
        await assert.rejects(runDaily(db, hid, now));
        const [row] = await db.select().from(schema.households).where(eq(schema.households.id, hid));
        assert.equal(row.dailyRanOn, null);
        assert.equal((await loadMoneyState(db, hid, "2026-11-23")).fxPerUsd, 154);
        assert.equal((await dueHouseholds(db, now)).includes(hid), true);
      } finally {
        await pg.exec("drop trigger refuse_suggestion_for_cron_test on suggestions; drop function refuse_suggestion_for_cron_test()");
      }
      await runDaily(db, hid, now);
      const [row] = await db.select().from(schema.households).where(eq(schema.households.id, hid));
      assert.equal(row.dailyRanOn, "2026-11-23");
    });

    await check("already-scanned reminder households share the same oldest-first order as daily passes", async () => {
      const [member] = await db.select().from(schema.members).where(eq(schema.members.householdId, pacific));
      await db.insert(schema.reminderSettings).values({ householdId: pacific, memberId: member.id, hour: 8, emailOn: true, email: "cron@example.test" });
      await db.update(schema.households).set({ createdAt: new Date("2026-10-01") }).where(eq(schema.households.id, pacific));
      const due = await dueHouseholds(db, at("2026-11-24T00:00:00Z")); // Tokyo Nov 24, Pacific Nov 23
      assert.deepEqual(due.filter(id => id === tokyo || id === pacific), [pacific, tokyo]);
    });

    await check("the selector caps a run and prioritizes households still waiting", async () => {
      const group = Array.from({ length: 105 }, () => ({ name: "Fictional household", homeCurrency: "USD", timeZone: "UTC" }));
      await db.insert(schema.households).values(group);
      const now = at("2026-11-24T18:00:00Z");
      const due = await dueHouseholds(db, now);
      assert.equal(due.length, CRON_BATCH_SIZE);
      assert.equal(due.includes(tokyo), false, "the household served most recently goes behind those waiting");
      await db.update(schema.households).set({ dailyRanOn: "2026-11-24" }).where(and(eq(schema.households.isDemo, false), eq(schema.households.id, due[0])));
      const next = await dueHouseholds(db, now);
      assert.equal(next.length, CRON_BATCH_SIZE);
      assert.equal(next.includes(due[0]), false);
      assert.equal(next.filter(id => !due.includes(id)).length, 1);
    });

    await check("cron discovery and single-household routes both require a bearer and report individual failures", async () => {
      const secret = "fictional-cron-test";
      const saved = process.env.CRON_SECRET;
      process.env.CRON_SECRET = secret;
      const loader = Module as unknown as {
        _load: (request: string, parent: unknown, isMain: boolean) => unknown;
        _resolveFilename: (request: string, parent: unknown, isMain: boolean) => string;
      };
      const realLoad = loader._load;
      loader._load = function (request, parent, isMain) {
        if (request === "next/server") return { connection: async () => {} };
        const path = loader._resolveFilename(request, parent, isMain);
        if (path.endsWith("/src/db/client.ts")) return { db: () => db };
        return realLoad.call(this, request, parent, isMain);
      };
      const errors: unknown[] = [];
      const errorLog = console.error;
      console.error = (...line: unknown[]) => { errors.push(...line); };
      try {
        const GET = (await import("@/app/api/cron/route")).GET;
        const [first, second] = await db.insert(schema.households).values([
          { name: "Fictional Cron First", homeCurrency: "USD", timeZone: "UTC" },
          { name: "Fictional Cron Second", homeCurrency: "USD", timeZone: "UTC" },
        ]).returning();
        const absent = crypto.randomUUID();
        const request = (id?: string, bearer?: string) => GET(new Request(
          "https://worker.internal/api/cron" + (id === undefined ? "" : "?household=" + id),
          { headers: bearer ? { authorization: "Bearer " + bearer } : {} },
        ));
        assert.equal((await request()).status, 401);
        assert.equal((await request(first.id, "fictional-cron-tesx")).status, 401);
        assert.equal((await request("bad-id", secret)).status, 400);
        const list = await request(undefined, secret);
        assert.equal(list.headers.get("cache-control"), "private, no-store");
        assert.ok(Array.isArray((await list.json()).ids));
        const days = () => db.select({ day: schema.households.dailyRanOn }).from(schema.households)
          .where(sql`${schema.households.id} in (${first.id}, ${second.id})`);
        assert.deepEqual(await days(), [{ day: null }, { day: null }], "discovery did not run any household");
        assert.equal((await request(absent, secret)).status, 503);
        assert.equal((await request(first.id, secret)).status, 200);
        assert.equal((await days()).filter(row => row.day !== null).length, 1, "dispatch ran just one household");
        assert.deepEqual(errors.map(line => JSON.parse(String(line))), [
          { at: "cron_household_failed", householdId: absent, name: "Error", message: "Scheduled household not found" },
        ]);
      } finally {
        loader._load = realLoad;
        console.error = errorLog;
        if (saved === undefined) delete process.env.CRON_SECRET;
        else process.env.CRON_SECRET = saved;
      }
    });

    await check("the Worker dispatches at most 30 ordered household requests and continues after failures", async () => {
      const ids = Array.from({ length: CRON_BATCH_SIZE + 5 }, () => crypto.randomUUID());
      const selected: (string | null)[] = [];
      const runs = await dispatchCron(async request => {
        const url = new URL(request.url);
        assert.equal(url.pathname, "/api/cron");
        assert.equal(request.headers.get("authorization"), "Bearer fictional-binding-secret");
        const id = url.searchParams.get("household");
        selected.push(id);
        if (!id) return Response.json({ ids });
        if (id === ids[1]) throw new Error("Fictional binding failure");
        return new Response(null, { status: id === ids[2] ? 503 : 200 });
      }, "fictional-binding-secret");
      assert.deepEqual(selected, [null, ...ids.slice(0, CRON_BATCH_SIZE)]);
      assert.deepEqual(runs, { completed: CRON_BATCH_SIZE - 2, failed: 2 });
    });
  } finally {
    globalThis.fetch = realFetch;
    await pg.close();
  }
  console.log("cron: " + passed + " passed");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
