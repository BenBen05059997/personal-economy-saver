// The household schema (D44): the committed JSON Schema, the snapshot builder, scope, exclusions and the agent tool.
// PGlite only; no network, no credentials. The values planted below are fictional markers.
// Run from the project root: npx tsx --tsconfig ./tsconfig.json scripts/snapshot-test.ts
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
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
import { SCHEMA_FILE, householdJsonSchema, schemaFiles } from "@/lib/schema/household-json";
import { addMemory } from "@/db/memory";
import { pinCanvas } from "@/db/canvases";
import { saveTurn } from "@/db/conversation";
import { CashFlowEvent } from "@/lib/schema/cash-flow";
import { MemoryItem } from "@/lib/schema/memory";
import { ConversationTurn } from "@/lib/schema/turn";
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

  await check("schema/household.v4.json equals the schema generated from the zod definition, and so do the recipe, memory, turn and cash-flow schemas (drift for all five files)", () => {
    const committed = readFileSync(SCHEMA_FILE, "utf8");
    assert.equal(committed, householdJsonSchema(), `${SCHEMA_FILE} is out of date. Run \`npm run schema\` and commit the result.`);
    const files = schemaFiles();
    assert.deepEqual(files.map(f => f.file), ["schema/household.v4.json", "schema/recipe.v1.json", "schema/memory.v1.json", "schema/turn.v1.json", "schema/cash-flow-event.v1.json"]);
    for (const { file, text } of files) assert.equal(readFileSync(file, "utf8"), text, `${file} is out of date. Run \`npm run schema\` and commit the result.`);
    assert.equal(existsSync("schema/household.v1.json"), false, "version 1 file is not kept");
    const json = JSON.parse(committed);
    assert.equal(json.additionalProperties, false);
    assert.equal(json.properties.version.const, 4);
    assert.equal(json.required.includes("ownCategories"), false, "ownCategories is optional: version 2 and 3 files have none");
    assert.ok("ownCategories" in json.properties && "ownCategoryId" in json.properties.bills.items.properties && "ownCategoryId" in json.properties.charges.items.properties);
    for (const optional of ["events", "memory", "canvases", "journal", "spaces"]) assert.deepEqual(json.required.includes(optional), false, `${optional} is optional`);
    for (const key of ["memory", "canvases", "journal", "spaces"]) assert.ok(key in json.properties, key);
  });

  await check("D53: travel is one of the fourteen category keys in the committed schema, on bills and charges (a new key only widens the enum)", () => {
    const json = JSON.parse(readFileSync(SCHEMA_FILE, "utf8"));
    for (const list of ["bills", "charges"]) {
      const keys: string[] = json.properties[list].items.properties.category.enum;
      assert.equal(keys.length, 14, list);
      assert.deepEqual(keys.slice(5, 7), ["transport", "travel"], `${list}: travel after transport`);
    }
  });

  const pg = new PGlite({ extensions: { pg_trgm } });
  const db = drizzle(pg, { schema });
  try {
    await migrate(db, { migrationsFolder: "./drizzle" });
    const a = await seedBen(db, { isDemo: true });
    const [aMember] = await db.select().from(schema.members).where(eq(schema.members.householdId, a));
    const [aCard] = await db.select().from(schema.cards).where(eq(schema.cards.householdId, a)).limit(1);

    // Pots, a pending balance update, a document and a pending charge for A; secrets planted in A.
    const car = potInput.parse({ id: randomUUID(), name: "Car", target: "1200000", targetDate: "2027-03-31", saved: "200000", fillPct: "12.5" });
    const trip = potInput.parse({ id: randomUUID(), name: "Trip" });
    await savePot(db, a, car, "confirmed", { madeBy: "form" });
    await savePot(db, a, trip, "pending", { madeBy: "form" });
    const yearlyBill = billInput.parse({ id: randomUUID(), biller: "Fictional Cloud", amount: "12000", due: "2026-12-01", category: "subscriptions", repeat: "year", nextAmount: "13000", nextAmountFrom: "2027-12-01", cancelBy: "2026-11-20", repeatUntil: "2028-06-01" });
    await insertBill(db, a, yearlyBill, "confirmed", { madeBy: "form" });
    const monthBill = billInput.parse({ id: randomUUID(), biller: "Fictional Water", amount: "4300", due: "2026-12-27", category: "utilities", periodStart: "2026-11-01", periodEnd: "2026-11-30" });
    await insertBill(db, a, monthBill, "confirmed", { madeBy: "form" });
    const pendingBalance = randomUUID();
    await setBankBalance(db, a, { id: pendingBalance, amount: "123456" }, "pending", { madeBy: "form" });
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

    const snap = await loadHouseholdSnapshot(db, a, { events: false });
    const full = await loadHouseholdSnapshot(db, a, { events: true });
    const json = JSON.stringify(full);

    await check("Ben's household parses with the schema, version 4, and the household block is right", () => {
      assert.deepEqual(HouseholdSnapshot.parse(JSON.parse(JSON.stringify(snap))), snap);
      assert.equal(snap.version, 4);
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
      assert.ok(state.paypalHeld && state.paypalHeld.amount > 0, "Home shows the balance in the currency PayPal holds it in");
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

    await check("own categories (D75): the list is in the snapshot, and every filed bill and charge points at one of its category's kind", () => {
      assert.deepEqual(snap.ownCategories!.map(o => [o.kind, o.name, o.businessBp]).sort(), [["food", "Coffee", null], ["other", "Books & films", null], ["other", "Gear", null]]);
      const filed = [...snap.charges, ...snap.bills].filter(x => x.ownCategoryId);
      assert.equal(filed.length, 7);
      for (const row of filed) assert.equal(snap.ownCategories!.find(o => o.id === row.ownCategoryId)?.kind, row.category);
      assert.ok(snap.charges.filter(x => !x.ownCategoryId).every(x => x.ownCategoryId === null));
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
      assert.throws(() => HouseholdSnapshot.parse({ ...snap, version: 1 }));
      assert.throws(() => HouseholdSnapshot.parse({ ...snap, version: 5 }));
      assert.throws(() => HouseholdSnapshot.parse({ ...snap, version: 3 }), Error, "an older file is read by Import with its own version, not by this schema");
      assert.throws(() => HouseholdSnapshot.parse({ ...snap, ownCategories: [{ id: snap.ownCategories![0].id, kind: "food", name: "x".repeat(41), businessBp: null }] }));
      assert.throws(() => HouseholdSnapshot.parse({ ...snap, ownCategories: [{ ...snap.ownCategories![0], extra: 1 }] }));
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

    await check("a yearly bill with a new amount and a cancel-by date appears once, with the D48 fields; a one-off and a monthly bill carry them as null (the fields are optional)", () => {
      const yearly = snap.bills.find(bill => bill.id === yearlyBill.id)!;
      assert.deepEqual([yearly.repeatUnit, yearly.repeatDay, yearly.amountMinor, yearly.nextAmountMinor, yearly.nextAmountFrom, yearly.cancelBy, yearly.repeatUntil], ["year", null, 12_000, 13_000, "2027-12-01", "2026-11-20", "2028-06-01"]);
      assert.equal(snap.bills.filter(bill => bill.biller === "Fictional Cloud").length, 1, "one row, not one per year");
      const rent = snap.bills.find(bill => bill.biller === "Rent")!;
      assert.deepEqual([rent.repeatUnit, rent.repeatDay, rent.nextAmountMinor, rent.nextAmountFrom, rent.cancelBy, rent.repeatUntil ?? null], ["month", 27, null, null, null, null]);
      assert.equal(snap.version, 4);
      // A document written before these fields existed written before these fields existed has none of them and still validates.
      const old: Record<string, unknown> = { ...yearly };
      for (const key of ["repeatUnit", "nextAmountMinor", "nextAmountFrom", "cancelBy", "repeatUntil"]) delete old[key];
      assert.equal(HouseholdSnapshot.safeParse({ ...snap, bills: [old] }).success, true);
      assert.equal(HouseholdSnapshot.safeParse({ ...snap, bills: [{ ...yearly, repeatUnit: "week" }] }).success, false);
      assert.equal(HouseholdSnapshot.safeParse({ ...snap, bills: [{ ...yearly, cancelBy: "soon" }] }).success, false);
      const jsonSchema = JSON.parse(readFileSync(SCHEMA_FILE, "utf8")).properties.bills.items;
      assert.ok(["repeatUnit", "nextAmountMinor", "nextAmountFrom", "cancelBy", "repeatUntil"].every(key => key in jsonSchema.properties && !jsonSchema.required.includes(key)), "in the committed JSON Schema, not required");
      assert.ok(jsonSchema.required.includes("repeatDay"), "the fields that were there stay required");
    });

    await check("a bill's billing period is exported with the bill (both dates, or null), and the committed JSON Schema lists them as optional", async () => {
      const water = snap.bills.find(bill => bill.id === monthBill.id)!;
      assert.deepEqual([water.periodStart, water.periodEnd], ["2026-11-01", "2026-11-30"]);
      assert.equal(snap.bills.find(bill => bill.id === yearlyBill.id)!.periodStart ?? null, null);
      assert.equal(HouseholdSnapshot.safeParse({ ...snap, bills: [{ ...water, periodStart: "soon" }] }).success, false);
      const jsonSchema = JSON.parse(readFileSync(SCHEMA_FILE, "utf8")).properties.bills.items;
      assert.ok(["periodStart", "periodEnd"].every(key => key in jsonSchema.properties && !jsonSchema.required.includes(key)));
      await assert.rejects(insertBill(db, a, { ...monthBill, id: randomUUID(), periodEnd: "2026-10-01" }, "confirmed", { madeBy: "form" }), /must start on or before/);
      await assert.rejects(insertBill(db, a, { ...monthBill, id: randomUUID(), periodEnd: null }, "confirmed", { madeBy: "form" }), /both the first and the last day/);
      await assert.rejects(insertBill(db, a, { ...monthBill, id: randomUUID(), repeat: "month" }, "confirmed", { madeBy: "form" }), /different month each time/);
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

    await check("D50: madeBy is on the charges, bills, invoices, pots, balance updates and events, and the schema keeps it optional", () => {
      const lists = [snap.charges, snap.bills, snap.invoices, snap.pots, snap.balanceUpdates, full.events ?? []];
      for (const list of lists) {
        assert.ok(list.length > 0);
        for (const row of list) assert.ok(["form", "ask", "mcp", "reader", "cron", "paypal", "import"].includes(row.madeBy ?? ""), JSON.stringify(row));
      }
      assert.equal(snap.version, 4);
      const old = JSON.parse(JSON.stringify(snap.pots[0])) as Record<string, unknown>;
      delete old.madeBy;
      assert.deepEqual(HouseholdSnapshot.parse({ ...JSON.parse(JSON.stringify(snap)), pots: [old] }).pots.length, 1, "a snapshot without madeBy still parses");
    });

    await check("documents are references only", () => {
      assert.deepEqual(snap.documents, [{ id: docId, kind: "upload", status: "failed", createdAt: snap.documents[0].createdAt }]);
    });

    await check("a snapshot needs an existing household id", async () => {
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
      assert.match(tool.description, new RegExp(`${SNAPSHOT_TOOL_WINDOW} latest`));
      const ctx = { madeBy: "mcp" as const, db, householdId: a, appUrl: new URL("http://127.0.0.1:3123"), state: () => Promise.reject(new Error("the snapshot reads no engine state")) };
      const out = await tool.run(ctx, {} as never);
      const parsed = HouseholdSnapshot.parse(JSON.parse(out));
      assert.equal(parsed.household.id, a);
      assert.ok(!("events" in parsed));
      assert.equal(parsed.pots.length, 2);
      for (const value of Object.values(SECRET_VALUES)) assert.ok(!out.includes(value));
      assert.ok(SNAPSHOT_TOOL_WINDOW >= 50 && SNAPSHOT_TOOL_WINDOW <= 200);
    });

    await check("D59 and D69: memory, canvases, turns and spaces are in the export only; the version 1 fields are unchanged", async () => {
      const by = { madeBy: "form" as const };
      const mem = await addMemory(db, a, { kind: "fact", text: "Rent goes up in April (snapshot test)" }, by);
      const recipe = { version: 1, title: "Cash today", blocks: [{ type: "number", label: "Cash today", query: { q: "cash" } }] };
      const pin = await pinCanvas(db, a, { title: "Cash today", recipe }, by);
      const turnId = randomUUID(), conv = randomUUID();
      await saveTurn(db, a, { id: turnId, conversationId: conv, question: "Am I OK this month? (snapshot test)", kind: "answer", reply: "Yes.", choices: null, recipe: null, sources: [{ label: "Home", href: "/" }] });

      const record = await loadHouseholdSnapshot(db, a, { events: false });
      const withEvents = await loadHouseholdSnapshot(db, a, { events: true });
      const exported = await loadHouseholdSnapshot(db, a, { events: true, stored: true });
      for (const key of ["memory", "canvases", "journal", "spaces"]) { assert.ok(!(key in record) && !(key in withEvents), `${key} is not in the record`); assert.ok(key in exported, `${key} is in the export`); }
      assert.deepEqual(exported.memory!.map(m => m.id), [mem.id]);
      assert.deepEqual(MemoryItem.parse(exported.memory![0]), exported.memory![0]);
      assert.deepEqual(exported.canvases!.map(c => [c.id, c.title, c.position]), [[pin.id, "Cash today", 0]]);
      assert.deepEqual(exported.journal!.map(t => t.id), [turnId]);
      assert.deepEqual(ConversationTurn.parse(exported.journal![0]), exported.journal![0]);
      // The export minus the stored kinds is the events build, apart from the moment it was made.
      const { memory, canvases, journal, spaces, ...rest } = exported; void memory; void canvases; void journal; void spaces;
      assert.deepEqual({ ...rest, generatedAt: "" }, { ...withEvents, generatedAt: "" });
      const text = JSON.stringify(exported);
      assert.deepEqual(HouseholdSnapshot.parse(JSON.parse(text)), exported);
      assert.throws(() => HouseholdSnapshot.parse({ ...exported, memory: [{ ...exported.memory![0], extra: 1 }] }));
      assert.throws(() => HouseholdSnapshot.parse({ ...exported, canvases: [{ ...exported.canvases![0], madeBy: "form" }] }));
    });

    await check("the timeline tool's items parse against CashFlowEvent (version 1), in and out follow the sign", async () => {
      const tool = tools.find(t => t.name === "timeline")!;
      const ctx = { madeBy: "mcp" as const, db, householdId: a, appUrl: new URL("http://127.0.0.1:3123"), state: () => loadMoneyState(db, a, DEMO_DATE) };
      for (const scenario of ["as_usual", "late"] as const) {
        const out = JSON.parse(await tool.run(ctx, { scenario } as never));
        assert.ok(out.events.length > 3);
        for (const event of out.events) {
          const parsed = CashFlowEvent.parse(event);
          assert.equal(parsed.direction, parsed.amountMinor < 0 ? "out" : "in");
        }
        assert.ok(out.events.some((e: { direction: string }) => e.direction === "in") && out.events.some((e: { direction: string }) => e.direction === "out"));
      }
      assert.equal(CashFlowEvent.safeParse({ date: "2026-11-27", label: "Rent", kind: "bill", amountMinor: -82000, currency: "JPY", direction: "out", extra: 1 }).success, false);
      assert.equal(CashFlowEvent.safeParse({ date: "2026-11-27", label: "Rent", kind: "bill", amountMinor: -820.5, currency: "JPY", direction: "out" }).success, false);
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
