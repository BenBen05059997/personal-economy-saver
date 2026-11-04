// The household schema (D44): the committed JSON Schema, the snapshot builder, scope, exclusions and the agent tool.
// PGlite only; no network, no credentials. The values planted below are fictional markers.
// Run from the project root: npx tsx --tsconfig ./tsconfig.json scripts/snapshot-test.ts
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "@/db/schema";
import { setBankBalance } from "@/db/bank-balance";
import { billInput, insertBill } from "@/db/bills";
import { DEMO_DATE } from "@/db/clock";
import { loadMoneyState } from "@/db/household";
import { fromMinor, fromRateMicro } from "@/db/money";
import { potInput, savePot } from "@/db/pots";
import { seedBen } from "@/db/seed";
import { loadHouseholdSnapshot } from "@/db/snapshot";
import { SNAPSHOT_TOOL_WINDOW, tools } from "@/lib/agent/tools";
import { SCHEMA_FILE, householdJsonSchema } from "@/lib/schema/household-json";
import { HouseholdSnapshot } from "@/lib/schema/household";

// Planted in rows the snapshot must never read. None of these may appear anywhere in its JSON.
const SECRET_VALUES = {
  aiKeySecretId: randomUUID(),
  aiKeyHint: "sk-ant-…ZZ99",
  authUserId: randomUUID(),
  tokenHash: "tokenhash-marker-" + "f".repeat(48),
  webhookMarker: "WEBHOOK-PAYLOAD-MARKER-7731",
  storagePath: "household-documents/STORAGE-PATH-MARKER/receipt.png",
  readingMarker: "EXTRACTED-READING-MARKER-5512",
  documentError: "DOCUMENT-ERROR-MARKER-9040",
  merchantId: "PAYPAL-MERCHANT-MARKER-1188",
};
// Keys no part of the snapshot may carry, at any depth.
const FORBIDDEN_KEYS = [
  "aiKeySecretId", "ai_key_secret_id", "aiKeyHint", "ai_key_hint", "aiReadsToday", "authUserId", "auth_user_id", "tokenHash", "token_hash",
  "last4", "scopes", "payload", "paypalEventId", "storagePath", "storage_path", "mime", "error", "extracted", "patch", "approveKey",
  "merchantId", "forwardingLocalpart", "balanceAsOf", "refreshError", "processingAt",
];

function walk(value: unknown, visit: (key: string, value: unknown) => void) {
  if (Array.isArray(value)) for (const item of value) walk(item, visit);
  else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) { visit(k, v); walk(v, visit); }
}

async function main() {
  let passed = 0;
  async function check(name: string, run: () => void | Promise<void>) { await run(); passed++; console.log(`✓ ${name}`); }

  await check("schema/household.v1.json equals the schema generated from the zod definition", () => {
    const committed = readFileSync(SCHEMA_FILE, "utf8");
    assert.equal(committed, householdJsonSchema(), `${SCHEMA_FILE} is out of date. Run \`npm run schema\` and commit the result.`);
    const json = JSON.parse(committed);
    assert.equal(json.additionalProperties, false);
    assert.equal(json.properties.version.const, 1);
    assert.deepEqual(json.required.includes("events"), false, "events is optional");
  });

  const pg = new PGlite();
  const db = drizzle(pg, { schema });
  try {
    await migrate(db, { migrationsFolder: "./drizzle" });
    const a = await seedBen(db, { isDemo: true });
    const b = await seedBen(db, { isDemo: true, name: "ZZ Other Household" });
    const [aMember] = await db.select().from(schema.members).where(eq(schema.members.householdId, a));
    const [aCard] = await db.select().from(schema.cards).where(eq(schema.cards.householdId, a)).limit(1);

    // Pots, a pending balance update, a document and a pending charge for A; secrets planted in A and B.
    const car = potInput.parse({ id: randomUUID(), name: "Car", target: "1200000", targetDate: "2027-03-31", saved: "200000", fillPct: "12.5" });
    const trip = potInput.parse({ id: randomUUID(), name: "Trip" });
    await savePot(db, a, car, "confirmed");
    await savePot(db, a, trip, "pending");
    const yearlyBill = billInput.parse({ id: randomUUID(), biller: "Fictional Cloud", amount: "12000", due: "2026-12-01", category: "subscriptions", repeat: "year", nextAmount: "13000", nextAmountFrom: "2027-12-01", cancelBy: "2026-11-20" });
    await insertBill(db, a, yearlyBill, "confirmed");
    const pendingBalance = randomUUID();
    await setBankBalance(db, a, { id: pendingBalance, amount: "123456" }, "pending");
    const docId = randomUUID();
    await db.insert(schema.documents).values({ id: docId, householdId: a, kind: "upload", storagePath: SECRET_VALUES.storagePath, mime: "image/png", status: "failed", error: SECRET_VALUES.documentError });
    await db.insert(schema.readings).values({ householdId: a, documentId: docId, extracted: { marker: SECRET_VALUES.readingMarker }, target: "bill" });
    await db.insert(schema.charges).values({ householdId: a, cardId: aCard.id, merchant: "Fictional noodle shop", amountMinor: 3800, currency: "JPY", date: DEMO_DATE, source: "voice", status: "pending", documentId: docId });
    await db.update(schema.households).set({ aiKeySecretId: SECRET_VALUES.aiKeySecretId, aiKeyHint: SECRET_VALUES.aiKeyHint }).where(eq(schema.households.id, a));
    await db.update(schema.members).set({ authUserId: SECRET_VALUES.authUserId }).where(eq(schema.members.id, aMember.id));
    await db.insert(schema.users).values({ householdId: a, memberId: aMember.id, authUserId: SECRET_VALUES.authUserId });
    await db.insert(schema.apiTokens).values({ householdId: a, name: "snapshot test", tokenHash: SECRET_VALUES.tokenHash, last4: "abcd", scopes: ["read"] });
    await db.insert(schema.webhookDeliveries).values({ householdId: a, paypalEventId: "WH-SNAPSHOT-1", eventType: "INVOICING.INVOICE.PAID", verified: true, payload: { marker: SECRET_VALUES.webhookMarker } });
    await db.update(schema.paypalConnections).set({ merchantId: SECRET_VALUES.merchantId }).where(eq(schema.paypalConnections.householdId, a));
    await db.insert(schema.clients).values({ householdId: b, name: "ZZ Secret Client B", email: "zz-b@example.test", termsDays: 7 });
    await db.insert(schema.bills).values({ householdId: b, biller: "ZZ Secret Biller B", amountMinor: 999, currency: "JPY", due: "2026-12-01", category: "other" });

    const snap = await loadHouseholdSnapshot(db, a, { events: false });
    const full = await loadHouseholdSnapshot(db, a, { events: true });
    const json = JSON.stringify(full);

    await check("Ben's household parses with the schema, version 1, and the household block is right", () => {
      assert.deepEqual(HouseholdSnapshot.parse(JSON.parse(JSON.stringify(snap))), snap);
      assert.equal(snap.version, 1);
      assert.deepEqual(snap.household, { id: a, name: "Ben", homeCurrency: "JPY", timeZone: "Asia/Tokyo", today: DEMO_DATE, isDemo: true,
        bankBalanceMinor: snap.household.bankBalanceMinor, paypalBalanceMinor: snap.household.paypalBalanceMinor,
        usdRateMicro: snap.household.usdRateMicro, usdRateDate: snap.household.usdRateDate, splitSince: null });
      assert.ok(Number.isInteger(snap.household.bankBalanceMinor));
      assert.equal(snap.members.length, 1);
      assert.equal(snap.members[0].displayName, "Ben");
      assert.equal(snap.clients.length, 3);
      assert.ok(snap.cards.length >= 1 && snap.statements.length >= 1 && snap.charges.length >= 1 && snap.invoices.length >= 1);
      assert.ok(snap.invoices.some(i => i.status === "paid") && snap.invoices.some(i => i.status !== "paid"));
      assert.ok(Date.parse(snap.generatedAt) > 0);
    });

    await check("PayPal balance and the USD rate equal the ones loadMoneyState uses; a USD household has the identity rate and no day", async () => {
      const state = await loadMoneyState(db, a, DEMO_DATE);
      const { paypalBalanceMinor, usdRateMicro, usdRateDate } = snap.household;
      assert.ok(paypalBalanceMinor > 0, "Ben has a PayPal balance");
      assert.equal(fromMinor(paypalBalanceMinor, "JPY"), state.paypal);
      assert.equal(fromRateMicro(usdRateMicro), state.fxPerUsd);
      assert.ok(Number.isInteger(usdRateMicro) && usdRateDate !== null && usdRateDate <= DEMO_DATE);
      const [{ date }] = await db.select({ date: schema.fxRates.date }).from(schema.fxRates).where(eq(schema.fxRates.householdId, a));
      assert.equal(usdRateDate, date);
      assert.ok(!json.includes(SECRET_VALUES.merchantId), "merchant id still absent");
      const [usd] = await db.insert(schema.households).values({ name: "Fictional USD", homeCurrency: "USD", bankBalanceMinor: 5000, isDemo: true }).returning({ id: schema.households.id });
      const usdSnap = await loadHouseholdSnapshot(db, usd.id, { events: false });
      assert.deepEqual([usdSnap.household.paypalBalanceMinor, usdSnap.household.usdRateMicro, usdSnap.household.usdRateDate], [0, 1_000_000, null]);
      const usdState = await loadMoneyState(db, usd.id, DEMO_DATE);
      assert.deepEqual([usdState.paypal, usdState.fxPerUsd], [0, 1]);
    });

    await check("every Minor field is an integer, every currency is 3 letters, every id a uuid, every day ISO", () => {
      let minors = 0, currencies = 0;
      walk(full, (key, value) => {
        if (key.endsWith("Minor") && value !== null) { minors++; assert.ok(Number.isSafeInteger(value), key); }
        if (/(^|[a-z])[cC]urrency$/.test(key) && value !== null) { currencies++; assert.match(String(value), /^[A-Z]{3}$/, key); }
        if ((key === "id" || key.endsWith("Id")) && key !== "paypalInvoiceId" && value !== null) assert.match(String(value), /^[0-9a-f-]{36}$/, key);
        if ((key.endsWith("On") || key === "due" || key === "date" || key === "today") && value !== null) assert.match(String(value), /^\d{4}-\d{2}-\d{2}$/, key);
      });
      assert.ok(minors > 20 && currencies > 10);
      assert.throws(() => HouseholdSnapshot.parse({ ...snap, household: { ...snap.household, bankBalanceMinor: 12.5 } }));
      assert.throws(() => HouseholdSnapshot.parse({ ...snap, household: { ...snap.household, homeCurrency: "yen" } }));
      assert.throws(() => HouseholdSnapshot.parse({ ...snap, version: 2 }));
    });

    await check("unknown keys are refused at every level", () => {
      assert.throws(() => HouseholdSnapshot.parse({ ...snap, extra: 1 }));
      assert.throws(() => HouseholdSnapshot.parse({ ...snap, household: { ...snap.household, aiKeyHint: "x" } }));
      assert.throws(() => HouseholdSnapshot.parse({ ...snap, charges: [{ ...snap.charges[0], storagePath: "x" }] }));
      assert.throws(() => HouseholdSnapshot.parse({ ...snap, documents: [{ ...snap.documents[0], storagePath: "x" }] }));
    });

    await check("repeating bills appear once, as stored rows with repeatDay and status", () => {
      const repeating = snap.bills.filter(bill => bill.repeatDay !== null);
      assert.ok(repeating.length >= 3, "rent, phone and the subscription repeat");
      for (const bill of repeating) assert.equal(snap.bills.filter(other => other.biller === bill.biller).length, 1, bill.biller);
      assert.ok(snap.bills.some(bill => bill.status === "pending"), "Hikari Denki waits in To check");
      assert.ok(snap.bills.every(bill => bill.status === "confirmed" || bill.status === "pending"));
      const rows = new Set(snap.bills.map(bill => bill.id));
      assert.equal(rows.size, snap.bills.length);
    });

    await check("a yearly bill with a new amount and a cancel-by date appears once, with the D48 fields; a one-off and a monthly bill carry them as null (version stays 1: the fields are optional)", () => {
      const yearly = snap.bills.find(bill => bill.id === yearlyBill.id)!;
      assert.deepEqual([yearly.repeatUnit, yearly.repeatDay, yearly.amountMinor, yearly.nextAmountMinor, yearly.nextAmountFrom, yearly.cancelBy], ["year", null, 12_000, 13_000, "2027-12-01", "2026-11-20"]);
      assert.equal(snap.bills.filter(bill => bill.biller === "Fictional Cloud").length, 1, "one row, not one per year");
      const rent = snap.bills.find(bill => bill.biller === "Rent")!;
      assert.deepEqual([rent.repeatUnit, rent.repeatDay, rent.nextAmountMinor, rent.nextAmountFrom, rent.cancelBy], ["month", 27, null, null, null]);
      assert.equal(snap.version, 1);
      // A version 1 document written before these fields existed has none of them and still validates.
      const old: Record<string, unknown> = { ...yearly };
      for (const key of ["repeatUnit", "nextAmountMinor", "nextAmountFrom", "cancelBy"]) delete old[key];
      assert.equal(HouseholdSnapshot.safeParse({ ...snap, bills: [old] }).success, true);
      assert.equal(HouseholdSnapshot.safeParse({ ...snap, bills: [{ ...yearly, repeatUnit: "week" }] }).success, false);
      assert.equal(HouseholdSnapshot.safeParse({ ...snap, bills: [{ ...yearly, cancelBy: "soon" }] }).success, false);
      const jsonSchema = JSON.parse(readFileSync(SCHEMA_FILE, "utf8")).properties.bills.items;
      assert.ok(["repeatUnit", "nextAmountMinor", "nextAmountFrom", "cancelBy"].every(key => key in jsonSchema.properties && !jsonSchema.required.includes(key)), "in the committed JSON Schema, not required");
      assert.ok(jsonSchema.required.includes("repeatDay"), "the fields that were there stay required");
    });

    await check("pots and the pending balance update appear with their status", () => {
      const confirmed = snap.pots.find(p => p.id === car.id)!, pending = snap.pots.find(p => p.id === trip.id)!;
      assert.deepEqual([confirmed.name, confirmed.targetMinor, confirmed.targetDate, confirmed.savedMinor, confirmed.fillBp, confirmed.status],
        ["Car", 1_200_000, "2027-03-31", 200_000, 1250, "confirmed"]);
      assert.deepEqual([pending.name, pending.targetMinor, pending.status], ["Trip", null, "pending"]);
      const update = snap.balanceUpdates.find(u => u.id === pendingBalance)!;
      assert.deepEqual([update.amountMinor, update.currency, update.status], [123_456, "JPY", "pending"]);
      assert.notEqual(snap.household.bankBalanceMinor, 123_456, "pending does not change the bank balance");
      const charge = snap.charges.find(c => c.merchant === "Fictional noodle shop")!;
      assert.deepEqual([charge.status, charge.source, charge.documentId], ["pending", "voice", docId]);
    });

    await check("documents are references only", () => {
      assert.deepEqual(snap.documents, [{ id: docId, kind: "upload", status: "failed", createdAt: snap.documents[0].createdAt }]);
    });

    await check("another household's rows never appear, in either direction", async () => {
      const bSnap = await loadHouseholdSnapshot(db, b, { events: true });
      assert.equal(bSnap.household.name, "ZZ Other Household");
      assert.ok(!json.includes("ZZ Secret") && !json.includes("zz-b@example.test") && !json.includes(b));
      const bJson = JSON.stringify(bSnap);
      assert.ok(bJson.includes("ZZ Secret Client B") && bJson.includes("ZZ Secret Biller B"));
      assert.ok(!bJson.includes(a) && !bJson.includes("Fictional noodle shop") && !bJson.includes('"name":"Car"'));
      const aIds = new Set<string>(), bIds = new Set<string>();
      walk(full, (k, v) => { if (k === "id") aIds.add(String(v)); });
      walk(bSnap, (k, v) => { if (k === "id") bIds.add(String(v)); });
      assert.deepEqual([...aIds].filter(x => bIds.has(x)), []);
      await assert.rejects(loadHouseholdSnapshot(db, "", { events: false }), /household id is required/);
      await assert.rejects(loadHouseholdSnapshot(db, randomUUID(), { events: false }), /Household not found/);
    });

    await check("no forbidden key and no planted secret value is in the serialized snapshot", () => {
      const seen = new Set<string>();
      walk(full, key => seen.add(key));
      for (const key of FORBIDDEN_KEYS) assert.ok(!seen.has(key), `forbidden key ${key}`);
      for (const [name, value] of Object.entries(SECRET_VALUES)) assert.ok(!json.includes(value), `secret value ${name} leaked`);
      assert.ok(!json.includes("WH-SNAPSHOT-1") && !json.includes("abcd\"") && !json.includes("INVOICING.INVOICE.PAID"));
      // Approve keys are real values in the database; none of them may appear.
      return db.select({ key: schema.invoices.approveKey }).from(schema.invoices).where(eq(schema.invoices.householdId, a))
        .then(rows => { assert.ok(rows.length > 0); for (const { key } of rows) assert.ok(!json.includes(key), "approve key leaked"); });
    });

    await check("events are in the export build and not in the tool build", () => {
      assert.ok(full.events && full.events.length >= 2);
      assert.ok(full.events.some(e => e.kind === "invoice_sent") && full.events.some(e => e.kind === "bank_balance" || e.kind === "to_check"));
      const times = full.events.map(e => Date.parse(e.occurredAt));
      assert.deepEqual(times, [...times].sort((x, y) => y - x), "newest first");
      assert.ok(!("events" in snap) && !JSON.stringify(snap).includes("\"events\""));
      assert.deepEqual(Object.values(full.truncated), Object.values(full.truncated).map(() => false));
    });

    await check("recent windows a long list to its newest rows, oldest first, and flags it", async () => {
      for (let i = 0; i < 5; i++) {
        await db.insert(schema.charges).values({ householdId: a, cardId: aCard.id, merchant: `Window ${i}`, amountMinor: 100 + i, currency: "JPY", date: `2026-11-1${i}`, source: "manual" });
      }
      const all = await loadHouseholdSnapshot(db, a, { events: false });
      assert.equal(all.truncated.charges, false);
      const dates = all.charges.map(c => c.date);
      assert.deepEqual(dates, [...dates].sort(), "oldest first");
      const cut = await loadHouseholdSnapshot(db, a, { events: false, recent: 3 });
      assert.equal(cut.charges.length, 3);
      assert.equal(cut.truncated.charges, true);
      assert.deepEqual(cut.charges.map(c => c.date), all.charges.slice(-3).map(c => c.date), "the newest three");
      assert.equal(cut.truncated.documents, false);
      assert.equal(cut.pots.length, all.pots.length, "short lists are never cut");
      assert.equal(cut.clients.length, 3);
      const exact = await loadHouseholdSnapshot(db, a, { events: false, recent: all.charges.length });
      assert.equal(exact.truncated.charges, false, "exactly the limit is not truncation");
      assert.equal(exact.charges.length, all.charges.length);
      await assert.rejects(loadHouseholdSnapshot(db, a, { events: false, recent: 0 }));
    });

    await check("the household_snapshot tool is a read tool with an empty strict input, returns the snapshot without events and windows to its cap", async () => {
      const tool = tools.find(t => t.name === "household_snapshot")!;
      assert.equal(tool.scope, "read");
      assert.deepEqual(tool.input.safeParse({}).success, true);
      assert.equal(tool.input.safeParse({ extra: 1 }).success, false);
      assert.match(tool.description, new RegExp(`${SNAPSHOT_TOOL_WINDOW} most recent`));
      const ctx = { db, householdId: a, appUrl: new URL("http://127.0.0.1:3123"), state: () => Promise.reject(new Error("the snapshot reads no engine state")) };
      const out = await tool.run(ctx, {} as never);
      const parsed = HouseholdSnapshot.parse(JSON.parse(out));
      assert.equal(parsed.household.id, a);
      assert.ok(!("events" in parsed));
      assert.equal(parsed.pots.length, 2);
      for (const value of Object.values(SECRET_VALUES)) assert.ok(!out.includes(value));
      assert.ok(!out.includes("ZZ Secret"));
      assert.ok(SNAPSHOT_TOOL_WINDOW >= 50 && SNAPSHOT_TOOL_WINDOW <= 200);
    });

    console.log(`\n${passed} checks passed`);
  } finally {
    await pg.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
