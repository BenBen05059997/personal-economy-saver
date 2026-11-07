// 27E: limits, budgets, storage. Per-address limits before a household exists, the app-wide daily AI budget, Storage bytes per
// household and their cap, retention of raw files, and the small stored webhook payload. PGlite, no credentials; Storage and the
// network are answered locally. Fictional data only. Run from the project root:
// npx tsx --tsconfig ./tsconfig.json scripts/limits-test.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "@/db/schema";
import { AiKeyError, aiConnection } from "@/db/ai-key";
import { runDaily } from "@/db/daily";
import { deleteDocument } from "@/db/data-kinds";
import { DEMO_STORAGE_CAP_BYTES, RAW_FILE_RETENTION_DAYS, STORAGE_CAP_BYTES, removeExpiredFiles, requireStorageRoom, storedBytes } from "@/db/document-cleanup";
import type { Db } from "@/db/household";
import { ClientIpError, TRY_PER_HOUR, clientIp, consumeIpRequest, hashIp, pruneIpBuckets } from "@/db/rate-limit";
import { storeDocument } from "@/db/reader-job";
import { seedBen } from "@/db/seed";
import { applyVerifiedDelivery, storedPayload } from "@/lib/events";
import { missingAskSetting } from "@/lib/agent/availability";
import { ReaderError } from "@/lib/reader/settings";

const MiB = 1024 * 1024;

async function main() {
  const pg = new PGlite();
  const db = drizzle(pg, { schema });
  const store = db as unknown as Db;
  let passed = 0;
  async function check(name: string, run: () => Promise<void>) { await run(); passed++; console.log(`✓ ${name}`); }
  const savedEnv = { ...process.env };
  const savedFetch = globalThis.fetch;
  await migrate(db, { migrationsFolder: "./drizzle" });
  try {
    // ---------------------------------------------------------------- 1. per-address limits
    await check("clientIp reads the header named by CLIENT_IP_HEADER, first entry of a list, and refuses when the setting or the header is missing", async () => {
      delete process.env.CLIENT_IP_HEADER;
      assert.throws(() => clientIp(new Request("http://x.test/", { headers: { "x-forwarded-for": "203.0.113.7" } })), (e: unknown) => e instanceof ClientIpError && e.status === 503 && /CLIENT_IP_HEADER is not set/.test(e.message));
      process.env.CLIENT_IP_HEADER = "CF-Connecting-IP";
      assert.equal(clientIp(new Request("http://x.test/", { headers: { "cf-connecting-ip": "203.0.113.7" } })), "203.0.113.7");
      assert.throws(() => clientIp(new Request("http://x.test/")), (e: unknown) => e instanceof ClientIpError && e.status === 400 && /cf-connecting-ip/.test(e.message));
      process.env.CLIENT_IP_HEADER = "x-forwarded-for";
      assert.equal(clientIp(new Request("http://x.test/", { headers: { "x-forwarded-for": "203.0.113.9, 10.0.0.1" } })), "203.0.113.9");
    });

    await check("both doors (Try it and Start with my numbers) share the purpose \"try\" and TRY_PER_HOUR (30): the thirty-first from one address is refused", async () => {
      assert.equal(TRY_PER_HOUR, 30);
      for (let i = 0; i < TRY_PER_HOUR; i++) assert.equal(await consumeIpRequest(store, "203.0.113.50", "try", TRY_PER_HOUR), true);
      assert.equal(await consumeIpRequest(store, "203.0.113.50", "try", TRY_PER_HOUR), false);
    });

    await check("consumeIpRequest: the limit holds per address and purpose, the address is stored only as a SHA-256 hash, a new window starts again", async () => {
      for (let i = 0; i < 10; i++) assert.equal(await consumeIpRequest(store, "203.0.113.20", "try", 10), true, `request ${i + 1}`);
      assert.equal(await consumeIpRequest(store, "203.0.113.20", "try", 10), false, "the eleventh is refused");
      assert.equal(await consumeIpRequest(store, "203.0.113.20", "try", 10), false, "and stays refused");
      assert.equal(await consumeIpRequest(store, "203.0.113.21", "try", 10), true, "another address is separate");
      assert.equal(await consumeIpRequest(store, "203.0.113.20", "magic-link", 5), true, "another purpose is separate");
      for (let i = 0; i < 4; i++) await consumeIpRequest(store, "203.0.113.20", "magic-link", 5);
      assert.equal(await consumeIpRequest(store, "203.0.113.20", "magic-link", 5), false, "five links an hour");
      const rows = await db.select().from(schema.ipBuckets);
      assert.ok(rows.length >= 3 && rows.every(r => /^[0-9a-f]{64}$/.test(r.ipHash)));
      assert.ok(!JSON.stringify(rows).includes("203.0.113"), "no raw address is stored");
      const h20 = await hashIp("203.0.113.20");
      assert.equal(rows.find(r => r.purpose === "try" && r.ipHash === h20)?.count, 10);
      await db.update(schema.ipBuckets).set({ window: sql`now() - interval '2 hours'` });
      assert.equal(await consumeIpRequest(store, "203.0.113.20", "try", 10), true, "the next window counts from one again");
    });

    await check("pruneIpBuckets removes windows more than a day old and keeps recent ones", async () => {
      await db.update(schema.ipBuckets).set({ window: sql`now() - interval '3 days'` }).where(eq(schema.ipBuckets.purpose, "magic-link"));
      const before = (await db.select().from(schema.ipBuckets)).length;
      const gone = await pruneIpBuckets(store);
      const after = await db.select().from(schema.ipBuckets);
      assert.ok(gone >= 1 && after.length === before - gone && after.every(r => r.purpose === "try"));
    });

    // ---------------------------------------------------------------- 2. the app-wide AI budget
    await check("AI_GLOBAL_DAILY_LIMIT: required, counts server-key calls across households, refuses past the limit with a sentence, and leaves the household's own count alone", async () => {
      Object.assign(process.env, { AI_PROTOCOL: "anthropic", AI_API_KEY: "fictional-key", AI_TEXT_MODEL: "fictional-model", AI_DAILY_LIMIT: "100" });
      delete process.env.AI_GLOBAL_DAILY_LIMIT;
      const a = await seedBen(db), b = await seedBen(db);
      await assert.rejects(aiConnection(store, a, "text"), (e: unknown) => e instanceof AiKeyError && e.message === "AI_GLOBAL_DAILY_LIMIT is not set");
      assert.equal(missingAskSetting(false), "AI_GLOBAL_DAILY_LIMIT");
      process.env.AI_GLOBAL_DAILY_LIMIT = "zero";
      await assert.rejects(aiConnection(store, a, "text"), /AI_GLOBAL_DAILY_LIMIT must be a positive integer/);
      process.env.AI_GLOBAL_DAILY_LIMIT = "3";
      assert.equal(missingAskSetting(false), null);
      await aiConnection(store, a, "text"); await aiConnection(store, b, "text"); await aiConnection(store, a, "text");
      await assert.rejects(aiConnection(store, b, "text"), (e: unknown) => e instanceof AiKeyError && /all of today's AI allowance/.test(e.message));
      const [rowB] = await db.select({ n: schema.households.aiReadsToday }).from(schema.households).where(eq(schema.households.id, b));
      assert.equal(rowB.n, 1, "the refused call did not spend B's own allowance");
      const [usage] = await db.select().from(schema.aiGlobalUsage);
      assert.equal(usage.count, 3);
      // a household's own model is not counted and is not stopped
      await db.update(schema.households).set({ aiProtocol: "openai", aiBaseUrl: "https://models.example/v1", aiProvider: "custom", aiTextModel: "own", aiDocumentModel: "own" }).where(eq(schema.households.id, b));
      const own = await aiConnection(store, b, "text");
      assert.equal(own.own, true);
      assert.equal((await db.select().from(schema.aiGlobalUsage))[0].count, 3);
      // a new day starts at zero
      await db.update(schema.aiGlobalUsage).set({ day: sql`(now() at time zone 'utc')::date - 1` });
      await db.update(schema.households).set({ aiProtocol: null, aiBaseUrl: null, aiProvider: null, aiTextModel: null, aiDocumentModel: null }).where(eq(schema.households.id, b));
      await aiConnection(store, b, "text");
      assert.equal((await db.select().from(schema.aiGlobalUsage)).length, 2);
    });

    // ---------------------------------------------------------------- 3. Storage bytes and the cap
    const names = { SUPABASE_URL: "https://storage.example", SUPABASE_SERVICE_ROLE_KEY: "fictional-test-value", SUPABASE_DOCUMENT_BUCKET: "fictional-documents" };
    Object.assign(process.env, names);
    const removedByStorage: string[] = [];
    globalThis.fetch = async (input, init) => {
      const request = new Request(input, init);
      if (request.url.includes("/bucket/")) return Response.json({ name: "fictional-documents", public: false });
      if (request.method === "POST") { await request.blob(); return Response.json({ Key: "ok" }); }
      if (request.method === "DELETE") { removedByStorage.push(...(await request.json() as { prefixes: string[] }).prefixes); return Response.json([]); }
      throw new Error("Unexpected storage operation " + request.method + " " + request.url);
    };
    const pdf = (label: string, size = 100) => new TextEncoder().encode("%PDF-1.7 " + label + " ".repeat(size)).buffer as ArrayBuffer;
    const addDoc = async (hid: string, bytes: number, extra: Partial<typeof schema.documents.$inferInsert> = {}) => {
      const [d] = await db.insert(schema.documents).values({ householdId: hid, kind: "upload", storagePath: `${hid}/${crypto.randomUUID()}`, mime: "application/pdf", status: "read", bytes, ...extra }).returning();
      return d;
    };
    const addReading = (hid: string, documentId: string, status: "to_check" | "confirmed" | "rejected", confirmedAt: Date | null) => {
      const extracted = { kind: "charge", name: "Fictional kiosk", date: "2026-10-01", amountMinor: 500, currency: "JPY", category: "food", businessBp: 0, cardId: null };
      return db.insert(schema.readings).values({ householdId: hid, documentId, extracted: { original: extracted, proposed: extracted }, target: "charge", status, confirmedAt });
    };

    await check("storage cap: 200 MiB for a household, 20 MiB for Try it, counted over files still stored, refused with words a person reads", async () => {
      assert.equal(STORAGE_CAP_BYTES, 200 * MiB); assert.equal(DEMO_STORAGE_CAP_BYTES, 20 * MiB);
      const real = await seedBen(db), demo = await seedBen(db, { isDemo: true });
      await addDoc(real, 150 * MiB); await addDoc(demo, 19 * MiB);
      assert.equal(await storedBytes(store, real), 150 * MiB);
      await requireStorageRoom(store, real, 50 * MiB);
      await assert.rejects(requireStorageRoom(store, real, 50 * MiB + 1), (e: unknown) => e instanceof ReaderError && /full \(200 MB\)/.test(e.message) && /Delete some/.test(e.message));
      await requireStorageRoom(store, demo, 1 * MiB);
      await assert.rejects(requireStorageRoom(store, demo, 1 * MiB + 1), (e: unknown) => e instanceof ReaderError && /full \(20 MB\)/.test(e.message));
      await addDoc(real, 40 * MiB, { fileRemovedAt: new Date() });
      assert.equal(await storedBytes(store, real), 150 * MiB, "a removed file is not counted");
    });

    await check("storeDocument (the path /api/upload, Ask's Attach a bill and forwarded email share) records the bytes and refuses past the cap before touching Storage", async () => {
      const demo = await seedBen(db, { isDemo: true });
      await addDoc(demo, 20 * MiB - 1000);
      const file = pdf("fits", 100);
      const id = await storeDocument(store, demo, "upload", "application/pdf", file);
      const [row] = await db.select().from(schema.documents).where(eq(schema.documents.id, id));
      assert.equal(row.bytes, file.byteLength);
      assert.equal(await storeDocument(store, demo, "upload", "application/pdf", file), id, "the same file again is the same document, not counted twice");
      await assert.rejects(storeDocument(store, demo, "upload", "application/pdf", pdf("too much", 2000)), /stored documents are full/);
      assert.equal((await db.select().from(schema.documents).where(eq(schema.documents.householdId, demo))).length, 2, "the refused file left no row");
    });

    // ---------------------------------------------------------------- 4. retention
    await check("retention: a file goes RAW_FILE_RETENTION_DAYS after its last reading was confirmed or dismissed; rows, readings and the document stay", async () => {
      assert.equal(RAW_FILE_RETENTION_DAYS, 30);
      const hid = await seedBen(db);
      const now = new Date("2026-11-07T00:00:00Z");
      const days = (n: number) => new Date(now.getTime() - n * 86_400_000);
      const old = await addDoc(hid, 1000); await addReading(hid, old.id, "confirmed", days(40));
      const oldRejected = await addDoc(hid, 1000); await addReading(hid, oldRejected.id, "rejected", null); await db.update(schema.readings).set({ createdAt: days(45) }).where(eq(schema.readings.documentId, oldRejected.id));
      const recent = await addDoc(hid, 1000); await addReading(hid, recent.id, "confirmed", days(5));
      const open = await addDoc(hid, 1000); await addReading(hid, open.id, "confirmed", days(60)); await addReading(hid, open.id, "to_check", null);
      const noReadings = await addDoc(hid, 1000);
      const queued = await addDoc(hid, 1000, { status: "queued" }); await addReading(hid, queued.id, "confirmed", days(60));
      const sent: string[] = [];
      const fake = { remove: async (paths: string[]) => { sent.push(...paths); return { error: null }; } };
      const before = await storedBytes(store, hid);
      assert.equal(await removeExpiredFiles(store, hid, now, fake), 2);
      assert.deepEqual(sent.sort(), [old.storagePath, oldRejected.storagePath].sort());
      const rows = new Map((await db.select().from(schema.documents).where(eq(schema.documents.householdId, hid))).map(r => [r.id, r]));
      assert.ok(rows.get(old.id)!.fileRemovedAt && rows.get(oldRejected.id)!.fileRemovedAt);
      for (const kept of [recent, open, noReadings, queued]) assert.equal(rows.get(kept.id)!.fileRemovedAt, null);
      assert.equal((await db.select().from(schema.readings).where(eq(schema.readings.documentId, old.id))).length, 1, "the reading stays");
      assert.equal(await storedBytes(store, hid), before - 2000);
      assert.equal(await removeExpiredFiles(store, hid, now, fake), 0, "nothing more the second time");
      // the recent one goes once it is past the line; the others stay held back by their state
      assert.equal(await removeExpiredFiles(store, hid, new Date(now.getTime() + 26 * 86_400_000), fake), 1);
      const stuck = await addDoc(hid, 10); await addReading(hid, stuck.id, "confirmed", days(90));
      await assert.rejects(removeExpiredFiles(store, hid, new Date("2027-06-01T00:00:00Z"), { remove: async () => ({ error: new Error("down") }) }), /Could not remove old documents/);
      const hidB = await seedBen(db);
      assert.equal(await removeExpiredFiles(store, hidB, now, fake), 0);
    });

    await check("the daily job removes expired files through Storage, prunes old windows, and keeps the reminders when nothing is due", async () => {
      const hid = await seedBen(db, { isDemo: true });
      const d = await addDoc(hid, 1000); await addReading(hid, d.id, "confirmed", new Date("2025-01-01T00:00:00Z"));
      await db.insert(schema.ipBuckets).values({ ipHash: "0".repeat(64), purpose: "try", window: sql`now() - interval '2 days'` as unknown as Date, count: 1 });
      await db.insert(schema.aiGlobalUsage).values({ day: "2020-01-01", count: 4 });
      removedByStorage.length = 0;
      assert.deepEqual(await runDaily(store, hid, new Date()), { ok: true });
      assert.deepEqual(removedByStorage, [d.storagePath]);
      assert.ok((await db.select().from(schema.documents).where(eq(schema.documents.id, d.id)))[0].fileRemovedAt);
      assert.equal((await db.select().from(schema.ipBuckets).where(eq(schema.ipBuckets.ipHash, "0".repeat(64)))).length, 0);
      assert.equal((await db.select().from(schema.aiGlobalUsage).where(eq(schema.aiGlobalUsage.day, "2020-01-01"))).length, 0);
    });

    await check("per-document delete exists (deleteDocument): removes the file, keeps a bill's row and drops its link", async () => {
      const hid = await seedBen(db);
      const d = await addDoc(hid, 500);
      const [bill] = await db.insert(schema.bills).values({ householdId: hid, biller: "Fictional Water", amountMinor: 3000, currency: "JPY", dueOn: "2026-12-01", category: "utilities", documentId: d.id } as typeof schema.bills.$inferInsert).returning();
      const sent: string[] = [];
      assert.equal(await deleteDocument(store, hid, d.id, { madeBy: "form" }, { remove: async p => { sent.push(...p); return { error: null }; } }), true);
      assert.deepEqual(sent, [d.storagePath]);
      const [kept] = await db.select().from(schema.bills).where(eq(schema.bills.id, bill.id));
      assert.equal(kept.documentId, null);
    });

    // ---------------------------------------------------------------- 5. the webhook payload
    await check("a delivery keeps only the invoice id and time of PayPal's event, never the whole event, and the migration trims old rows the same way", async () => {
      const event = { id: "WH-LIMITS-1", event_type: "PAYMENT.SALE.COMPLETED", create_time: "2026-11-07T01:00:00Z", resource_type: "sale", summary: "Fictional payer paid 12.00 USD",
        resource: { id: "SALE-1", payer: { email: "fictional.payer@example.test" }, amount: { total: "12.00" } } };
      assert.deepEqual(storedPayload(event, undefined), { invoiceId: undefined, createdAt: "2026-11-07T01:00:00Z" });
      await applyVerifiedDelivery(store, event);
      const [row] = await db.select().from(schema.webhookDeliveries).where(eq(schema.webhookDeliveries.paypalEventId, "WH-LIMITS-1"));
      assert.deepEqual(Object.keys(row.payload as object).sort(), ["createdAt"], "undefined is dropped by JSON; nothing else is kept");
      assert.ok(!JSON.stringify(row.payload).includes("fictional.payer"));
      await db.insert(schema.webhookDeliveries).values({ paypalEventId: "WH-OLD-1", eventType: "INVOICING.INVOICE.PAID", verified: true,
        payload: { id: "WH-OLD-1", summary: "Fictional", resource: { id: "INV2-X", payer: "Fictional" }, invoiceId: "INV2-X", createdAt: "2026-10-01T00:00:00Z" } });
      const sqlText = readFileSync("drizzle/0025_sturdy_thunderball.sql", "utf8").split("--> statement-breakpoint").map(t => t.trim()).filter(t => t.startsWith("UPDATE"))[0];
      assert.ok(sqlText);
      await pg.exec(sqlText);
      const [old] = await db.select().from(schema.webhookDeliveries).where(eq(schema.webhookDeliveries.paypalEventId, "WH-OLD-1"));
      assert.deepEqual(old.payload, { invoiceId: "INV2-X", createdAt: "2026-10-01T00:00:00Z" });
    });
    console.log(`Limits checks passed (${passed}).`);
  } finally {
    globalThis.fetch = savedFetch;
    for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
    Object.assign(process.env, savedEnv);
    await pg.close();
  }
}

main().catch(error => { console.error(error); process.exit(1); });
