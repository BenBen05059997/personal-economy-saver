// D62 inputs: /api/charges with the original amount and currency (both or neither, a blank dropped, the card's own currency refused)
// and the card's foreign transaction fee through /api/settings (2.2 -> 220 basis points, empty clears, over 10 refused, absent leaves it).
// SEC-002 checks writes and removals against a second household's ids.
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
import { createFamilyLink } from "@/db/family-links";

type Handler = (request: Request) => Promise<Response>;
const ORIGIN = "http://127.0.0.1:3123";

import { demoCookies } from "./demo-cookie";
async function main() {
  const pg = new PGlite({ extensions: { pg_trgm } });
  const db = drizzle(pg, { schema });
  const tokenFor = demoCookies(db); // the Try it cookie is a token (D34)
  let passed = 0;
  const ok = (name: string) => { passed++; console.log(`✓ ${name}`); };
  let cookie: string | null = null;
  const loader = Module as unknown as { _load: (request: string, parent: unknown, isMain: boolean) => unknown; _resolveFilename: (request: string, parent: unknown, isMain: boolean) => string };
  const realLoad = loader._load;
  loader._load = function (request, parent, isMain) {
    if (request === "next/headers") return { cookies: async () => { const value = await tokenFor(cookie); return { getAll: () => (value ? [{ name: "household", value }] : []), get: (n: string) => (n === "household" && value ? { name: n, value } : undefined) }; } };
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
    const bills = (await import("@/app/api/bills/route")).POST as Handler;
    const clients = (await import("@/app/api/clients/route")).POST as Handler;
    const remove = (await import("@/app/api/remove/route")).POST as Handler;
    const familyLinks = (await import("@/app/api/family-links/route")).POST as Handler;
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

    const other = await seedBen(db, { isDemo: true, name: "Fictional second household" });
    const [{ id: otherBill }] = await db.select({ id: schema.bills.id }).from(schema.bills).where(eq(schema.bills.householdId, other)).limit(1);
    const [{ id: otherCard }] = await db.select({ id: schema.cards.id }).from(schema.cards).where(eq(schema.cards.householdId, other)).limit(1);
    const [{ id: otherCharge }] = await db.select({ id: schema.charges.id }).from(schema.charges).where(eq(schema.charges.householdId, other)).limit(1);
    const [{ id: otherClient }] = await db.select({ id: schema.clients.id }).from(schema.clients).where(eq(schema.clients.householdId, other)).limit(1);
    const { info: otherLink } = await createFamilyLink(db, other);
    const records = () => Promise.all([
      db.select().from(schema.bills).orderBy(schema.bills.id),
      db.select().from(schema.cards).orderBy(schema.cards.id),
      db.select().from(schema.charges).orderBy(schema.charges.id),
      db.select().from(schema.clients).orderBy(schema.clients.id),
      db.select().from(schema.familyLinks).orderBy(schema.familyLinks.id),
      db.select().from(schema.events).orderBy(schema.events.id),
    ]);
    const before = await records();
    async function responseMatches(response: Response, status: number, message: string) {
      assert.equal(response.status, status, message);
      assert.equal(await response.text(), message);
    }

    await responseMatches(await charges(form("/api/charges", charge({ id: otherCharge }))), 400, "Choose a charge of this household");
    await responseMatches(await clients(form("/api/clients", { id: otherClient, name: "Fictional client", email: "client@example.test", termsDays: "14" })), 400, "Choose a client of this household");
    await responseMatches(await remove(form("/api/remove", { kind: "bill", id: otherBill })), 400, "Choose a bill of this household");
    await responseMatches(await remove(form("/api/remove", { kind: "charge", id: otherCharge })), 400, "Choose a charge of this household");
    await responseMatches(await bills(form("/api/bills", {
      kind: "edit", id: otherBill, biller: "Fictional bill", amount: "100", due: today, category: "other", businessShare: "personal",
    })), 400, "Choose a bill of this household");
    await responseMatches(await settings(form("/api/settings", {
      kind: "card", id: otherCard, label: "Fictional card", memberId: "", closingDay: "15", dueDay: "5", limit: "",
    })), 400, "Card no longer exists");
    await responseMatches(await familyLinks(form("/api/family-links", { kind: "stop", id: otherLink.id })), 200, "That link has already ended.");
    assert.deepEqual(await records(), before, "foreign ids leave both households’ records and Activity alone");
    ok("SEC-002: foreign charge and client ids, bill and card edits, and removal or stop requests return the expected response without changing either household's records");

    const removeOwnCharge = () => remove(form("/api/remove", { kind: "charge", id: plain.id }));
    assert.equal((await removeOwnCharge()).status, 303);
    await responseMatches(await removeOwnCharge(), 400, "Choose a charge of this household");
    assert.equal((await db.select().from(schema.events).where(and(eq(schema.events.householdId, hid), eq(schema.events.kind, "charge_removed"), eq(schema.events.refId, plain.id)))).length, 1);
    ok("/api/remove charge: the first request redirects and records one event, the second is refused");
  } finally {
    loader._load = realLoad;
    await pg.close();
  }
  console.log(`\n${passed} checks passed`);
}

main().catch(error => { console.error(error); process.exit(1); });
