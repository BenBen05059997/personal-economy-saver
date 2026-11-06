// Tenant isolation: two households in one database, and proof that nothing in src/db lets one see or change the other's rows.
// Reads: every read function (and the agent's read tools) for one household never shows the other's ids, names, secrets or numbers.
// Writes: every function that changes or removes a row by id, called with one household's id and the other's row id, refuses
// or changes nothing (the other household's rows are compared whole, before and after). The last check fails when a src/db
// function is in neither list below, so a new function cannot skip isolation silently. Fictional data only; PGlite, no credentials.
// Run from the project root: npx tsx --tsconfig ./tsconfig.json scripts/isolation-test.ts
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "@/db/schema";
import * as account from "@/db/account";
import * as aiKeys from "@/db/ai-key";
import * as approval from "@/db/approval";
import * as bankBalance from "@/db/bank-balance";
import * as billsMod from "@/db/bills";
import * as chargesMod from "@/db/charges";
import * as clientsMod from "@/db/clients";
import * as confirm from "@/db/confirm";
import * as daily from "@/db/daily";
import * as demo from "@/db/demo";
import * as documentCleanup from "@/db/document-cleanup";
import * as eventFeed from "@/db/event-feed";
import * as familyLinksMod from "@/db/family-links";
import * as household from "@/db/household";
import * as importChargesMod from "@/db/import-charges"; // Stage 17 import
import * as invoiceDraft from "@/db/invoice-draft";
import * as invoicePaid from "@/db/invoice-paid";
import * as mcpTokens from "@/db/mcp-tokens";
import * as paypalImport from "@/db/paypal-import";
import * as paypalRefresh from "@/db/paypal-refresh";
import * as people from "@/db/people";
import * as potsMod from "@/db/pots";
import * as rateLimit from "@/db/rate-limit";
import * as readerInbox from "@/db/reader-inbox";
import * as readerJob from "@/db/reader-job";
import * as readings from "@/db/readings";
import * as referenceRate from "@/db/reference-rate";
import * as runwayEvents from "@/db/runway-events";
import * as settingsMod from "@/db/settings";
import * as settle from "@/db/settle";
import * as snapshotMod from "@/db/snapshot";
import * as statementCharge from "@/db/statement-charge";
import * as spendingMod from "@/db/spending"; // Stage 17 spending
import * as workspace from "@/db/workspace";
import { billEditInput, billInput } from "@/db/bills";
import { chargeInput } from "@/db/charges";
import { DEMO_DATE } from "@/db/clock";
import type { Db } from "@/db/household";
import { ImportRefused } from "@/db/paypal-import";
import { ApprovalError } from "@/db/approval";
import { AiKeyError } from "@/db/ai-key";
import { potInput } from "@/db/pots";
import { seedBen } from "@/db/seed";
import { tools, type ToolContext } from "@/lib/agent/tools";

// ------------------------------------------------------------------ what the guard compares against
// Every exported function in src/db, in exactly one of the two lists. `covered` names are also checked to have been
// called through the tracked module object F below, so a name cannot sit here without a test behind it.
const covered = [
  // account.ts
  "householdClock", "householdDate", "accountHousehold", "createHousehold", "finishSetup", "deleteOwnedHousehold",
  // ai-key.ts
  "aiKey", "saveHouseholdKey", "deleteHouseholdKey",
  // approval.ts
  "invoiceReview", "approveInvoice",
  // bank-balance.ts, bills.ts, charges.ts, clients.ts, confirm.ts
  "setBankBalance", "confirmBalanceUpdate", "insertBill", "removeBill", "updateBill", "insertCharge", "removeCharge", "insertClient", "confirmPending",
  // daily.ts, demo.ts, document-cleanup.ts, event-feed.ts
  "runDaily", "findDemoHousehold", "tryItKind", "resetDemoHousehold", "deleteDemoHousehold", "sweepDemoHouseholds", "removeHouseholdDocuments", "eventFeed",
  // household.ts
  "householdOwnerName", "usdRate", "usdRateMicro", "loadSplitState", "loadMoneyState", "recordEvent", "listEvents", "unreadCount", "markRead",
  "recordWebhookDelivery", "deleteHousehold",
  // family-links.ts
  "listFamilyLinks", "createFamilyLink", "stopFamilyLink", "resolveFamilyLink", "loadFamilyView",
  // invoice-draft.ts, invoice-paid.ts, mcp-tokens.ts
  "saveInvoiceDraft", "markPaidOutside", "listMcpTokens", "issueMcpToken", "authenticateMcpToken", "revokeMcpToken",
  // paypal-import.ts, paypal-refresh.ts
  "canImportPayPal", "importPayPalHistory", "refreshPayPal",
  // people.ts, pots.ts
  "memberCount", "memberByName", "addMember", "savePeople", "removeMember", "savePot", "confirmPot", "removePot", "fillPots",
  // rate-limit.ts, reader-inbox.ts, reader-job.ts, readings.ts, reference-rate.ts
  "consumeRequest", "readerInbox", "readDocument", "proposeReadings", "reviewReading", "storeReferenceRate",
  // runway-events.ts, settings.ts, settle.ts, snapshot.ts, statement-charge.ts, workspace.ts
  "lockRunway", "beginMoneyChange", "observeRunway", "loadSettings", "updateSettings", "settleUp", "loadHouseholdSnapshot",
  "syncClosedStatementCharge", "unsyncClosedStatementCharge", "loadNavigationData", "loadWorkspaceData",
  // Stage 17 import: import-charges.ts
  "importCharges",
  // Stage 17 spending: spending.ts
  "loadSpending",
  // Stage 18 varies: bills.ts
  "linkToSeries", "previewLink",
  // Stage 19 missing data (D55): bills.ts
  "fillGap", "fillGapFromText",
];

const notApplicable: Record<string, string> = {
  answerQuestion: "calls Claude through the agent runner; the tools it can use are tested through tools.ts below",
  clockForHousehold: "pure date maths on a household row passed in",
  householdMoment: "pure date maths on a household row passed in",
  db: "the database client: takes no household id",
  withOwnedDatabase: "the database client: takes no household id",
  publicEvent: "pure mapper of one row passed in",
  requireHousehold: "pure check that a value is a UUID",
  paypalTotalMinor: "pure sum of balances passed in",
  linkDay: "pure date formatter", dueLabel: "pure date formatter", repeatDayFor: "pure date maths on a date passed in", checkSchedule: "pure check of a bill's dates and amount passed in; insertBill, which calls it, is covered above",
  scheduleWords: "pure formatter of a bill's schedule passed in",
  checkKnown: "pure check of the amount and date a bill is saved with, passed in; insertBill and updateBill, which call it, are covered above",
  checkAmountMinor: "pure check of an amount in minor units passed in; fillGap, which calls it, is covered below",
  toMinor: "pure money maths", fromMinor: "pure money maths", toRateMicro: "pure money maths", fromRateMicro: "pure money maths",
  convertMinor: "pure money maths", parseMinor: "pure money maths", parseAmountMinor: "pure money maths",
  parseShareBp: "pure text parser", equalShares: "pure share maths", parseFillBp: "pure text parser", percent: "pure formatter",
  demoCreationAllowed: "global count of recent demo households; returns a boolean, no rows",
  readDocumentInBackground: "opens its own connection and calls readDocument, which is tested here",
  staleBefore: "pure clock helper",
  storeDocument: "creates a document keyed by a digest that includes the household id; needs Supabase Storage",
  parseReferenceRate: "pure parser of the ECB feed", fetchReferenceRate: "network fetch of the public ECB feed; no household id",
  sandboxRead: "PayPal sandbox HTTP reader; takes no household id",
  seedBen: "creates a new household with a fresh id; touches no existing household",
};

// ------------------------------------------------------------------ helpers
type Needles = { strings: string[]; numbers: number[] };
type Outcome = { threw: boolean; error?: unknown; value?: unknown };
type Ids = {
  owner: string; aki: string; card: string; client: string; billConfirmed: string; billPending: string; charge: string; chargePending: string;
  pot: string; potPending: string; balanceConfirmed: string; balancePending: string; invoiceDraft: string; invoiceSent: string; approveKey: string;
  paypalInvoice: string; document: string; documentFailed: string; documentRead: string; reading: string; settlement: string; token: string;
  statement: string; webhookEvent: string; secret: string; user: string; familyLink: string;
};
type Tenant = {
  hid: string; tag: "A" | "B"; name: string; bankYen: number; rateMicro: number; key: string; tokenString: string; familyToken: string; ids: Ids; akiName: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SETUP = { name: "Isolation R", timeZone: "Asia/Tokyo", currency: "USD" as const, bank: "1000", card: "R card", closingDay: 25, dueDay: 10, limit: "" };

function walkStrings(value: unknown, out: Set<string>) {
  if (typeof value === "string") out.add(value);
  else if (Array.isArray(value)) for (const v of value) walkStrings(v, out);
  else if (value && typeof value === "object") for (const v of Object.values(value)) walkStrings(v, out);
}

function leaks(text: string, needles: Needles): string[] {
  const hits = needles.strings.filter(s => text.includes(s));
  for (const n of needles.numbers) if (new RegExp(`(?<![0-9])${n}(?![0-9])`).test(text)) hits.push(String(n));
  return hits;
}

async function main() {
  const pg = new PGlite();
  const db = drizzle(pg, { schema });
  const store = db as unknown as Db;
  let passed = 0;
  async function check(name: string, run: () => void | Promise<void>) { await run(); passed++; console.log(`✓ ${name}`); }

  // The module functions, tracked: F.name records that the test called it, so `covered` cannot list an untested name.
  const used = new Set<string>();
  const modules = {
    ...account, ...aiKeys, ...approval, ...bankBalance, ...billsMod, ...chargesMod, ...clientsMod, ...confirm, ...daily, ...demo, ...documentCleanup,
    ...eventFeed, ...familyLinksMod, ...household, ...invoiceDraft, ...invoicePaid, ...mcpTokens, ...paypalImport, ...paypalRefresh, ...people, ...potsMod, ...rateLimit,
    ...readerInbox, ...readerJob, ...readings, ...referenceRate, ...runwayEvents, ...settingsMod, ...settle, ...snapshotMod, ...statementCharge, ...workspace,
    ...importChargesMod, // Stage 17 import
    ...spendingMod, // Stage 17 spending
  };
  const F = new Proxy(modules, {
    get(target, key: string) {
      const value = target[key as keyof typeof target];
      if (typeof value === "function") used.add(key);
      return value;
    },
  });

  const saved = Object.fromEntries(["PAYPAL_ENVIRONMENT", "PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET", "MCP_TOKEN_KEY", "PAYPAL_BALANCE_HOUSEHOLD_ID"].map(k => [k, process.env[k]]));
  try {
    process.env.PAYPAL_ENVIRONMENT = "SANDBOX";
    process.env.PAYPAL_CLIENT_ID = "fictional-test-client";
    process.env.PAYPAL_CLIENT_SECRET = "fictional-test-secret";
    process.env.MCP_TOKEN_KEY = randomBytes(32).toString("base64url");
    delete process.env.PAYPAL_BALANCE_HOUSEHOLD_ID;

    await migrate(db, { migrationsFolder: "./drizzle" });
    // Vault's public SQL interface, represented only in this disposable database (as in settings-test).
    await pg.exec(`create schema vault;
      create table vault.secrets(id uuid primary key default gen_random_uuid(), name text unique, decrypted_secret text);
      create view vault.decrypted_secrets as select * from vault.secrets;
      create function vault.create_secret(value text, label text, description text) returns uuid language plpgsql as $$
        declare secret_id uuid; begin insert into vault.secrets(name,decrypted_secret) values(label,value) returning id into secret_id; return secret_id; end $$;
      create function vault.update_secret(secret_id uuid, value text, label text) returns void language sql as $$
        update vault.secrets set decrypted_secret=value,name=label where id=secret_id $$;`);

    // ---------------------------------------------------------------- the whole-household fingerprint
    const scoped = (await pg.query<{ table_name: string }>(
      `select table_name from information_schema.columns where table_schema = 'public' and column_name = 'household_id' order by table_name`)).rows.map(r => r.table_name);
    const everyTable = (await pg.query<{ table_name: string }>(
      `select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name`)).rows.map(r => r.table_name);

    async function fingerprint(hid: string) {
      const data: Record<string, unknown> = {};
      const rows = async (sql: string) => (await pg.query<{ j: unknown }>(sql, [hid])).rows[0].j;
      for (const table of scoped) {
        data[table] = await rows(`select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) as j from "${table}" t where household_id = $1`);
      }
      data.households = await rows(`select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) as j from households t where id = $1`);
      data.vault = await rows(`select coalesce(jsonb_agg(to_jsonb(t) order by t.name), '[]'::jsonb) as j from vault.secrets t where name like 'household:' || $1 || ':%'`);
      return { data, text: JSON.stringify(data) };
    }
    async function needlesOf(t: Tenant): Promise<Needles> {
      const strings = new Set<string>();
      const all = new Set<string>();
      walkStrings((await fingerprint(t.hid)).data, all);
      for (const s of all) if (UUID.test(s) || /isolation|iso-/i.test(s) || /^[0-9a-f]{64}$/.test(s)) strings.add(s);
      strings.add(t.key); strings.add(t.tokenString); strings.add(t.familyToken); strings.add((t.rateMicro / 1_000_000).toString());
      return { strings: [...strings], numbers: [t.bankYen, t.rateMicro] };
    }

    await check("every table except households carries household_id, so the fingerprint of a household covers all of its rows", () => {
      assert.deepEqual(everyTable.filter(t => !scoped.includes(t)), ["households"]);
      for (const table of ["bills", "charges", "pots", "members", "clients", "invoices", "documents", "readings", "cards", "card_statements", "settlements",
        "balance_updates", "events", "api_tokens", "family_links", "webhook_deliveries", "request_buckets", "fx_rates", "paypal_connections", "users", "rules"]) {
        assert.ok(scoped.includes(table), table);
      }
    });

    // ---------------------------------------------------------------- two households, every kind of row, names only each one has
    const one = <T,>(rows: T[]): T => { assert.equal(rows.length, 1); return rows[0]; };
    async function populate(tag: "A" | "B", bankYen: number, rateMicro: number): Promise<Tenant> {
      const T = `Isolation ${tag}`, l = tag.toLowerCase();
      const hid = await seedBen(db, { isDemo: true, name: `${T} household` });
      await db.update(schema.fxRates).set({ rateMicro }).where(eq(schema.fxRates.householdId, hid));
      const ownerRow = one(await db.select().from(schema.members).where(and(eq(schema.members.householdId, hid), eq(schema.members.role, "owner"))));
      await db.update(schema.members).set({ displayName: `${T} owner` }).where(eq(schema.members.id, ownerRow.id));
      await F.updateSettings(db, hid, { kind: "household", name: `${T} household`, bank: String(bankYen) });
      const akiName = `${T} Aki`;
      const aki = await F.addMember(db, hid, { name: akiName });
      await F.updateSettings(db, hid, { kind: "card", id: "", label: `${T} card`, memberId: ownerRow.id, closingDay: 25, dueDay: 10, limit: "500000" });
      const card = one(await db.select().from(schema.cards).where(and(eq(schema.cards.householdId, hid), eq(schema.cards.label, `${T} card`))));
      const client = randomUUID();
      await F.insertClient(db, hid, { id: client, name: `${T} client`, email: `isolation-${l}-client@example.test`, termsDays: 14 });
      const billConfirmed = randomUUID(), billPending = randomUUID(), charge = randomUUID(), chargePending = randomUUID();
      await F.insertBill(db, hid, billInput.parse({ id: billConfirmed, biller: `${T} rent`, amount: "80000", due: "2026-11-27", category: "housing", paidByMemberId: aki, repeat: "month" }), "confirmed", { madeBy: "form" });
      await F.insertBill(db, hid, billInput.parse({ id: billPending, biller: `${T} pending bill`, amount: "3000", due: "2026-11-20", category: "utilities", repeat: "year", nextAmount: "3500", nextAmountFrom: "2027-11-20", cancelBy: "2026-11-19" }), "pending", { madeBy: "form" });
      await F.insertCharge(db, hid, chargeInput.parse({ id: charge, cardId: card.id, merchant: `${T} market`, amount: "2000", date: "2026-11-12", category: "food", shared: true }), "confirmed", "manual", { madeBy: "form" });
      await F.insertCharge(db, hid, chargeInput.parse({ id: chargePending, cardId: card.id, merchant: `${T} pending market`, amount: "900", date: "2026-11-13", category: "food" }), "pending", "manual", { madeBy: "form" });
      const pot = randomUUID(), potPending = randomUUID();
      await F.savePot(db, hid, potInput.parse({ id: pot, name: `${T} pot`, target: "100000", targetDate: "2027-03-01", saved: "5000", fillPct: "10" }), "confirmed", { madeBy: "form" });
      await F.savePot(db, hid, potInput.parse({ id: potPending, name: `${T} pending pot` }), "pending", { madeBy: "form" });
      const balancePending = randomUUID();
      await F.setBankBalance(db, hid, { id: balancePending, amount: String(bankYen + 1) }, "pending", { madeBy: "form" });
      const balanceConfirmed = one(await db.select().from(schema.balanceUpdates).where(and(eq(schema.balanceUpdates.householdId, hid), eq(schema.balanceUpdates.status, "confirmed")))).id;
      const invoiceDraft = randomUUID();
      await F.saveInvoiceDraft(db, hid, { id: invoiceDraft, clientId: client, item: `${T} invoice item`, amount: "12.34", note: `${T} invoice note` }, { madeBy: "form" });
      const paypalInvoice = `ISO-${tag}-PAYPAL-INV`;
      const sent = one(await db.insert(schema.invoices).values({
        householdId: hid, clientId: client, status: "sent", number: `ISO-${tag}-1`, item: `${T} sent invoice`, amountMinor: 50_000, currency: "USD",
        sentOn: "2026-11-01", dueOn: "2026-11-08", paypalInvoiceId: paypalInvoice, paypalStatus: "SENT",
      }).returning({ id: schema.invoices.id, approveKey: schema.invoices.approveKey }));
      const doc = (status: "queued" | "failed" | "read", error: string | null) => db.insert(schema.documents).values({
        householdId: hid, kind: "upload", storagePath: `${hid}/${randomUUID()}`, mime: "application/pdf", status, error,
      }).returning({ id: schema.documents.id });
      const document = one(await doc("queued", null)).id, documentFailed = one(await doc("failed", `${T} document error`)).id, documentRead = one(await doc("read", null)).id;
      const extracted = { kind: "charge", name: `${T} reading`, date: "2026-11-12", amountMinor: 1500, currency: "JPY", category: "food", businessBp: 0, cardId: card.id };
      const reading = one(await db.insert(schema.readings).values({ householdId: hid, documentId: documentRead, extracted: { original: extracted, proposed: extracted }, target: "charge" })
        .returning({ id: schema.readings.id })).id;
      await db.insert(schema.rules).values({ householdId: hid, matchBiller: `bill:${l} rule biller`, patch: { category: "other" } });
      const statement = one(await db.insert(schema.cardStatements).values({
        householdId: hid, cardId: card.id, amountMinor: 31_337, currency: "JPY", closedOn: "2026-10-25", dueOn: "2026-11-10",
      }).returning({ id: schema.cardStatements.id })).id;
      const settlement = one(await db.insert(schema.settlements).values({
        householdId: hid, fromMemberId: aki, toMemberId: ownerRow.id, amountMinor: 4242, currency: "JPY", through: "2026-11-10",
      }).returning({ id: schema.settlements.id })).id;
      const user = one(await db.insert(schema.users).values({ householdId: hid, memberId: ownerRow.id, authUserId: randomUUID() }).returning({ id: schema.users.id })).id;
      const webhookEvent = `ISO-${tag}-EVT-1`;
      await F.recordWebhookDelivery(db, hid, { paypalEventId: webhookEvent, eventType: "PAYMENT.SALE.COMPLETED", verified: true, payload: { note: `${T} payload` } });
      const issued = await F.issueMcpToken(db, hid, { name: `${T} token`, scopes: ["read"] });
      const family = await F.createFamilyLink(db, hid);
      const key = `sk-ant-isolation-${l}-${"k".repeat(24)}`;
      await F.saveHouseholdKey(db, hid, key);
      const secret = one(await db.select({ id: schema.households.aiKeySecretId }).from(schema.households).where(eq(schema.households.id, hid))).id!;
      await F.consumeRequest(db, hid, "ask");
      await F.recordEvent(db, hid, { madeBy: "form", kind: `isolation_${l}_event`, title: `${T} event`, body: `${T} event body`, notify: true });
      return {
        hid, tag, name: T, bankYen, rateMicro, key, tokenString: issued.token, familyToken: family.token, akiName,
        ids: { owner: ownerRow.id, aki, card: card.id, client, billConfirmed, billPending, charge, chargePending, pot, potPending, balanceConfirmed, balancePending,
          invoiceDraft, invoiceSent: sent.id, approveKey: sent.approveKey, paypalInvoice, document, documentFailed, documentRead, reading, settlement, token: issued.info.id,
          statement, webhookEvent, secret, user, familyLink: family.info.id },
      };
    }
    const A = await populate("A", 5_550_001, 149_876_543);
    const B = await populate("B", 7_654_321, 151_234_567);
    const eventIdsOf = async (t: Tenant) => (await db.select({ id: schema.events.id }).from(schema.events).where(eq(schema.events.householdId, t.hid))).map(r => r.id);

    await check("each household has rows of every kind, none shared with the other", async () => {
      for (const t of [A, B]) {
        const fp = (await fingerprint(t.hid)).data as Record<string, unknown[]>;
        for (const table of scoped) {
          if (["rules", "fx_rates"].includes(table)) continue;
          assert.ok(fp[table].length > 0, `${t.name} has no ${table}`);
        }
        assert.ok(fp.rules.length === 1 && fp.fx_rates.length === 1 && fp.vault.length === 1);
      }
      const [a, b] = [await needlesOf(A), await needlesOf(B)];
      assert.ok(a.strings.length > 100 && b.strings.length > 100);
      assert.equal(a.strings.filter(s => b.strings.includes(s)).length, 0, "no id or name is in both households");
    });

    await check("the detectors work: B's own text matches B's needles, A's does not, and a write to B changes B's fingerprint", async () => {
      const bNeedles = await needlesOf(B);
      const bState = JSON.stringify(await F.loadMoneyState(store, B.hid, DEMO_DATE));
      assert.ok(leaks(bState, bNeedles).length >= 5, "B's own state shows B's ids and names");
      assert.deepEqual(leaks(JSON.stringify(await F.loadMoneyState(store, A.hid, DEMO_DATE)), bNeedles), []);
      const before = await fingerprint(B.hid);
      await F.recordEvent(store, B.hid, { madeBy: "form", kind: "isolation_b_canary", title: "Isolation B canary" });
      assert.notEqual((await fingerprint(B.hid)).text, before.text);
    });

    // The two bearers authenticate as their own household (this updates last_used_at, so it happens before any baseline).
    await check("an MCP token opens its own household, a forged one for either household opens nothing", async () => {
      assert.equal((await F.authenticateMcpToken(db, A.tokenString))?.householdId, A.hid);
      assert.equal((await F.authenticateMcpToken(db, B.tokenString))?.householdId, B.hid);
      const forge = async (hid: string) => {
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const key = await crypto.subtle.importKey("raw", Buffer.from(process.env.MCP_TOKEN_KEY!, "base64url"), "AES-GCM", false, ["encrypt"]);
        const sealed = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: new TextEncoder().encode("personal-economy-saver/mcp/v1") }, key, new TextEncoder().encode(hid));
        return "pes1." + Buffer.concat([iv, new Uint8Array(sealed)]).toString("base64url");
      };
      for (const t of [A, B]) {
        const forged = await forge(t.hid);
        assert.equal(forged.length, 91);
        assert.equal(await F.authenticateMcpToken(db, forged), null, "a well-formed token that was never issued opens nothing");
      }
    });

    // ---------------------------------------------------------------- reads
    const toolInputs: Record<string, unknown> = {
      can_i_spend: { amount_minor: 1_000 }, timeline: { scenario: "late" }, plan_for: { target_minor: 100_000, target_date: "2027-06-01" },
    };
    function toolContext(t: Tenant): ToolContext {
      return { madeBy: "ask", db: store, householdId: t.hid, state: () => F.loadMoneyState(store, t.hid, DEMO_DATE), appUrl: new URL("http://127.0.0.1:3123") };
    }
    const runTool = (t: Tenant, name: string, input: unknown) => {
      const tool = tools.find(x => x.name === name)!;
      return tool.run(toolContext(t), tool.input.parse(input) as never);
    };

    async function readsOf(viewer: Tenant, other: Tenant) {
      const needles = await needlesOf(other);
      const hid = viewer.hid;
      const seen = (label: string, value: unknown) => {
        const hits = leaks(JSON.stringify(value) ?? "", needles);
        assert.deepEqual(hits, [], `${viewer.name} reads: ${label} shows ${other.name}'s data`);
      };
      const home = one(await db.select().from(schema.households).where(eq(schema.households.id, hid)));
      const state = await F.loadMoneyState(store, hid, DEMO_DATE);
      seen("loadMoneyState", state);
      assert.equal(state.bank, viewer.bankYen, "the bank balance is the viewer's own");
      assert.equal(state.fxPerUsd, viewer.rateMicro / 1_000_000, "the USD rate is the viewer's own");
      assert.ok(state.clients.some(c => c.id === viewer.ids.client) && state.pots.some(p => p.id === viewer.ids.pot));
      seen("loadSplitState", await F.loadSplitState(store, hid, home.splitSince, DEMO_DATE, m => m));
      seen("householdClock", await F.householdClock(store, hid));
      seen("householdDate", await F.householdDate(store, hid));
      assert.equal(await F.accountHousehold(store, hid), null, "a household id is not a sign-in: no users row has it as its auth uid");
      assert.equal(await F.householdOwnerName(store, hid), `${viewer.name} owner`);
      seen("usdRate", await F.usdRate(store, hid, "JPY", DEMO_DATE));
      assert.equal(await F.usdRateMicro(store, hid, "JPY", DEMO_DATE), viewer.rateMicro);
      const events = await F.listEvents(store, hid);
      seen("listEvents", events);
      assert.ok(events.length > 0 && events.every(e => e.householdId === hid));
      seen("listEvents since", await F.listEvents(store, hid, new Date(0), 5, 1));
      seen("unreadCount", await F.unreadCount(store, hid));
      seen("eventFeed", await F.eventFeed(store, hid));
      assert.equal(await F.memberCount(store, hid), 2);
      assert.equal((await F.memberByName(store, hid, viewer.akiName)).id, viewer.ids.aki);
      await assert.rejects(F.memberByName(store, hid, other.akiName), /Nobody called/);
      const settings = await F.loadSettings(store, hid);
      seen("loadSettings", settings);
      assert.equal(settings.household.name, `${viewer.name} household`);
      assert.ok(settings.cards.some(c => c.id === viewer.ids.card) && settings.people.some(p => p.id === viewer.ids.aki));
      const tokens = await F.listMcpTokens(store, hid);
      seen("listMcpTokens", tokens);
      assert.deepEqual(tokens.map(x => x.id), [viewer.ids.token]);
      const links = await F.listFamilyLinks(store, hid);
      seen("listFamilyLinks", links);
      assert.deepEqual(links.map(x => x.id), [viewer.ids.familyLink]);
      assert.equal(await F.resolveFamilyLink(store, viewer.familyToken), hid, "the viewer's token opens the viewer's household");
      const familyView = await F.loadFamilyView(store, hid);
      seen("loadFamilyView", familyView);
      assert.equal(familyView.name, `${viewer.name} household`);
      const inbox = await F.readerInbox(store, hid);
      seen("readerInbox", inbox);
      assert.deepEqual([inbox.readings.map(r => r.id), inbox.jobs.length], [[viewer.ids.reading], 2]);
      seen("loadNavigationData", await F.loadNavigationData(store, hid));
      seen("loadWorkspaceData", await F.loadWorkspaceData(store, hid, false));
      seen("loadHouseholdSnapshot with events", await F.loadHouseholdSnapshot(store, hid, { events: true }));
      seen("loadHouseholdSnapshot recent", await F.loadHouseholdSnapshot(store, hid, { events: false, recent: 3 }));
      const review = await F.invoiceReview(store, hid, viewer.ids.invoiceSent);
      seen("invoiceReview", review);
      assert.equal(review?.invoice.id, viewer.ids.invoiceSent);
      assert.equal(await F.invoiceReview(store, hid, other.ids.invoiceSent), undefined);
      assert.equal(await F.invoiceReview(store, hid, other.ids.invoiceDraft), undefined);
      assert.equal(await F.canImportPayPal(store, hid), false);
      // The agent's read tools, with this household's context.
      for (const tool of tools.filter(x => x.scope === "read")) {
        seen(`agent tool ${tool.name}`, await runTool(viewer, tool.name, toolInputs[tool.name] ?? {}));
      }
      seen("agent tool plan_for with its own pot", await runTool(viewer, "plan_for", { pot_id: viewer.ids.pot }));
      await assert.rejects(runTool(viewer, "plan_for", { pot_id: other.ids.pot }), /Unknown pot/);
      await assert.rejects(runTool(viewer, "can_i_spend", { amount_minor: 1_000, card_id: other.ids.card }), /Unknown card/);
      const snapshotTool = JSON.parse(await runTool(viewer, "household_snapshot", {}));
      assert.equal(snapshotTool.household.id, hid);
      const invoiceTool = JSON.parse(await runTool(viewer, "list_invoices", {}));
      assert.ok(invoiceTool.some((i: { item: string }) => i.item === `${viewer.name} sent invoice`));
    }
    await check("reads of household A (loaders, snapshot, reader inbox, tokens, agent read tools) never show household B", () => readsOf(A, B));
    await check("reads of household B never show household A", () => readsOf(B, A));
    await check("Home's writable workspace load for A observes only A (the runway baseline is A's alone)", async () => {
      const before = await fingerprint(B.hid);
      await db.transaction(tx => F.loadWorkspaceData(tx as unknown as Db, A.hid, true));
      assert.equal((await fingerprint(B.hid)).text, before.text);
    });

    // ---------------------------------------------------------------- writes and removes, in both directions
    async function attacks(X: Tenant, Y: Tenant) {
      const base = await fingerprint(Y.hid);
      // The other household may hold a member named like one of X's (names are unique per household, not across them), added by the earlier suite.
      const needles = await needlesOf(Y);
      needles.strings = needles.strings.filter(s => !s.includes(X.akiName));
      const yEvents = await eventIdsOf(Y);
      const label = (name: string) => `${X.name} acting on ${Y.name}'s row: ${name}`;
      async function attempt(fn: () => Promise<unknown>): Promise<Outcome> {
        try { return { threw: false, value: await fn() }; } catch (error) { return { threw: true, error }; }
      }
      async function untouched(name: string) {
        assert.equal((await fingerprint(Y.hid)).text, base.text, label(name) + " changed the other household");
      }
      /** The call must refuse (throw, or return false / 0 / nothing) and leave the other household exactly as it was. */
      async function refuse(name: string, fn: () => Promise<unknown>) {
        const outcome = await attempt(fn);
        assert.ok(outcome.threw || !outcome.value, label(name) + " was not refused: " + JSON.stringify(outcome.value));
        await untouched(name);
      }
      /** Inserts and edits that name the other household's row: must throw. */
      async function mustThrow(name: string, fn: () => Promise<unknown>, message?: RegExp) {
        const outcome = await attempt(fn);
        assert.ok(outcome.threw, label(name) + " did not throw");
        if (message) assert.match(String((outcome.error as Error)?.message), message, label(name));
        await untouched(name);
      }
      const x = X.ids, y = Y.ids;
      const nothingCalled = () => { throw new Error("the PayPal tool must not be called"); };
      const exactBill = (over: object) => billInput.parse({ id: randomUUID(), biller: "Isolation probe", amount: "100", due: "2026-11-20", category: "other", ...over });

      await check(`${X.name} -> ${Y.name}: remove by id (bills, charges, pots)`, async () => {
        for (const id of [y.billConfirmed, y.billPending]) await refuse("removeBill " + id, () => F.removeBill(store, X.hid, id));
        for (const id of [y.charge, y.chargePending]) await refuse("removeCharge " + id, () => F.removeCharge(store, X.hid, id));
        for (const id of [y.pot, y.potPending]) await refuse("removePot " + id, () => F.removePot(store, X.hid, id));
        for (const id of [y.billConfirmed, y.billPending]) await refuse("updateBill " + id, () => F.updateBill(store, X.hid, billEditInput.parse({ id, biller: "Isolation probe", amount: "1", due: "2026-11-20", category: "other" }), { madeBy: "form" }));
        for (const id of [y.aki, y.owner]) await refuse("removeMember " + id, () => F.removeMember(store, X.hid, { id }));
      });
      await check(`${X.name} -> ${Y.name}: confirm by id (bill, charge, balance, pot, statement charge)`, async () => {
        await refuse("confirmPending bill", () => F.confirmPending(store, X.hid, "bill", y.billPending));
        await refuse("confirmPending charge", () => F.confirmPending(store, X.hid, "charge", y.chargePending));
        await refuse("confirmPending balance", () => F.confirmPending(store, X.hid, "balance", y.balancePending));
        await refuse("confirmPending pot", () => F.confirmPending(store, X.hid, "pot", y.potPending));
        await refuse("confirmBalanceUpdate", () => db.transaction(tx => F.confirmBalanceUpdate(tx as unknown as Db, X.hid, y.balancePending)));
        await refuse("confirmPot", () => db.transaction(tx => F.confirmPot(tx as unknown as Db, X.hid, y.potPending)));
        await mustThrow("syncClosedStatementCharge", () => db.transaction(tx => F.syncClosedStatementCharge(tx as unknown as Db, X.hid, y.charge)), /not found/);
        await mustThrow("unsyncClosedStatementCharge", () => db.transaction(tx => F.unsyncClosedStatementCharge(tx as unknown as Db, X.hid, y.charge)), /not found/);
        await refuse("confirmed charge is not a pending one either", () => F.confirmPending(store, X.hid, "bill", y.billConfirmed));
      });
      await check(`${X.name} -> ${Y.name}: inserts and edits that name the other household's id, card, member or client`, async () => {
        await mustThrow("insertBill with the other's bill id", () => F.insertBill(store, X.hid, exactBill({ id: y.billConfirmed }), "confirmed", { madeBy: "form" }));
        await mustThrow("insertBill with the other's member", () => F.insertBill(store, X.hid, exactBill({ memberId: y.aki }), "confirmed", { madeBy: "form" }), /member of this household/);
        const edit = (over: object) => billEditInput.parse({ id: x.billConfirmed, biller: "Isolation probe", amount: "100", due: "2026-11-27", category: "other", ...over });
        await mustThrow("updateBill giving its own bill to the other's member", () => F.updateBill(store, X.hid, edit({ memberId: y.aki }), { madeBy: "form" }), /member of this household/);
        await mustThrow("updateBill paid by the other's member", () => F.updateBill(store, X.hid, edit({ paidByMemberId: y.aki }), { madeBy: "form" }), /member of this household/);
        await mustThrow("insertBill paid by the other's member", () => F.insertBill(store, X.hid, exactBill({ paidByMemberId: y.aki }), "pending", { madeBy: "form" }), /member of this household/);
        const charge = (over: object) => chargeInput.parse({ id: randomUUID(), cardId: x.card, merchant: "Isolation probe", amount: "100", date: "2026-11-13", category: "other", ...over });
        await mustThrow("insertCharge on the other's card", () => F.insertCharge(store, X.hid, charge({ cardId: y.card }), "confirmed", "manual", { madeBy: "form" }), /card of this household/);
        await mustThrow("insertCharge with the other's charge id", () => F.insertCharge(store, X.hid, charge({ id: y.charge }), "pending", "manual", { madeBy: "form" }));
        await mustThrow("insertClient with the other's client id", () => F.insertClient(store, X.hid, { id: y.client, name: "Isolation probe", email: "isolation-probe@example.test", termsDays: 0 }));
        await mustThrow("saveInvoiceDraft for the other's client", () => F.saveInvoiceDraft(store, X.hid, { id: randomUUID(), clientId: y.client, item: "probe", amount: "1", note: "" }, { madeBy: "form" }), /Client not found/);
        await mustThrow("saveInvoiceDraft with the other's invoice id", () => F.saveInvoiceDraft(store, X.hid, { id: y.invoiceDraft, clientId: x.client, item: "probe", amount: "1", note: "" }, { madeBy: "form" }), /already in use/);
        await mustThrow("setBankBalance with the other's update id (pending)", () => F.setBankBalance(store, X.hid, { id: y.balancePending, amount: "1" }, "pending", { madeBy: "form" }));
        await mustThrow("setBankBalance with the other's update id (confirmed)", () => F.setBankBalance(store, X.hid, { id: y.balanceConfirmed, amount: "1" }, "confirmed", { madeBy: "form" }));
        const pot = (over: object) => potInput.parse({ id: randomUUID(), name: "Isolation probe", ...over });
        await mustThrow("savePot with the other's pot id (confirmed)", () => F.savePot(store, X.hid, pot({ id: y.pot }), "confirmed", { madeBy: "form" }));
        await mustThrow("savePot with the other's pot id (pending)", () => F.savePot(store, X.hid, pot({ id: y.potPending }), "pending", { madeBy: "form" }));
        await mustThrow("savePot owned by the other's member", () => F.savePot(store, X.hid, pot({ memberId: y.aki }), "confirmed", { madeBy: "form" }), /member of this household/);
        await mustThrow("savePeople with the other's members", () => F.savePeople(store, X.hid, { people: [{ id: y.owner, name: "Probe one", percent: "50" }, { id: y.aki, name: "Probe two", percent: "50" }] }), /every person in this household/);
        await mustThrow("savePeople mixing in one of the other's members", () => F.savePeople(store, X.hid, { people: [{ id: x.owner, name: "Probe one", percent: "50" }, { id: y.aki, name: "Probe two", percent: "50" }] }), /every person in this household/);
        await mustThrow("updateSettings card of the other household", () => F.updateSettings(store, X.hid, { kind: "card", id: y.card, label: "Probe", memberId: "", closingDay: 1, dueDay: 2, limit: "" }), /Card no longer exists/);
        await mustThrow("updateSettings card owned by the other's member", () => F.updateSettings(store, X.hid, { kind: "card", id: x.card, label: "Probe", memberId: y.aki, closingDay: 1, dueDay: 2, limit: "" }), /member of this household/);
        await mustThrow("updateSettings a new card owned by the other's member", () => F.updateSettings(store, X.hid, { kind: "card", id: "", label: "Probe", memberId: y.owner, closingDay: 1, dueDay: 2, limit: "" }), /member of this household/);
      });
      await check(`${X.name} -> ${Y.name}: invoices (paid outside, review, approve, remind)`, async () => {
        await refuse("markPaidOutside the other's draft", () => F.markPaidOutside(store, X.hid, y.invoiceDraft, DEMO_DATE));
        await refuse("markPaidOutside the other's sent invoice", () => F.markPaidOutside(store, X.hid, y.invoiceSent, DEMO_DATE));
        await refuse("invoiceReview", () => F.invoiceReview(store, X.hid, y.invoiceSent));
        let toolCalls = 0;
        const tool: approval.InvoiceTool = async () => { toolCalls++; return nothingCalled(); };
        for (const action of ["send", "remind"] as const) {
          const ctx = { db: store, householdId: X.hid, approveKey: y.approveKey, today: DEMO_DATE, usdRate: 150, recipient: "isolation-probe@example.test", tool };
          const outcome = await attempt(() => F.approveInvoice(ctx, action));
          assert.ok(outcome.threw && outcome.error instanceof ApprovalError && (outcome.error as ApprovalError).status === 404, label("approveInvoice " + action));
          await untouched("approveInvoice " + action);
        }
        assert.equal(toolCalls, 0, "no PayPal call was made for the other household's invoice");
      });
      await check(`${X.name} -> ${Y.name}: readings, documents, tokens, events, webhooks`, async () => {
        const item = { kind: "charge" as const, name: "Isolation probe", date: "2026-11-12", amountMinor: 100, currency: "JPY" as const, category: "other" as const, businessBp: 0, cardId: null, repeat: null, nextAmountMinor: null, nextAmountFrom: null, cancelBy: null };
        await refuse("reviewReading reject", () => F.reviewReading(store, X.hid, y.reading, null));
        await refuse("reviewReading confirm", () => F.reviewReading(store, X.hid, y.reading, { ...item, cardId: x.card }));
        await mustThrow("proposeReadings on the other's document", () => F.proposeReadings(store, X.hid, y.documentRead, [item]));
        for (const id of [y.document, y.documentFailed]) await refuse("readDocument " + id, () => F.readDocument(store, X.hid, id, true));
        await refuse("revokeMcpToken", () => F.revokeMcpToken(store, X.hid, y.token));
        await refuse("stopFamilyLink", () => F.stopFamilyLink(store, X.hid, y.familyLink));
        assert.equal(await F.resolveFamilyLink(store, Y.familyToken), Y.hid, "the other's link still opens the other's household, and only that");
        assert.ok(yEvents.length > 3);
        await refuse("markRead with the other's event ids", () => F.markRead(store, X.hid, yEvents));
        assert.equal(await F.recordWebhookDelivery(store, X.hid, { paypalEventId: y.webhookEvent, eventType: "PAYMENT.SALE.COMPLETED", verified: true, payload: { note: "replay" } }), false);
        await untouched("recordWebhookDelivery replay");
        await refuse("authenticateMcpToken is not given the other's token by the revoke", async () => (await F.revokeMcpToken(store, X.hid, y.token)));
      });
      await check(`${X.name} -> ${Y.name}: the Anthropic key (Vault) cannot be reached through a wrong pointer`, async () => {
        const own = one(await db.select({ id: schema.households.aiKeySecretId }).from(schema.households).where(eq(schema.households.id, X.hid))).id!;
        try {
          // Corrupt X's pointer so that it names the other household's secret; every path must still refuse.
          await db.update(schema.households).set({ aiKeySecretId: y.secret }).where(eq(schema.households.id, X.hid));
          const reading = await attempt(() => F.aiKey(store, X.hid));
          assert.ok(reading.threw && reading.error instanceof AiKeyError, "aiKey must not return the other household's key");
          await untouched("aiKey through a wrong pointer");
          await mustThrow("saveHouseholdKey through a wrong pointer", () => F.saveHouseholdKey(store, X.hid, "sk-ant-probe-" + "z".repeat(24)), /ownership/);
          await mustThrow("deleteHouseholdKey through a wrong pointer", () => db.transaction(tx => F.deleteHouseholdKey(tx as unknown as Db, X.hid)), /ownership/);
        } finally {
          await db.update(schema.households).set({ aiKeySecretId: own }).where(eq(schema.households.id, X.hid));
        }
        assert.equal(await F.aiKey(store, X.hid), X.key, "the household's own key is returned when the pointer is right");
        assert.notEqual(await F.aiKey(store, X.hid), Y.key);
      });
      await check(`${X.name} -> ${Y.name}: the agent's draft tools refuse the other household's ids`, async () => {
        const probe = { biller: "Isolation probe", amount: "100", due: "2026-11-20" };
        await mustThrow("draft_invoice for the other's client", () => runTool(X, "draft_invoice", { id: randomUUID(), clientId: y.client, item: "probe", amount: "1", note: "" }), /Client not found/);
        await mustThrow("add_bill for the other's member", () => runTool(X, "add_bill", { id: randomUUID(), ...probe, memberId: y.aki }), /member of this household/);
        await mustThrow("add_bill paid by the other's member by name", () => runTool(X, "add_bill", { id: randomUUID(), ...probe, shared: true, paidBy: Y.akiName }), /Nobody called/);
        await mustThrow("log_charge on the other's card", () => runTool(X, "log_charge", { id: randomUUID(), cardId: y.card, merchant: "Isolation probe", amount: "100", date: "2026-11-13" }), /card of this household/);
        await mustThrow("add_pot with the other's pot id", () => runTool(X, "add_pot", { id: y.pot, name: "Isolation probe" }));
        await mustThrow("update_bank_balance with the other's update id", () => runTool(X, "update_bank_balance", { id: y.balancePending, amount: "1" }));
      });
      await check(`${X.name} -> ${Y.name}: PayPal import and refresh reach only the caller's own invoices`, async () => {
        for (const bound of [Y.hid, X.hid]) {
          process.env.PAYPAL_BALANCE_HOUSEHOLD_ID = bound;
          const outcome = await attempt(() => F.importPayPalHistory(store, X.hid, async () => nothingCalled()));
          assert.ok(outcome.threw && outcome.error instanceof ImportRefused, "a demo household is refused, whichever household the setting names");
          assert.equal(await F.canImportPayPal(store, X.hid), false);
          await untouched("importPayPalHistory");
        }
        delete process.env.PAYPAL_BALANCE_HOUSEHOLD_ID;
        const paths: string[] = [];
        const read = async (path: string) => {
          paths.push(path);
          return { id: X.ids.paypalInvoice, status: "UNPAID", detail: { invoice_number: `ISO-${X.tag}-1` } };
        };
        const refreshed = await F.refreshPayPal(store, X.hid, read, new Date("2026-11-03T04:00:00Z"));
        assert.equal(refreshed.stale, null);
        assert.deepEqual(paths, ["/v2/invoicing/invoices/" + X.ids.paypalInvoice], "only the caller's own PayPal invoice is read");
        await untouched("refreshPayPal");
      });
      await check(`${X.name}: its own writes (events, rate limit, pots, reference rate, daily run, settle, locks) leave ${Y.name} untouched`, async () => {
        const own = async (name: string, fn: () => Promise<unknown>) => { await fn(); await untouched(name); };
        await own("recordEvent", () => F.recordEvent(store, X.hid, { madeBy: "form", kind: `isolation_${X.tag.toLowerCase()}_probe`, title: `${X.name} probe`, notify: true }));
        assert.ok(await F.markRead(store, X.hid) >= 1);
        await untouched("markRead all");
        assert.equal(await F.consumeRequest(store, X.hid, "ask"), true);
        await untouched("consumeRequest");
        await own("storeReferenceRate", () => F.storeReferenceRate(store, X.hid, { date: "2026-11-13", rateMicro: 148_000_000 }));
        await own("fillPots", async () => assert.equal(await db.transaction(tx => F.fillPots(tx as unknown as Db, X.hid, 100_000, "Isolation probe")), 1, "only the caller's one pot with a fill rule"));
        await own("lockRunway", () => F.lockRunway(store, X.hid));
        await own("beginMoneyChange", () => F.beginMoneyChange(store, X.hid));
        await own("observeRunway", () => F.observeRunway(store, X.hid));
        await own("runDaily", () => F.runDaily(store, X.hid, new Date("2026-11-03T04:00:00Z")));
        await own("settleUp", () => F.settleUp(store, X.hid));
        await own("unreadCount and listEvents", () => Promise.all([F.unreadCount(store, X.hid), F.listEvents(store, X.hid)]));
        await own("addMember with a name the other household also uses", async () => {
          const [xBefore, yBefore] = [await F.memberCount(store, X.hid), await F.memberCount(store, Y.hid)];
          await F.addMember(store, X.hid, { name: Y.akiName });
          assert.equal(await F.memberCount(store, X.hid), xBefore + 1);
          assert.equal(await F.memberCount(store, Y.hid), yBefore);
        });
      });
      await check(`${X.name}'s rows hold no id, name, secret or number of ${Y.name} after all of it`, async () => {
        // The member added in the last step shares the other's name by design (names are unique per household, not across them).
        const text = (await fingerprint(X.hid)).text.replaceAll(Y.akiName, "");
        assert.deepEqual(leaks(text, needles), []);
        await untouched("end of suite");
      });
    }
    await attacks(A, B);
    await attacks(B, A);

    // ---------------------------------------------------------------- functions keyed by account or by the household itself
    const bBefore = await fingerprint(B.hid), aBefore = await fingerprint(A.hid);
    const bothUntouched = async (name: string) => {
      assert.equal((await fingerprint(B.hid)).text, bBefore.text, name + " changed household B");
      assert.equal((await fingerprint(A.hid)).text, aBefore.text, name + " changed household A");
    };
    await check("account functions: sign-in lookup, setup and delete act on one account's household and never on a demo or another household", async () => {
      const uid = randomUUID();
      assert.equal(await F.finishSetup(store, uid, SETUP, null), uid);
      assert.equal(await F.accountHousehold(store, uid), uid);
      assert.equal(await F.accountHousehold(store, randomUUID()), null);
      assert.equal(await F.accountHousehold(store, A.hid), null);
      assert.equal(await F.accountHousehold(store, B.hid), null);
      await assert.rejects(F.finishSetup(store, A.hid, SETUP, null), /Household unavailable/, "a uid equal to an existing household's id cannot take it over");
      await assert.rejects(F.finishSetup(store, B.hid, SETUP, null), /Household unavailable/);
      assert.equal(await F.deleteOwnedHousehold(store, A.hid), false, "a demo household is not an owned account");
      assert.equal(await F.deleteOwnedHousehold(store, B.hid), false);
      assert.equal(await F.deleteOwnedHousehold(store, randomUUID()), false);
      assert.equal(await F.resetDemoHousehold(store, uid), null, "a real account is never reset as a demo");
      assert.equal(await F.findDemoHousehold(store, uid), null);
      await bothUntouched("account functions");
      assert.equal(await F.deleteOwnedHousehold(store, uid), true);
      assert.equal(await F.accountHousehold(store, uid), null);
      await bothUntouched("deleteOwnedHousehold of a third household");
    });
    await check("createHousehold: a blank demo is a fresh household of its own (no sign-in, no users row) and takes nothing from A, B or an account", async () => {
      const blank = randomUUID();
      assert.equal(await F.createHousehold(store, blank, SETUP, { isDemo: true }), blank);
      assert.equal(await F.findDemoHousehold(store, blank), blank, "it is a demo household");
      assert.equal(await F.accountHousehold(store, blank), null, "a blank demo is not an account");
      assert.notEqual(await F.householdDate(store, blank), DEMO_DATE, "a blank demo lives on the real date");
      assert.equal(await F.tryItKind(store, blank), "blank");
      assert.equal(await F.tryItKind(store, A.hid), "try-it");
      assert.equal(await F.tryItKind(store, randomUUID()), null, "an unknown id is no demo");
      assert.deepEqual((await pg.query("select count(*)::int as n from users where household_id = $1", [blank])).rows[0], { n: 0 });
      assert.deepEqual((await pg.query("select count(*)::int as n from cards where household_id = $1", [blank])).rows[0], { n: 1 });
      assert.deepEqual((await pg.query("select count(*)::int as n from bills where household_id = $1", [blank])).rows[0], { n: 0 }, "no Ben data");
      await assert.rejects(F.createHousehold(store, A.hid, SETUP, { isDemo: true }), /Household unavailable/, "an id that already names a household is never taken over");
      await assert.rejects(F.createHousehold(store, B.hid, SETUP, { isDemo: false, authUserId: randomUUID() }), /Household unavailable/);
      await bothUntouched("createHousehold");
      await F.deleteHousehold(store, blank);
    });
    await check("createHousehold with replaceDemo deletes only the named demo: a non-demo household or an unknown id changes nothing, and A and B stay as they were", async () => {
      const uid = randomUUID();
      await F.finishSetup(store, uid, SETUP, null); // a real account: its id can be named by a stale cookie, never deleted by it
      const accountBefore = (await fingerprint(uid)).text;
      const named = await F.createHousehold(store, randomUUID(), SETUP, { isDemo: true, replaceDemo: uid });
      assert.equal(await F.accountHousehold(store, uid), uid, "the account household survives");
      assert.equal((await fingerprint(uid)).text, accountBefore, "naming a non-demo household changes nothing in it");
      assert.equal(await F.findDemoHousehold(store, named), named);
      await F.createHousehold(store, randomUUID(), SETUP, { isDemo: true, replaceDemo: randomUUID() });
      await bothUntouched("a blank start naming a non-demo or unknown household");
      const mine = await seedBen(db, { isDemo: true });
      const replaced = await F.createHousehold(store, randomUUID(), SETUP, { isDemo: true, replaceDemo: mine });
      assert.equal(await F.findDemoHousehold(store, mine), null, "the visitor's own demo is replaced");
      assert.equal(await F.findDemoHousehold(store, replaced), replaced);
      assert.deepEqual((await pg.query("select count(*)::int as n from bills where household_id = $1", [mine])).rows[0], { n: 0 }, "its rows are gone with it");
      assert.equal((await fingerprint(uid)).text, accountBefore);
      await bothUntouched("replacing the visitor's own demo");
      await F.deleteHousehold(store, named);
    });
    await check("demo functions: find, reset, delete and cleanup name one household and leave A and B as they were", async () => {
      const [c1, c2, c3, c4] = [await seedBen(db, { isDemo: true }), await seedBen(db, { isDemo: true }), await seedBen(db, { isDemo: true }), await seedBen(db, { isDemo: true })];
      assert.equal(await F.findDemoHousehold(store, c1), c1);
      assert.equal(await F.findDemoHousehold(store, randomUUID()), null);
      assert.equal(await F.findDemoHousehold(store, "not-a-uuid"), null);
      const fresh = await F.resetDemoHousehold(store, c1);
      assert.ok(fresh && fresh !== c1 && fresh !== A.hid && fresh !== B.hid);
      assert.equal(await F.findDemoHousehold(store, c1), null, "the reset household is gone");
      assert.equal(await F.resetDemoHousehold(store, randomUUID()), null);
      await F.removeHouseholdDocuments(store, c2);
      await F.deleteHousehold(store, c2);
      assert.equal(await F.findDemoHousehold(store, c2), null);
      // finishSetup deletes the demo household its caller names (its own visitor cookie), and only that one.
      const uid = randomUUID();
      await F.finishSetup(store, uid, SETUP, c3);
      assert.equal(await F.findDemoHousehold(store, c3), null);
      assert.equal(await F.findDemoHousehold(store, c4), c4, "a demo household nobody named is left alone");
      await bothUntouched("demo functions");
      await F.deleteHousehold(store, uid);
    });
    await check("sweepDemoHouseholds: removes only an old quiet demo; A, B, a recent demo, an old non-demo and an old demo with a recent event all survive", async () => {
      const old = new Date(Date.now() - 9 * 86_400_000);
      const [oldQuiet, oldBusy, recent] = [await seedBen(db, { isDemo: true }), await seedBen(db, { isDemo: true }), await seedBen(db, { isDemo: true })];
      const oldReal = await seedBen(db);
      for (const id of [oldQuiet, oldBusy, oldReal]) await db.update(schema.households).set({ createdAt: old }).where(eq(schema.households.id, id));
      await db.delete(schema.events).where(eq(schema.events.householdId, oldQuiet));
      await db.delete(schema.events).where(eq(schema.events.householdId, oldReal));
      await db.delete(schema.events).where(eq(schema.events.householdId, oldBusy));
      await F.recordEvent(store, oldBusy, { madeBy: "form", kind: "isolation_sweep_probe", title: "Recent change" });
      const result = await F.sweepDemoHouseholds(store);
      assert.equal(result.failed, 0);
      assert.equal(result.swept, 1, "only the old quiet demo household");
      const alive = async (id: string) => (await db.select().from(schema.households).where(eq(schema.households.id, id))).length === 1;
      assert.equal(await alive(oldQuiet), false);
      for (const id of [oldBusy, recent, oldReal, A.hid, B.hid]) assert.equal(await alive(id), true);
      await bothUntouched("sweepDemoHouseholds");
      const [gone] = [await seedBen(db, { isDemo: true })];
      assert.equal(await F.deleteDemoHousehold(store, oldReal), false, "deleteDemoHousehold never deletes a non-demo household");
      assert.equal(await db.transaction(tx => F.deleteDemoHousehold(tx as unknown as Db, gone)), true);
      assert.equal(await alive(oldReal), true);
      await bothUntouched("deleteDemoHousehold");
      for (const id of [oldBusy, recent, oldReal]) await F.deleteHousehold(store, id);
    });
    await check("PayPal import into the designated household cannot take or touch an invoice that belongs to A or B", async () => {
      const designated = await seedBen(db);
      await db.insert(schema.fxRates).values({ householdId: designated, base: "USD", quote: "JPY", date: "2020-01-01", rateMicro: 150_000_000 });
      const remote = (id: string, email: string) => ({
        id, status: "SENT", detail: { invoice_number: "N-" + id, invoice_date: "2026-09-01", payment_term: { due_date: "2026-09-15" } },
        primary_recipients: [{ billing_info: { email_address: email, name: { given_name: "Isolation", surname: "Probe" } } }], amount: { currency_code: "USD", value: "10.00" },
      });
      const read = async (path: string) => {
        assert.match(path, /^\/v2\/invoicing\/invoices\?page=1/);
        return { total_pages: 1, items: [remote(A.ids.paypalInvoice, "isolation-a-client@example.test"), remote(B.ids.paypalInvoice, "isolation-b-client@example.test")] };
      };
      process.env.PAYPAL_BALANCE_HOUSEHOLD_ID = designated;
      try {
        assert.equal(await F.canImportPayPal(store, designated), true);
        assert.equal(await F.canImportPayPal(store, A.hid), false);
        assert.equal(await F.canImportPayPal(store, B.hid), false);
        await assert.rejects(F.importPayPalHistory(store, A.hid, read), ImportRefused);
        await assert.rejects(F.importPayPalHistory(store, B.hid, read), ImportRefused);
        const result = await F.importPayPalHistory(store, designated, read);
        assert.deepEqual(result, { clients: 0, invoices: 0, skipped: 2 }, "an invoice id another household owns is skipped, its client rolled back");
        const mine = await fingerprint(designated);
        assert.deepEqual(leaks(mine.text, await needlesOf(A)), []);
        assert.deepEqual(leaks(mine.text, await needlesOf(B)), []);
        await bothUntouched("importPayPalHistory");
      } finally { delete process.env.PAYPAL_BALANCE_HOUSEHOLD_ID; }
    });

    // ---------------------------------------------------------------- Stage 17 spending
    await check("loadSpending (D53): each household's range holds its own confirmed bills and charges and none of the other's; reading changes nothing", async () => {
      for (const [X, Y] of [[A, B], [B, A]] as const) {
        const yStart = await fingerprint(Y.hid), xStart = await fingerprint(X.hid);
        const input = await F.loadSpending(store, X.hid, { from: "2025-11-01", to: "2027-12-31" });
        assert.deepEqual(leaks(JSON.stringify(input), await needlesOf(Y)), [], `${X.name}'s spending shows ${Y.name}'s data`);
        assert.ok(input.bills.some(b => b.id === X.ids.billConfirmed) && !input.bills.some(b => b.id === X.ids.billPending), "the confirmed bill; the pending one waits in To check");
        assert.ok(input.charges.some(c => c.id === X.ids.charge) && !input.charges.some(c => c.id === X.ids.chargePending));
        assert.ok(input.cards.some(c => c.id === X.ids.card) && !input.cards.some(c => c.id === Y.ids.card));
        assert.ok(input.split.members.some(m => m.id === X.ids.aki) && !input.split.members.some(m => m.id === Y.ids.aki));
        assert.equal((await fingerprint(Y.hid)).text, yStart.text);
        assert.equal((await fingerprint(X.hid)).text, xStart.text, "a read writes nothing");
      }
    });

    // ---------------------------------------------------------------- Stage 17 import
    await check("importCharges: another household's card is refused, and a row like the other household's charge is new here; the other household is untouched", async () => {
      const bStart = await fingerprint(B.hid);
      await assert.rejects(F.importCharges(store, A.hid, B.ids.card, [{ date: "2026-11-12", merchant: "Isolation A imported", amountMinor: 2000, category: "food" }], { madeBy: "import" }),
        (e: unknown) => e instanceof Error && e.message === "Choose a card of this household");
      assert.equal((await fingerprint(B.hid)).text, bStart.text, "a refused import changed household B");
      const sameAsB = { date: "2026-11-12", merchant: "Isolation B market", amountMinor: 2000, category: "food" as const };
      assert.deepEqual(await F.importCharges(store, A.hid, A.ids.card, [sameAsB, { ...sameAsB, merchant: "Isolation A imported" }], { madeBy: "import" }), { added: 2, skipped: 0 },
        "B's charge with the same date, amount and name is not a duplicate on A's card");
      assert.equal((await fingerprint(B.hid)).text, bStart.text, "an import into A changed household B");
      assert.deepEqual(leaks((await fingerprint(B.hid)).text, { strings: ["Isolation A imported", A.ids.card], numbers: [] }), []);
    });

    // ---------------------------------------------------------------- Stage 18 varies
    await check("Stage 18 varies (D54): a real bill links only to its own household's series; linkToSeries, previewLink and updateBill refuse the other's series; the other household is untouched", async () => {
      const form = { madeBy: "form" as const };
      const gas = (over: object) => billInput.parse({ id: randomUUID(), biller: "Fictional Varies Gas", amount: "6000", due: "2026-12-10", category: "utilities", ...over });
      const bSeries = gas({ repeat: "month", amountVaries: true });
      await F.insertBill(store, B.hid, bSeries, "confirmed", form);
      const bStart = await fingerprint(B.hid);
      const aReal = gas({ biller: "Fictional Varies Gas 11月分", due: "2026-11-12", amount: "5400" });
      await F.insertBill(store, A.hid, aReal, "confirmed", form);
      const [aRow] = await db.select().from(schema.bills).where(and(eq(schema.bills.householdId, A.hid), eq(schema.bills.id, aReal.id)));
      assert.equal(aRow.seriesBillId, null, "A's bill did not join B's series");
      assert.equal(await F.linkToSeries(store, A.hid, aReal.id), null);
      assert.equal(await F.linkToSeries(store, A.hid, bSeries.id), null, "B's bill is not found from A");
      assert.equal(await F.previewLink(store, A.hid, { biller: "Fictional Varies Gas", category: "utilities", due: "2026-12-04" }), null, "A's review card sees no series of B's");
      await assert.rejects(F.updateBill(store, A.hid, billEditInput.parse({ id: aReal.id, biller: aRow.biller, amount: "5400", due: aRow.due, category: "utilities", seriesBillId: bSeries.id }), form),
        /Choose a monthly bill of this household/);
      assert.equal(await F.updateBill(store, A.hid, billEditInput.parse({ id: bSeries.id, biller: "Probe", amount: "1", due: "2026-12-10", category: "utilities", amountVaries: false }), form), false, "B's series cannot be edited from A");
      assert.equal((await fingerprint(B.hid)).text, bStart.text, "household B changed");
      // A's own series: the real bill links to it, and the preview names it, never B's.
      const aSeries = gas({ repeat: "month", amountVaries: true });
      await F.insertBill(store, A.hid, aSeries, "confirmed", form);
      assert.equal(await F.linkToSeries(store, A.hid, aReal.id), "Linked to Fictional Varies Gas: counts toward its estimate");
      assert.deepEqual(await F.previewLink(store, A.hid, { biller: "Fictional Varies Gas", category: "utilities", due: "2026-12-04" }),
        { seriesId: aSeries.id, biller: "Fictional Varies Gas", month: "2026-12", estimateMinor: 5_400 });
      assert.deepEqual((await F.previewLink(store, B.hid, { biller: "Fictional Varies Gas", category: "utilities", due: "2026-12-04" }))?.estimateMinor, 6_000, "B's estimate reads none of A's real bills");
      assert.equal((await fingerprint(B.hid)).text, bStart.text, "household B changed");
    });

    // ---------------------------------------------------------------- Stage 19 missing data
    await check("Stage 19 gaps (D55): fillGap and fillGapFromText fill only the household's own bill; another household's bill is not found and stays as it was", async () => {
      const form = { madeBy: "form" as const };
      const gap = billInput.parse({ id: randomUUID(), biller: "Fictional Gap Gas", amount: "", amountUnknown: true, due: "2026-12-10", category: "utilities" });
      await F.insertBill(store, B.hid, gap, "confirmed", form);
      const bStart = await fingerprint(B.hid);
      assert.equal(await F.fillGap(store, A.hid, gap.id, { amountMinor: 9_800 }, form), false, "A cannot fill B's bill");
      assert.equal(await F.fillGapFromText(store, A.hid, gap.id, { amount: "9800" }, form), false, "A cannot fill B's bill by text");
      assert.equal((await fingerprint(B.hid)).text, bStart.text, "household B changed");
      assert.equal(await F.fillGap(store, B.hid, gap.id, { amountMinor: 9_800 }, form), true, "B can fill its own");
    });

    // ---------------------------------------------------------------- the guard
    await check("every exported function in src/db is covered above or listed as not applicable, with a reason", () => {
      const found = new Map<string, string>();
      for (const file of readdirSync("src/db").filter(f => f.endsWith(".ts"))) {
        const source = readFileSync(`src/db/${file}`, "utf8");
        const names = [
          ...[...source.matchAll(/^export\s+(?:async\s+)?function\s+(\w+)/gm)].map(m => m[1]),
          ...[...source.matchAll(/^export\s+const\s+(\w+)\s*(?::[^=\n]+)?=\s*(?:async\s*)?(?:\([^)]*\)|\w+)\s*(?::\s*[^=\n]+)?=>/gm)].map(m => m[1]),
        ];
        for (const name of names) {
          assert.ok(!found.has(name), `${name} is exported by both ${found.get(name)} and ${file}; give them different names`);
          found.set(name, file);
        }
      }
      assert.ok(found.size >= 80, `the scan found only ${found.size} functions`);
      const listed = new Set(covered), reasons = Object.keys(notApplicable);
      assert.equal(listed.size, covered.length, "a name is listed twice in covered");
      for (const name of reasons) assert.ok(notApplicable[name].length > 8, `${name} needs a reason`);
      const both = reasons.filter(n => listed.has(n));
      assert.deepEqual(both, [], "in both lists: " + both.join(", "));
      const missing = [...found].filter(([name]) => !listed.has(name) && !reasons.includes(name)).map(([name, file]) => `${name} (${file})`);
      assert.deepEqual(missing, [], "src/db functions with no isolation test and no reason: " + missing.join(", "));
      const stale = [...listed, ...reasons].filter(name => !found.has(name));
      assert.deepEqual(stale, [], "listed here but not exported by src/db any more: " + stale.join(", "));
      const unexercised = covered.filter(name => !used.has(name));
      assert.deepEqual(unexercised, [], "listed as covered but never called by this test: " + unexercised.join(", "));
      const unlisted = [...used].filter(name => !listed.has(name));
      assert.deepEqual(unlisted, [], "called by this test but not listed as covered: " + unlisted.join(", "));
      console.log(`  ${covered.length} covered, ${reasons.length} not applicable, ${found.size} exported functions in src/db`);
    });

    console.log(`Isolation checks passed (${passed}).`);
  } finally {
    for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    await pg.close();
  }
}

main().catch(error => {
  console.error("Isolation tests failed", error);
  process.exit(1);
});
