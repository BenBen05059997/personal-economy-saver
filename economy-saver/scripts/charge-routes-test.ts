// D62 inputs: /api/charges with the original amount and currency (both or neither, a blank dropped, the card's own currency refused)
// and the card's foreign transaction fee through /api/settings (2.2 -> 220 basis points, empty clears, over 10 refused, absent leaves it).
// Route handlers are called directly with a hand-built form Request over PGlite (same stand-ins as ask-routes-test.ts). Fictional data only.
// Run from the project root: npx tsx --tsconfig ./tsconfig.json scripts/charge-routes-test.ts
import assert from "node:assert/strict";
import Module from "node:module";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { and, eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { seedBen } from "@/db/seed";

type Handler = (request: Request) => Promise<Response>;
const ORIGIN = "http://127.0.0.1:3123";

async function main() {
  const pg = new PGlite({ extensions: { pg_trgm } });
  const db = drizzle(pg, { schema });
  let passed = 0;
  const ok = (name: string) => { passed++; console.log(`✓ ${name}`); };
  let cookie: string | null = null;
  const loader = Module as unknown as { _load: (request: string, parent: unknown, isMain: boolean) => unknown; _resolveFilename: (request: string, parent: unknown, isMain: boolean) => string };
  const realLoad = loader._load;
  loader._load = function (request, parent, isMain) {
    if (request === "next/headers") return { cookies: async () => ({ getAll: () => (cookie ? [{ name: "household", value: cookie }] : []), get: (name: string) => (name === "household" && cookie ? { name, value: cookie } : undefined) }) };
    const resolved = (() => { try { return loader._resolveFilename(request, parent, isMain); } catch { return ""; } })();
    if (resolved.endsWith("/src/db/client.ts")) return { db: () => db, MissingDatabaseUrl: class extends Error {} };
    return realLoad.call(this, request, parent, isMain);
  };
  try {
    await migrate(db, { migrationsFolder: "./drizzle" });
    const hid = await seedBen(db, { isDemo: true });
    cookie = hid;
    process.env.APP_URL = ORIGIN;
    const charges = (await import("@/app/api/charges/route")).POST as Handler;
    const settings = (await import("@/app/api/settings/route")).POST as Handler;
    const form = (path: string, fields: Record<string, string>) => new Request(`${ORIGIN}${path}`, { method: "POST", body: new URLSearchParams(fields), headers: { origin: ORIGIN, host: "127.0.0.1:3123" } });
    const [card] = await db.select().from(schema.cards).where(eq(schema.cards.householdId, hid)).orderBy(schema.cards.createdAt);
    const today = "2026-11-14";
    const charge = (over: Record<string, string> = {}) => ({ id: crypto.randomUUID(), cardId: card.id, merchant: "Fontly Cloud", amount: "3710", date: today, category: "other", businessShare: "personal", ...over });
    const row = async (id: string) => (await db.select().from(schema.charges).where(and(eq(schema.charges.householdId, hid), eq(schema.charges.id, id))))[0];

    const plain = charge();
    const first = await charges(form("/api/charges", { ...plain, originalAmount: "", originalCurrency: "USD" }));
    assert.ok(first.status < 400, `saved (${first.status})`);
    const saved = await row(plain.id);
    assert.ok(saved && saved.originalAmountMinor === null && saved.originalCurrency === null, "a blank original amount is dropped with its currency");
    ok("/api/charges: a blank original amount saves a plain charge");

    const foreign = charge({ originalAmount: "24.00", originalCurrency: "USD" });
    const done = await charges(form("/api/charges", foreign));
    assert.ok(done.status < 400, `saved (${done.status})`);
    const f = await row(foreign.id);
    assert.equal(f.amountMinor, 3710); assert.equal(f.originalAmountMinor, 2400); assert.equal(f.originalCurrency, "USD");
    ok("/api/charges: $24.00 billed ¥3,710 is saved with the original amount and currency");

    const noCurrency = await charges(form("/api/charges", charge({ originalAmount: "24.00" })));
    assert.equal(noCurrency.status, 400);
    assert.match(await noCurrency.text(), /needs both the amount and the currency/);
    const same = await charges(form("/api/charges", charge({ originalAmount: "3710", originalCurrency: "JPY" })));
    assert.equal(same.status, 400);
    assert.match(await same.text(), /differ from the card/);
    assert.equal((await charges(form("/api/charges", charge({ originalAmount: "24", originalCurrency: "EUR" })))).status, 400);
    ok("/api/charges: an amount with no currency, the card's own currency and an unknown currency are refused");

    const fee = async (value: string | undefined) => settings(form("/api/settings", { kind: "card", id: card.id, label: card.label, memberId: card.memberId ?? "", closingDay: String(card.closingDay), dueDay: String(card.dueDay), limit: "", ...(value === undefined ? {} : { foreignFee: value }) }));
    const bp = async () => (await db.select({ bp: schema.cards.foreignFeeBp }).from(schema.cards).where(eq(schema.cards.id, card.id)))[0].bp;
    assert.equal((await fee("2.2")).status, 200); assert.equal(await bp(), 220);
    assert.equal((await fee("2.25")).status, 200); assert.equal(await bp(), 225);
    assert.equal((await fee(undefined)).status, 200); assert.equal(await bp(), 225, "absent leaves it");
    for (const bad of ["11", "10.5", "-1", "2.234", "abc"]) { const r = await fee(bad); assert.equal(r.status, 400, bad); assert.match(await r.text(), /0 to 10/); }
    assert.equal(await bp(), 225, "a refusal changes nothing");
    assert.equal((await fee("10")).status, 200); assert.equal(await bp(), 1000);
    assert.equal((await fee("0")).status, 200); assert.equal(await bp(), 0);
    assert.equal((await fee("")).status, 200); assert.equal(await bp(), null, "empty clears");
    ok("/api/settings card: 2.2 is 220 basis points, 0 to 10 accepted, over 10 or more than two decimals refused, empty clears, absent leaves it");
  } finally {
    loader._load = realLoad;
    await pg.close();
  }
  console.log(`\n${passed} checks passed`);
}

main().catch(error => { console.error(error); process.exit(1); });
