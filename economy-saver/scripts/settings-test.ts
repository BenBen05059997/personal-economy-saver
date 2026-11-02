// Isolated SQL contract tests. The test-only Vault double does not claim encryption verification.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { and, eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { AiKeyError, deleteHouseholdKey, readerKey, saveHouseholdKey } from "@/db/ai-key";
import { seedBen } from "@/db/seed";
import { amountMinor, loadSettings, settingsInput, updateSettings } from "@/db/settings";
import { deleteHousehold, loadMoneyState } from "@/db/household";
import { resetDemoHousehold } from "@/db/demo";
import { runDaily } from "@/db/daily";
import { confirmPending } from "@/db/confirm";
import { fundingOptions } from "@/lib/money/options";
import { usd } from "@/lib/money/format";
import { reviewReading } from "@/db/readings";
import { finishSetup, setupForm } from "@/db/account";

async function main() {
  const pg = new PGlite();
  const db = drizzle(pg, { schema });
  let passed = 0;
  async function check(name: string, run: () => Promise<void>) {
    await run(); passed++; console.log(`✓ ${name}`);
  }
  const previousKey = process.env.ANTHROPIC_API_KEY, previousLimit = process.env.ANTHROPIC_DAILY_READ_LIMIT;
  try {
    await migrate(db, { migrationsFolder: "./drizzle" });
    // Vault's public SQL interface is represented only in this disposable test database.
    await pg.exec(`create schema vault;
      create table vault.secrets(id uuid primary key default gen_random_uuid(), name text unique, decrypted_secret text);
      create view vault.decrypted_secrets as select * from vault.secrets;
      create function vault.create_secret(value text, label text, description text) returns uuid language plpgsql as $$
        declare secret_id uuid; begin insert into vault.secrets(name,decrypted_secret) values(label,value) returning id into secret_id; return secret_id; end $$;
      create function vault.update_secret(secret_id uuid, value text, label text) returns void language sql as $$
        update vault.secrets set decrypted_secret=value,name=label where id=secret_id $$;`);
    const a = await seedBen(db, { isDemo: true }), b = await seedBen(db, { isDemo: true });
    const fictional = "sk-ant-fictional-" + "a".repeat(40);
    const another = "sk-ant-fictional-" + "b".repeat(40);
    process.env.ANTHROPIC_API_KEY = fictional;
    process.env.ANTHROPIC_DAILY_READ_LIMIT = "2";
    await check("default calls reserve quota atomically and reset at the household local midnight", async () => {
      const before = new Date("2026-11-02T14:59:59Z"), after = new Date("2026-11-02T15:00:00Z");
      const calls = await Promise.allSettled([readerKey(db, a, before), readerKey(db, a, before), readerKey(db, a, before)]);
      assert.equal(calls.filter(call => call.status === "fulfilled").length, 2);
      assert.equal(calls.filter(call => call.status === "rejected").length, 1);
      await readerKey(db, a, after);
      const settings = await loadSettings(db, a);
      assert.equal(settings.household.aiReadsDay, "2026-11-03"); assert.equal(settings.household.aiReadsToday, 1);
      await readerKey(db, b, before);
      delete process.env.ANTHROPIC_API_KEY;
      await assert.rejects(readerKey(db, a, after), /ANTHROPIC_API_KEY is not set/);
      process.env.ANTHROPIC_API_KEY = fictional;
    });
    await check("own key creates, replaces and deletes atomically without consuming the default allowance", async () => {
      await saveHouseholdKey(db, a, fictional);
      assert.equal(await readerKey(db, a), fictional);
      const settings = await loadSettings(db, a);
      assert.equal(settings.household.aiKeyHint, "sk-ant-…aaaa");
      assert.equal(settings.household.aiReadsToday, 1);
      await saveHouseholdKey(db, a, another);
      assert.equal(await readerKey(db, a), another);
      await db.transaction(tx => deleteHouseholdKey(tx, a));
      assert.equal((await loadSettings(db, a)).household.aiKeyHint, null);
      const count = await pg.query<{ n: number }>("select count(*)::integer as n from vault.secrets");
      assert.equal(count.rows[0].n, 0);
    });
    await check("a corrupted pointer cannot read, replace or delete another household’s key", async () => {
      await saveHouseholdKey(db, b, fictional);
      const [source] = await db.select().from(schema.households).where(eq(schema.households.id, b));
      await db.update(schema.households).set({ aiKeySecretId: source.aiKeySecretId }).where(eq(schema.households.id, a));
      await assert.rejects(readerKey(db, a), AiKeyError);
      await assert.rejects(saveHouseholdKey(db, a, another), AiKeyError);
      await assert.rejects(db.transaction(tx => deleteHouseholdKey(tx, a)), AiKeyError);
      assert.equal(await readerKey(db, b), fictional);
      await db.update(schema.households).set({ aiKeySecretId: null }).where(eq(schema.households.id, a));
    });
    await check("bank amounts preserve cents and member/card/bill writes stay in the household", async () => {
      assert.equal(amountMinor("-12.37", "USD"), -1237); assert.equal(amountMinor("0.01", "USD"), 1);
      assert.throws(() => amountMinor("0.01", "JPY")); assert.throws(() => amountMinor("1.234", "USD"));
      const settingsA = await loadSettings(db, a), settingsB = await loadSettings(db, b);
      await updateSettings(db, a, settingsInput.parse({ kind: "household", name: "Fictional household", bank: "23456" }));
      assert.equal((await loadSettings(db, a)).household.bank, 23456);
      await assert.rejects(updateSettings(db, a, settingsInput.parse({ kind: "member", id: settingsB.people[0].id, name: "Wrong household" })));
      await assert.rejects(updateSettings(db, a, settingsInput.parse({ kind: "bill-owner", id: settingsA.bills[0].id, memberId: settingsB.people[0].id })));
      await updateSettings(db, a, settingsInput.parse({ kind: "bill-owner", id: settingsA.bills[0].id, memberId: settingsA.people[0].id }));
      assert.equal((await loadSettings(db, a)).bills[0].memberId, settingsA.people[0].id);
      await assert.rejects(db.update(schema.cards).set({ memberId: settingsB.people[0].id }).where(and(eq(schema.cards.householdId, a), eq(schema.cards.id, settingsA.cards[0].id))));
      await assert.rejects(db.insert(schema.bills).values({ householdId: a, memberId: settingsB.people[0].id, biller: "Invalid", amountMinor: 1, currency: "JPY", due: "2026-11-20", category: "other", status: "pending" }));
      await assert.rejects(db.insert(schema.users).values({ householdId: a, memberId: settingsB.people[0].id, authUserId: randomUUID() }));
      const [person] = await db.insert(schema.members).values({ householdId: a, displayName: "Fictional partner" }).returning();
      await updateSettings(db, a, settingsInput.parse({ kind: "bill-owner", id: settingsA.bills[0].id, memberId: person.id }));
      await db.update(schema.cards).set({ memberId: person.id }).where(and(eq(schema.cards.householdId, a), eq(schema.cards.id, settingsA.cards[0].id)));
      await db.delete(schema.members).where(and(eq(schema.members.householdId, a), eq(schema.members.id, person.id)));
      const afterDelete = await loadSettings(db, a);
      assert.equal(afterDelete.bills[0].memberId, null); assert.equal(afterDelete.cards[0].memberId, null);
    });
    await check("document ownership constraints reject cross-household reading, charge and bill references", async () => {
      const [doc] = await db.insert(schema.documents).values({ householdId: b, kind: "upload", storagePath: b + "/fictional", mime: "image/png" }).returning();
      const settings = await loadSettings(db, a);
      await assert.rejects(db.insert(schema.readings).values({ householdId: a, documentId: doc.id, extracted: {}, target: "bill" }));
      await assert.rejects(db.insert(schema.bills).values({ householdId: a, documentId: doc.id, biller: "Invalid", amountMinor: 1, currency: "JPY", due: "2026-11-20", category: "other", status: "pending" }));
      await assert.rejects(db.insert(schema.charges).values({ householdId: a, documentId: doc.id, cardId: settings.cards[0].id, merchant: "Invalid", amountMinor: 1, currency: "JPY", date: "2026-11-20", source: "manual", status: "pending" }));
      await db.delete(schema.documents).where(and(eq(schema.documents.householdId, b), eq(schema.documents.id, doc.id)));
    });
    await check("late confirmation and a concurrent cron count each closed-cycle charge once", async () => {
      const hid = await seedBen(db, { isDemo: true });
      const settings = await loadSettings(db, hid), card = settings.cards[0];
      await db.update(schema.cards).set({ closingDay: 14 }).where(and(eq(schema.cards.householdId, hid), eq(schema.cards.id, card.id)));
      const addCharge = async (amount: number) => (await db.insert(schema.charges).values({ householdId: hid, cardId: card.id, merchant: "Fictional late charge", amountMinor: amount, currency: "JPY", date: "2026-11-14", source: "manual", status: "pending" }).returning())[0];
      const charge = await addCharge(1234);
      await runDaily(db, hid);
      const get = async () => (await db.select().from(schema.cardStatements).where(and(eq(schema.cardStatements.householdId, hid), eq(schema.cardStatements.cardId, card.id), eq(schema.cardStatements.closedOn, "2026-11-14"))))[0];
      const before = (await get()).amountMinor;
      assert.equal(await confirmPending(db, hid, "charge", charge.id), true);
      assert.equal(await confirmPending(db, hid, "charge", charge.id), false);
      assert.equal((await get()).amountMinor, before + 1234);
      const next = await addCharge(4321);
      await Promise.all([runDaily(db, hid), confirmPending(db, hid, "charge", next.id), confirmPending(db, hid, "charge", next.id)]);
      assert.equal((await get()).amountMinor, before + 1234 + 4321);
      const [document] = await db.insert(schema.documents).values({ householdId: hid, kind: "upload", storagePath: hid + "/test-reading", mime: "image/png" }).returning();
      const value = { kind: "charge" as const, name: "Fictional receipt", date: "2026-11-14", amountMinor: 567, currency: "JPY" as const, category: null, cardId: card.id };
      const [reading] = await db.insert(schema.readings).values({ householdId: hid, documentId: document.id, target: "charge", extracted: { original: value, proposed: value } }).returning();
      await Promise.all([runDaily(db, hid), reviewReading(db, hid, reading.id, value), reviewReading(db, hid, reading.id, value)]);
      assert.equal((await get()).amountMinor, before + 1234 + 4321 + 567);
      await db.delete(schema.documents).where(and(eq(schema.documents.householdId, hid), eq(schema.documents.id, document.id)));
    });
    await check("options rank total cost, preserve cents, flag US assumptions and never presume credit eligibility", async () => {
      const state = await loadMoneyState(db, b, "2026-11-14");
      const options = fundingOptions(state);
      assert.equal(options.gap, 18780);
      assert.deepEqual(options.rows.map(row => row.cost), options.rows.map(row => row.cost).sort((a, b) => a - b));
      assert.equal(options.rows.find(row => row.pick)?.id, "invoice");
      assert.ok(options.rows.filter(row => row.principal > 0).every(row => !row.pick && row.status.includes("unconfirmed")));
      assert.equal(options.rows.find(row => row.id === "advance")!.principal, 20000);
      assert.equal(fundingOptions({ ...state, homeCurrency: "USD" }).rows.find(row => row.principal > 0)?.assumed, true);
      const noIncome = fundingOptions({ ...state, invoices: [] });
      assert.equal(noIncome.rows.some(row => row.pick), false);
      assert.equal(usd(400.45), "$400.45"); assert.equal(usd(400), "$400");
    });
    await check("household delete and demo reset clean only their own Vault secret", async () => {
      await saveHouseholdKey(db, a, another);
      await resetDemoHousehold(db, a);
      assert.equal(await readerKey(db, b), fictional);
      const upgrade = await seedBen(db, { isDemo: true });
      await saveHouseholdKey(db, upgrade, fictional);
      await finishSetup(db, randomUUID(), setupForm.parse({ name: "Fictional owner", currency: "USD", timeZone: "Asia/Tokyo", bank: "12.37", card: "Card C", closingDay: 15, dueDay: 10, limit: "" }), upgrade);
      const upgraded = await pg.query<{ n: number }>("select count(*)::integer as n from vault.secrets where name=$1", [`household:${upgrade}:anthropic`]);
      assert.equal(upgraded.rows[0].n, 0);
      const previousFetch = globalThis.fetch;
      const names = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_DOCUMENT_BUCKET"];
      const previousStorage = names.map(name => process.env[name]);
      let fail = true;
      const path = b + "/fictional-cleanup";
      await db.insert(schema.documents).values({ householdId: b, kind: "upload", storagePath: path, mime: "image/png" });
      process.env.SUPABASE_URL = "https://storage.example";
      process.env.SUPABASE_SERVICE_ROLE_KEY = "fictional-test-value";
      process.env.SUPABASE_DOCUMENT_BUCKET = "fictional-documents";
      globalThis.fetch = async (input, init) => {
        const request = new Request(input, init);
        assert.equal(new URL(request.url).host, "storage.example");
        if (request.method === "GET") return Response.json({ name: "fictional-documents", public: false });
        assert.equal(request.method, "DELETE");
        assert.deepEqual((await request.json()).prefixes, [path]);
        return fail ? Response.json({ message: "Fictional temporary failure" }, { status: 503 }) : Response.json([]);
      };
      try {
        await assert.rejects(deleteHousehold(db, b));
        // Storage failure rolls back the Vault deletion and preserves the retry pointer.
        assert.equal(await readerKey(db, b), fictional);
        assert.equal((await db.select().from(schema.documents).where(eq(schema.documents.householdId, b))).length, 1);
        fail = false;
        await deleteHousehold(db, b);
      } finally {
        globalThis.fetch = previousFetch;
        names.forEach((name, index) => { const value = previousStorage[index]; if (value === undefined) delete process.env[name]; else process.env[name] = value; });
      }
      const count = await pg.query<{ n: number }>("select count(*)::integer as n from vault.secrets");
      assert.equal(count.rows[0].n, 0);
    });
    console.log(`${passed}/${passed} settings and AI-key contract checks passed. Live Vault encryption remains owner-gated.`);
  } finally {
    if (previousKey === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = previousKey;
    if (previousLimit === undefined) delete process.env.ANTHROPIC_DAILY_READ_LIMIT; else process.env.ANTHROPIC_DAILY_READ_LIMIT = previousLimit;
    await pg.close();
  }
}
main().catch(() => { console.error("Settings contract verification failed"); process.exitCode = 1; });
