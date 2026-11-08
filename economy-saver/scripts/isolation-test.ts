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
import * as askMod from "@/db/ask"; // D60 Ask
import * as canvasesMod from "@/db/canvases"; // D57 pins
import * as conversationMod from "@/db/conversation"; // D60 conversation
import * as askReceiptsMod from "@/db/ask-receipts"; // D59 ask receipts
import * as dataKindsMod from "@/db/data-kinds"; // D59 delete by kind
import * as restoreMod from "@/db/restore"; // D59 import
import * as placeMod from "@/db/place"; // D59 this device only
import * as approval from "@/db/approval";
import * as bankBalance from "@/db/bank-balance";
import * as billsMod from "@/db/bills";
import * as chargesMod from "@/db/charges";
import * as clientsMod from "@/db/clients";
import * as confirm from "@/db/confirm";
import * as daily from "@/db/daily";
import * as rulesMod from "@/db/rules";
import * as suggestionsMod from "@/db/suggestions";
import * as demo from "@/db/demo";
import * as documentCardMod from "@/db/document-card"; // D61 Ask documents
import * as documentCleanup from "@/db/document-cleanup";
import * as eventFeed from "@/db/event-feed";
import * as familyLinksMod from "@/db/family-links";
import * as household from "@/db/household";
import * as importChargesMod from "@/db/import-charges"; // Stage 17 import
import * as invoiceDraft from "@/db/invoice-draft";
import * as invoicePaid from "@/db/invoice-paid";
import * as mcpTokens from "@/db/mcp-tokens";
import * as memoryMod from "@/db/memory"; // D58 memory
import * as paypalImport from "@/db/paypal-import";
import * as paypalRefresh from "@/db/paypal-refresh";
import * as people from "@/db/people";
import * as potsMod from "@/db/pots";
import * as rateLimit from "@/db/rate-limit";
import * as readerInbox from "@/db/reader-inbox";
import * as remindersMod from "@/db/reminders";
import * as readerJob from "@/db/reader-job";
import * as readings from "@/db/readings";
import * as referenceRate from "@/db/reference-rate";
import * as runwayEvents from "@/db/runway-events";
import * as settingsMod from "@/db/settings";
import * as settle from "@/db/settle";
import * as snapshotMod from "@/db/snapshot";
import * as statementCharge from "@/db/statement-charge";
import * as spendingMod from "@/db/spending"; // Stage 17 spending
import * as fxCostMod from "@/db/fx-cost"; // D62 foreign costs
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
import { resolveCanvasRequest } from "@/lib/canvas/request"; // D57 canvas
import { CanvasError } from "@/lib/canvas/resolve";

// ------------------------------------------------------------------ what the guard compares against
// Every exported function in src/db, in exactly one of the two lists. `covered` names are also checked to have been
// called through the tracked module object F below, so a name cannot sit here without a test behind it.
const covered = [
  // account.ts
  "householdClock", "householdDate", "accountHousehold", "createHousehold", "finishSetup", "deleteOwnedHousehold",
  // ai-key.ts
  "aiConnection", "saveHouseholdConnection", "deleteHouseholdConnection", "connectionView", "deleteHouseholdKey",
  // approval.ts
  "invoiceReview", "approveInvoice",
  // bank-balance.ts, bills.ts, charges.ts, clients.ts, confirm.ts
  "setBankBalance", "confirmBalanceUpdate", "insertBill", "removeBill", "updateBill", "insertCharge", "removeCharge", "insertClient", "confirmPending",
  // daily.ts, demo.ts, document-cleanup.ts, event-feed.ts
  "runDaily", "findDemoHousehold", "tryItKind", "resetDemoHousehold", "deleteDemoHousehold", "sweepDemoHouseholds", "removeHouseholdDocuments", "eventFeed",
  // D64–D66 suggestions and standing rules
  "seedRules", "rulesFor", "setStandingRule", "runPass", "openSuggestions", "dismiss", "notNow", "closeByRef",
  // D65 reminders.ts
  "reminderView", "saveReminderSettings", "subscribeReminder", "unsubscribeReminder", "sendTestReminder", "runReminders",
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
  "loadSpending", "loadPeriodBills",
  // D62 foreign costs: fx-cost.ts
  "foreignCostInputs", "foreignCosts",
  // Stage 18 varies: bills.ts
  "linkToSeries", "previewLink",
  // Stage 19 missing data (D55): bills.ts
  "fillGap", "fillGapFromText",
  // D58 memory: memory.ts
  "listMemory", "addMemory", "editMemory", "deleteMemory", "forgetEverything",
  // D57 pins: canvases.ts; D60 conversation: conversation.ts and ask.ts; rate-limit.ts
  "listCanvases", "pinCanvas", "updateCanvas", "moveCanvas", "unpinCanvas",
  "saveTurn", "turnById", "recentTurns", "latestConversation", "allTurns", "setThumb", "conversationContext", "firstUseLine", "requestCount",
  // D59 ask-receipts.ts
  "noteAskWrote", "noteAskReply", "askReceipt", "pruneAskReceipts",
  // D61 document-card.ts
  "documentCard", "attachDocument",
  // 27E document-cleanup.ts: Storage bytes and the removal of old raw files
  "storedBytes", "requireStorageRoom", "removeExpiredFiles",
  // D59 data-kinds.ts and restore.ts
  "countKind", "countKinds", "deleteKind", "deleteOne", "deleteTurn", "deleteConversation", "deleteDocument", "restoreHousehold",
  // D59 place.ts (24B)
  "readPlaces", "requireCloud", "itemsToMove", "moveToDevice", "moveToCloud",
];

const notApplicable: Record<string, string> = {
  foreignFeeBp: "pure parser of a typed fee percentage into basis points, no database (D62)",
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
  clientIp: "pure reader of a request header; no database", hashIp: "pure SHA-256 of an address; no database",
  consumeIpRequest: "counts per hashed client address before any household exists; no household id, no household rows (limits-test)",
  pruneIpBuckets: "deletes old per-address windows app-wide; touches no household's rows (limits-test)",
  readDocumentInBackground: "opens its own connection and calls readDocument, which is tested here",
  staleBefore: "pure clock helper",
  requireReaderModel: "reads only the calling household's own connection (connectionView) and the server settings; its refusals are tested in ask-routes-test",
  storeDocument: "creates a document keyed by a digest that includes the household id; needs Supabase Storage",
  parseReferenceRate: "pure parser of the ECB feed", fetchReferenceRate: "network fetch of the public ECB feed; no household id",
  sandboxRead: "PayPal sandbox HTTP reader; takes no household id",
  isMovable: "pure check that a value is one of the three movable kind names", contextText: "pure text from turns passed in; conversationContext, which reads them, is covered above",
  dueHouseholds: "global Cron scheduler selector, restricted to non-demo households and tested in cron-test",
  dueReminderHouseholds: "global Cron selector for already-scanned non-demo households, tested in notify-test",
  defaultRules: "pure default values for standing rules, no database",
  seedBen: "creates a new household with a fresh id; touches no existing household",
  sealAiKey: "pure: seals a key text for the household id it is given; the isolation check below proves a key sealed for one household does not open for another", unsealAiKey: "pure: opens a sealed key for the household id it is given; same check",
  isDataKind: "pure check that a value is one of the five kind names", readSnapshotFile: "pure parse of a file passed in; restoreHousehold, which calls it, is covered above",
};

// ------------------------------------------------------------------ helpers
type Needles = { strings: string[]; numbers: number[] };
type Outcome = { threw: boolean; error?: unknown; value?: unknown };
type Ids = {
  owner: string; aki: string; card: string; client: string; billConfirmed: string; billPending: string; charge: string; chargePending: string;
  pot: string; potPending: string; balanceConfirmed: string; balancePending: string; invoiceDraft: string; invoiceSent: string; approveKey: string;
  paypalInvoice: string; document: string; documentFailed: string; documentRead: string; reading: string; settlement: string; token: string;
  suggestion: string; statement: string; webhookEvent: string; secret: string; user: string; authUid: string; familyLink: string; memory: string; canvas: string; turn: string;
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
    ...fxCostMod, // D62 foreign costs
    ...rulesMod, ...suggestionsMod, ...remindersMod, // D64–D66
    ...memoryMod, // D58 memory
    ...askMod, ...askReceiptsMod, ...canvasesMod, ...conversationMod, ...documentCardMod, // D57 pins, D60 conversation, D61 Ask documents
    ...dataKindsMod, ...restoreMod, ...placeMod, // D59 delete by kind, import, where a kind is kept
  };
  const F = new Proxy(modules, {
    get(target, key: string) {
      const value = target[key as keyof typeof target];
      if (typeof value === "function") used.add(key);
      return value;
    },
  });

  const saved = Object.fromEntries(["PAYPAL_ENVIRONMENT", "PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET", "MCP_TOKEN_KEY", "PAYPAL_BALANCE_HOUSEHOLD_ID", "AI_TEXT_MODEL"].map(k => [k, process.env[k]]));
  try {
    process.env.PAYPAL_ENVIRONMENT = "SANDBOX";
    process.env.PAYPAL_CLIENT_ID = "fictional-test-client";
    process.env.PAYPAL_CLIENT_SECRET = "fictional-test-secret";
    process.env.AI_TEXT_MODEL = "fixture-text";
    process.env.MCP_TOKEN_KEY = randomBytes(32).toString("base64url");
    process.env.AI_KEY_SEAL_KEY = randomBytes(32).toString("base64url"); // fictional test seal key (a household's saved AI key is sealed with it)
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
      // 27E: ip_buckets (hashed client address) and ai_global_usage (one row a day) exist before and outside any household, and hold no household data.
      assert.deepEqual(everyTable.filter(t => !scoped.includes(t)), ["ai_global_usage", "households", "ip_buckets"]);
      for (const table of ["bills", "charges", "pots", "members", "clients", "invoices", "documents", "readings", "cards", "card_statements", "settlements",
        "balance_updates", "events", "api_tokens", "family_links", "webhook_deliveries", "request_buckets", "fx_rates", "paypal_connections", "users", "rules", "suggestions", "reminder_settings", "push_subscriptions", "reminders"]) {
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
      const authUid = randomUUID();
      const user = one(await db.insert(schema.users).values({ householdId: hid, memberId: ownerRow.id, authUserId: authUid }).returning({ id: schema.users.id })).id;
      const webhookEvent = `ISO-${tag}-EVT-1`;
      await F.recordWebhookDelivery(db, hid, { paypalEventId: webhookEvent, eventType: "PAYMENT.SALE.COMPLETED", verified: true, payload: { note: `${T} payload` } });
      const issued = await F.issueMcpToken(db, hid, { name: `${T} token`, scopes: ["read"] });
      const family = await F.createFamilyLink(db, hid);
      const key = `sk-ant-isolation-${l}-${"k".repeat(24)}`;
      await F.saveHouseholdConnection(db, hid, { provider: "openai", baseUrl: "", textModel: `iso-text-${l}`, documentModel: "", sameForDocuments: true, key }, { signedIn: true, check: async () => ({ at: new Date().toISOString(), passed: ["uses_tools", "ignores_injection", "stays_on_money"], failed: [] }) });
      const secret = one(await db.select({ id: schema.households.aiKeySecretId }).from(schema.households).where(eq(schema.households.id, hid))).id!;
      await F.consumeRequest(db, hid, "ask");
      const memory = (await F.addMemory(db, hid, { kind: "fact", text: `${T} remembers a quiet month` }, { madeBy: "form" })).id;
      const canvas = (await F.pinCanvas(db, hid, { title: `${T} canvas`, recipe: { version: 1, title: `${T} canvas`, blocks: [{ type: "number", label: "Cash today", query: { q: "cash" } }] } }, { madeBy: "form" })).id;
      const turn = crypto.randomUUID();
      await F.saveTurn(db, hid, { id: turn, conversationId: crypto.randomUUID(), question: `${T} asks`, kind: "declined", reply: `${T} reply`, choices: null, recipe: null, sources: [] });
      await F.setThumb(db, hid, turn, 1);
      await F.noteAskWrote(db, hid, crypto.randomUUID());
      await F.consumeRequest(db, hid, "thumb", 5, "hour");
      assert.equal(await F.requestCount(db, hid, "thumb", "hour"), 1);
      await F.recordEvent(db, hid, { madeBy: "form", kind: `isolation_${l}_event`, title: `${T} event`, body: `${T} event body`, notify: true });
      await F.setStandingRule(store, hid, "nudge_after", { enabled: true, threshold: tag === "A" ? 3 : 4, currency: null });
      await F.runPass(store, hid);
      const suggestion = one((await F.openSuggestions(store, hid)).filter(row => row.kind === "invoice_nudge" && row.refId === sent.id)).id;
      const member = { householdId: hid, memberId: ownerRow.id };
      await db.insert(schema.reminderSettings).values(member);
      await db.insert(schema.pushSubscriptions).values({ ...member, endpoint: "https://push.example.test/" + tag, p256dh: "test-" + tag, auth: "test-" + tag });
      await db.insert(schema.reminders).values({ ...member, channel: "push", day: "2026-11-13", status: "sent", suggestionIds: [suggestion] });
      return {
        hid, tag, name: T, bankYen, rateMicro, key, tokenString: issued.token, familyToken: family.token, akiName,
        ids: { owner: ownerRow.id, aki, card: card.id, client, billConfirmed, billPending, charge, chargePending, pot, potPending, balanceConfirmed, balancePending,
          invoiceDraft, invoiceSent: sent.id, approveKey: sent.approveKey, paypalInvoice, document, documentFailed, documentRead, reading, settlement, token: issued.info.id,
          suggestion, statement, webhookEvent, secret, user, authUid, familyLink: family.info.id, memory, canvas, turn },
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
        assert.ok(fp.rules.length === 7 && fp.fx_rates.length === 1 && fp.vault.length === 1);
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
      can_i_spend: { amount_minor: 1_000 }, timeline: { scenario: "late" }, plan_for: { target_minor: 100_000, target_date: "2027-06-01" }, bills_for_month: { month: "2026-11" },
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
      seen("loadHouseholdSnapshot with the stored kinds", await F.loadHouseholdSnapshot(store, hid, { events: true, stored: true }));
      seen("loadHouseholdSnapshot recent", await F.loadHouseholdSnapshot(store, hid, { events: false, recent: 3 }));
      const review = await F.invoiceReview(store, hid, viewer.ids.invoiceSent);
      seen("invoiceReview", review);
      assert.equal(review?.invoice.id, viewer.ids.invoiceSent);
      assert.equal(await F.invoiceReview(store, hid, other.ids.invoiceSent), undefined);
      assert.equal(await F.invoiceReview(store, hid, other.ids.invoiceDraft), undefined);
      assert.equal(await F.canImportPayPal(store, hid), false);
      const memory = await F.listMemory(store, hid);
      seen("listMemory", memory);
      const pins = await F.listCanvases(store, hid);
      seen("listCanvases", pins);
      assert.deepEqual(pins.map(p => p.id), [viewer.ids.canvas], "the viewer's pins are the viewer's alone");
      const turns = await F.allTurns(store, hid);
      seen("allTurns", turns);
      assert.deepEqual(turns.map(t => t.id), [viewer.ids.turn], "the viewer's turns are the viewer's alone");
      const mine = await F.latestConversation(store, hid);
      seen("latestConversation", mine);
      assert.deepEqual(mine?.turns.map(t => t.id), [viewer.ids.turn]);
      assert.equal((await F.turnById(store, hid, viewer.ids.turn))?.id, viewer.ids.turn);
      seen("turnById", await F.turnById(store, hid, viewer.ids.turn));
      const receiptId = randomUUID();
      await F.noteAskWrote(store, hid, receiptId);
      await F.noteAskWrote(store, hid, receiptId);
      assert.equal(await F.askReceipt(store, hid, receiptId) !== null, true);
      await F.noteAskReply(store, hid, receiptId, { pending: true, links: [{ label: "Open To check", href: "http://127.0.0.1:3123/to-check" }] });
      assert.deepEqual(await F.askReceipt(store, hid, receiptId), { pending: true, links: [{ label: "Open To check", href: "http://127.0.0.1:3123/to-check" }] });
      assert.equal(await F.askReceipt(store, other.hid, receiptId), null, "another household's note is not seen by this id");
      assert.equal(await F.askReceipt(store, other.hid, receiptId) !== null, false, "another household's receipt is not seen by this id");
      assert.equal(await F.pruneAskReceipts(store, hid), 0, "a receipt under a day old stays");
      await pg.query("update ask_receipts set created_at = now() - interval '2 days' where household_id = $1 and ask_id = $2", [hid, receiptId]);
      const otherBefore = (await db.select().from(schema.askReceipts).where(eq(schema.askReceipts.householdId, other.hid))).length;
      assert.equal(await F.pruneAskReceipts(store, hid), 1);
      assert.equal((await db.select().from(schema.askReceipts).where(eq(schema.askReceipts.householdId, other.hid))).length, otherBefore, "pruning one household leaves the other's");
      assert.equal(await F.askReceipt(store, hid, receiptId) !== null, false);
      assert.equal(await F.turnById(store, hid, other.ids.turn), null, "another household's turn id reads nothing");
      assert.deepEqual(await F.recentTurns(store, hid, other.ids.turn), [], "another household's conversation id reads nothing");
      assert.deepEqual(await F.conversationContext(store, hid, { conversationId: mine!.conversationId, canvas: null }), `Earlier in this conversation, for context only; read every number again from the tools:\nQuestion: ${JSON.stringify(turns[0].question)}\nReply: ${JSON.stringify(turns[0].reply)}`);
      seen("conversationContext", turns);
      seen("firstUseLine", await F.firstUseLine(store, hid));
      const view = await F.connectionView(store, hid);
      seen("connectionView", view);
      assert.equal(view?.textModel, `iso-text-${viewer.tag.toLowerCase()}`);
      assert.deepEqual(memory.map(m => m.id), [viewer.ids.memory], "the viewer's memory is the viewer's alone");
      assert.equal((await F.rulesFor(store, hid)).nudge_after.threshold, viewer.tag === "A" ? 3 : 4);
      const suggestions = await F.openSuggestions(store, hid);
      assert.ok(suggestions.some(row => row.id === viewer.ids.suggestion && row.refId === viewer.ids.invoiceSent));
      seen("openSuggestions", suggestions);
      const suggestionsTool = tools.find(tool => tool.name === "suggestions")!;
      assert.equal(suggestionsTool.scope, "read");
      const mcpSuggestions = JSON.parse(await suggestionsTool.run({ ...toolContext(viewer), madeBy: "mcp" }, {} as never));
      assert.deepEqual(mcpSuggestions, suggestions, "MCP returns the same household's open suggestions");
      seen("MCP suggestions", mcpSuggestions);
      // The agent's read tools, with this household's context.
      for (const tool of tools.filter(x => x.scope === "read" && x.name !== "make_canvas")) {
        const input = tool.name === "what_if" ? { case: "late", changes: [{ kind: "client_late", clientId: viewer.ids.client, days: 3 }] } : toolInputs[tool.name] ?? {};
        seen(`agent tool ${tool.name}`, await runTool(viewer, tool.name, input));
      }
      seen("agent tool make_canvas", await runTool(viewer, "make_canvas", { recipe: JSON.stringify({ version: 1, title: "Cash", blocks: [{ type: "number", label: "Cash today", query: { q: "cash" } }, { type: "sliders", controls: [{ clientId: viewer.ids.client, maxDays: 14 }] }] }) }));
      await assert.rejects(runTool(viewer, "what_if", { case: "late", changes: [{ kind: "client_late", clientId: other.ids.client, days: 3 }] }), /not in your records/);
      await assert.rejects(runTool(viewer, "make_canvas", { recipe: JSON.stringify({ version: 1, title: "x", blocks: [{ type: "sliders", controls: [{ clientId: other.ids.client, maxDays: 14 }] }] }) }), /client/);
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

      await check(label("suggestion actions ignore the other household's suggestion and action reference"), async () => {
        await refuse("dismiss", () => F.dismiss(store, X.hid, y.suggestion));
        await refuse("notNow", () => F.notNow(store, X.hid, y.suggestion));
        await refuse("closeByRef", () => db.transaction(tx => F.closeByRef(tx as unknown as Db, X.hid, y.invoiceSent, ["remind"])));
      });
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
        const item = { kind: "charge" as const, name: "Isolation probe", date: "2026-11-12", amountMinor: 100, currency: "JPY" as const, category: "other" as const, businessBp: 0, cardId: null, repeat: null, nextAmountMinor: null, nextAmountFrom: null, cancelBy: null, repeatUntil: null };
        await refuse("reviewReading reject", () => F.reviewReading(store, X.hid, y.reading, null));
        await refuse("reviewReading confirm", () => F.reviewReading(store, X.hid, y.reading, { ...item, cardId: x.card }));
        await refuse("reviewReading confirm with answers (Ask)", () => F.reviewReading(store, X.hid, y.reading, { ...item, cardId: x.card }, {}, false, []));
        await refuse("reviewReading confirm and remember", () => F.reviewReading(store, X.hid, y.reading, { ...item, cardId: x.card }, {}, true));
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
      await check(`${X.name} -> ${Y.name}: memory (edit, delete, forget everything) and the canvas route's function refuse the other's ids`, async () => {
        const by = { madeBy: "form" } as const;
        await refuse("editMemory text", () => F.editMemory(store, X.hid, y.memory, { text: "Isolation probe" }, by));
        await refuse("editMemory kind", () => F.editMemory(store, X.hid, y.memory, { kind: "goal" }, by));
        await refuse("deleteMemory", () => F.deleteMemory(store, X.hid, y.memory, by));
        assert.deepEqual((await F.listMemory(store, X.hid)).map(m => m.id), [x.memory], "X still sees only its own item");
        const yText = (await F.listMemory(store, Y.hid)).map(m => m.text);
        const added = await F.addMemory(store, X.hid, { kind: "fact", text: yText[0] }, by);
        assert.notEqual(added.id, y.memory, "the same words in X are X's own item, not Y's");
        await untouched("addMemory with the other's words");
        assert.equal(await F.deleteMemory(store, X.hid, added.id, by), true);
        assert.equal(await F.forgetEverything(store, X.hid, by), 1, "forgetEverything counts only X's items");
        await untouched("forgetEverything");
        assert.equal((await F.addMemory(store, X.hid, { kind: "fact", text: `${X.name} remembers a quiet month` }, by)).kind, "fact");
        const recipe = (change: object) => ({ recipe: { version: 1, title: "Probe", blocks: [{ type: "sentence", query: { q: "sentence", scenario: { case: "usual", changes: [change] } } }] } });
        const refusedCanvas = async (name: string, body: unknown) => {
          const outcome = await attempt(() => resolveCanvasRequest(store, X.hid, body));
          assert.ok(outcome.threw && outcome.error instanceof CanvasError, label("canvas " + name) + " was not refused");
          await untouched("canvas " + name);
        };
        await refusedCanvas("client_late for the other's client", recipe({ kind: "client_late", clientId: y.client, days: 3 }));
        await refusedCanvas("remove_bill of the other's bill", recipe({ kind: "remove_bill", billId: y.billConfirmed }));
        await refusedCanvas("change_bill of the other's bill", recipe({ kind: "change_bill", billId: y.billPending, amountMinor: 5 }));
        await refusedCanvas("a slider on the other's client", { recipe: { version: 1, title: "Probe", blocks: [{ type: "sliders", controls: [{ clientId: y.client, maxDays: 10 }] }] } });
        assert.ok((await resolveCanvasRequest(store, X.hid, recipe({ kind: "client_late", clientId: x.client, days: 3 }))).length === 1, "its own client is accepted");
        const drawn = JSON.stringify(await resolveCanvasRequest(store, X.hid, { recipe: { version: 1, title: "Probe", blocks: [{ type: "sentence", query: { q: "sentence" } }, { type: "timeline", query: { q: "events" } }] } }));
        assert.deepEqual(leaks(drawn, needles), [], "a drawn canvas shows none of the other's data");
        await untouched("canvas drawn");
      });
      await check(`${X.name} -> ${Y.name}: delete by kind and delete one (D59) count and remove only the caller's own, and Import refuses a household with data`, async () => {
        const by = { madeBy: "form" } as const;
        const noStorage = { remove: async () => { throw new Error("Storage must not be touched for another household's document"); } };
        const counts = await F.countKinds(store, X.hid);
        assert.deepEqual([counts.memory, counts.canvases, counts.journal], [1, 1, 1], "X counts its own items, not Y's");
        assert.equal(await F.countKind(store, X.hid, "documents"), 3);
        assert.equal(await F.deleteOne(store, X.hid, "memory", y.memory, by), false);
        assert.equal(await F.deleteOne(store, X.hid, "canvases", y.canvas, by), false);
        assert.equal(await F.deleteOne(store, X.hid, "journal", y.turn, by), false);
        assert.equal(await F.deleteTurn(store, X.hid, y.turn), false);
        assert.equal(await F.deleteConversation(store, X.hid, (await F.allTurns(store, Y.hid))[0].conversationId), 0);
        for (const id of [y.document, y.documentFailed, y.documentRead]) {
          assert.equal(await F.deleteOne(store, X.hid, "documents", id, by, noStorage), false);
          assert.equal(await F.deleteDocument(store, X.hid, id, by, noStorage), false);
        }
        await untouched("data-kinds deletes of the other's ids");
        await mustThrow("deleteKind record", () => F.deleteKind(store, X.hid, "record", by));
        await mustThrow("deleteOne record", () => F.deleteOne(store, X.hid, "record", y.billConfirmed, by));
        await untouched("the record is refused by kind");
        assert.equal(await F.deleteKind(store, X.hid, "memory", by), 1, "X's kind delete removes only X's one item");
        await untouched("deleteKind memory");
        assert.equal((await F.addMemory(store, X.hid, { kind: "fact", text: `${X.name} remembers a quiet month` }, by)).kind, "fact");
        await mustThrow("restoreHousehold into a household with data", () => F.restoreHousehold(store, X.hid, { version: 2 }));
        const file = await F.loadHouseholdSnapshot(store, Y.hid, { events: false, stored: true });
        await mustThrow("restoreHousehold of the other's file into a household with data", () => F.restoreHousehold(store, X.hid, JSON.parse(JSON.stringify(file))), /empty household/);
        await untouched("restoreHousehold refused");
      });
      await check(`${X.name} -> ${Y.name}: the Anthropic key (Vault) cannot be reached through a wrong pointer`, async () => {
        const own = one(await db.select({ id: schema.households.aiKeySecretId }).from(schema.households).where(eq(schema.households.id, X.hid))).id!;
        try {
          // Corrupt X's pointer so that it names the other household's secret; every path must still refuse.
          await db.update(schema.households).set({ aiKeySecretId: y.secret }).where(eq(schema.households.id, X.hid));
          const reading = await attempt(() => F.aiConnection(store, X.hid, "text"));
          assert.ok(reading.threw && reading.error instanceof AiKeyError, "aiConnection must not return the other household's key");
          await untouched("aiConnection through a wrong pointer");
          await mustThrow("saveHouseholdConnection through a wrong pointer", () => F.saveHouseholdConnection(store, X.hid, { provider: "openai", baseUrl: "", textModel: "iso-text", documentModel: "", sameForDocuments: true, key: "probe-" + "z".repeat(24) }, { signedIn: true, check: async () => ({ at: new Date().toISOString(), passed: ["uses_tools", "ignores_injection", "stays_on_money"], failed: [] }) }), /ownership/);
          await mustThrow("deleteHouseholdKey through a wrong pointer", () => db.transaction(tx => F.deleteHouseholdKey(tx as unknown as Db, X.hid)), /ownership/);
        } finally {
          await db.update(schema.households).set({ aiKeySecretId: own }).where(eq(schema.households.id, X.hid));
        }
        assert.equal((await F.aiConnection(store, X.hid, "text")).key, X.key, "the household's own key is returned when the pointer is right");
        assert.notEqual((await F.aiConnection(store, X.hid, "text")).key, Y.key);
      });
      await check(`${X.name} -> ${Y.name}: pins and turns refuse the other's ids, and thumbs, moves and unpins change nothing there`, async () => {
        const by = { madeBy: "form" } as const;
        assert.equal(await F.updateCanvas(store, X.hid, y.canvas, { version: 1, title: "Hijack", blocks: [{ type: "number", label: "Cash", query: { q: "cash" } }] }, by), false);
        assert.equal(await F.moveCanvas(store, X.hid, y.canvas, "down", by), false);
        assert.equal(await F.unpinCanvas(store, X.hid, y.canvas, by), false);
        assert.equal(await F.setThumb(store, X.hid, y.turn, -1), false);
        assert.deepEqual((await F.listCanvases(store, X.hid)).map(p => p.id), [x.canvas]);
        assert.deepEqual((await F.listCanvases(store, Y.hid)).map(p => p.id), [y.canvas], "Y's pin is still there");
        assert.equal((await F.allTurns(store, Y.hid))[0].thumb, 1, "Y's thumb is unchanged");
        const rows = await F.pinCanvas(store, X.hid, { title: "Second", recipe: { version: 1, title: "Second", blocks: [{ type: "number", label: "Cash", query: { q: "cash" } }] } }, by);
        assert.equal(rows.position, 1, "X's second pin is X's second, whatever Y holds");
        await F.unpinCanvas(store, X.hid, rows.id, by);
      });
      await check(`${X.name} -> ${Y.name}: a file attached in Ask (D61) is X's own, the other's document card is gone, and the other's turn id is not taken over`, async () => {
        const gone = await F.documentCard(store, X.hid, y.documentRead);
        assert.equal(gone.status, "gone");
        assert.equal(gone.words, "This file was deleted.");
        assert.deepEqual(gone.items, []);
        assert.ok(!JSON.stringify(gone).includes(Y.name) && !JSON.stringify(gone).includes("reading"), "nothing of the other's reading is in the card");
        assert.equal((await F.documentCard(store, X.hid, "not-a-uuid")).status, "gone");
        assert.equal((await F.documentCard(store, Y.hid, y.documentRead)).items.length, 1, "the owner sees its own reading");
        const names = { SUPABASE_URL: "https://storage.example", SUPABASE_SERVICE_ROLE_KEY: "fictional-test-value", SUPABASE_DOCUMENT_BUCKET: "fictional-documents" };
        const savedEnv = Object.fromEntries(Object.keys(names).map(k => [k, process.env[k]]));
        const savedFetch = globalThis.fetch;
        Object.assign(process.env, names);
        globalThis.fetch = async (input, init) => {
          const request = new Request(input, init);
          if (request.url.includes("/bucket/")) return Response.json({ name: "fictional-documents", public: false });
          if (request.method === "POST") { await request.blob(); return Response.json({ Key: "ok" }); }
          throw new Error("Unexpected storage operation");
        };
        try {
          const before = await fingerprint(Y.hid);
          const bytes = new TextEncoder().encode("%PDF-1.7 isolation probe").buffer as ArrayBuffer;
          const mine = await F.attachDocument(store, X.hid, { id: randomUUID(), conversationId: randomUUID(), text: null, mime: "application/pdf", bytes });
          assert.equal((await fingerprint(Y.hid)).text, before.text, "attaching for X changed nothing of Y's rows");
          assert.equal((await F.documentCard(store, X.hid, mine.documentId)).status, "reading");
          assert.equal((await F.documentCard(store, Y.hid, mine.documentId)).status, "gone", "Y cannot see X's new document");
          const stolen = await F.attachDocument(store, X.hid, { id: y.turn, conversationId: randomUUID(), text: "mine", mime: "application/pdf", bytes: new TextEncoder().encode("%PDF-1.7 isolation probe two").buffer as ArrayBuffer });
          assert.equal(stolen.turn.id, y.turn);
          assert.equal((await fingerprint(Y.hid)).text, before.text, "a turn id already used by Y leaves Y's rows exactly as they were");
        } finally {
          globalThis.fetch = savedFetch;
          for (const [k, v] of Object.entries(savedEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
        }
      });
      await check(`${X.name} -> ${Y.name}: moving a kind to the device and back (D59) takes and sets only the caller's own, and a changed set moves nothing`, async () => {
        const by = { madeBy: "form" } as const;
        const taken = await F.itemsToMove(store, X.hid, "memory") as { id: string }[];
        assert.ok(taken.length > 0 && taken.every(item => item.id !== y.memory), "X takes only its own items");
        await refuse("moveToDevice with the other's ids", () => F.moveToDevice(store, X.hid, "memory", [y.memory], by));
        await untouched("moveToDevice with the other's ids");
        assert.equal((await F.readPlaces(store, X.hid)).memory, "cloud");
        assert.equal(await F.moveToDevice(store, X.hid, "memory", taken.map(item => item.id), by), taken.length);
        assert.deepEqual([(await F.readPlaces(store, X.hid)).memory, (await F.readPlaces(store, Y.hid)).memory], ["device", "cloud"], "only X's place changed");
        await untouched("moveToDevice");
        assert.ok((await F.listMemory(store, Y.hid)).length > 0, "Y's memory is still in the cloud");
        await mustThrow("requireCloud for a kind on the device", () => F.requireCloud(store, X.hid, "memory"), /on this device only/);
        await F.requireCloud(store, Y.hid, "memory");
        assert.equal(await F.moveToCloud(store, X.hid, "memory", taken, by), taken.length);
        assert.deepEqual((await F.listMemory(store, X.hid)).map(m => m.id).sort(), taken.map(item => item.id).sort(), "X's items are back, with their ids");
        await untouched("moveToCloud");
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

    await check("seeding standing rules writes only to the newly created household", async () => {
      const beforeA = await fingerprint(A.hid), beforeB = await fingerprint(B.hid);
      const hid = randomUUID();
      await db.insert(schema.households).values({ id: hid, name: "Fictional rule fixture", homeCurrency: "USD" });
      await F.seedRules(store, hid);
      assert.equal((await db.select().from(schema.rules).where(eq(schema.rules.householdId, hid))).length, 6);
      assert.equal((await fingerprint(A.hid)).text, beforeA.text);
      assert.equal((await fingerprint(B.hid)).text, beforeB.text);
      await F.deleteHousehold(store, hid);
    });

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
    await check("a saved AI key sealed for household A does not open for household B, and a bill's billing period (27F) is read for its own household only", async () => {
      const sealed = await aiKeys.sealAiKey(A.hid, "fictional-key-value");
      assert.equal(await aiKeys.unsealAiKey(A.hid, sealed), "fictional-key-value");
      await assert.rejects(aiKeys.unsealAiKey(B.hid, sealed));
      const [aPeriod, bPeriod] = [randomUUID(), randomUUID()];
      await db.insert(schema.bills).values([
        { id: aPeriod, householdId: A.hid, biller: "Fictional A Power", amountMinor: 4_000, currency: "JPY", due: "2026-12-02", category: "utilities", periodStart: "2026-11-01", periodEnd: "2026-11-30" },
        { id: bPeriod, householdId: B.hid, biller: "Fictional B Power", amountMinor: 5_000, currency: "JPY", due: "2026-12-03", category: "utilities", periodStart: "2026-10-01", periodEnd: "2026-10-31" },
      ]);
      const periods = async (hid: string) => (await F.loadMoneyState(store, hid, DEMO_DATE)).bills.filter(b => b.periodStart !== undefined).map(b => [b.biller, b.periodStart, b.periodEnd]);
      assert.deepEqual(await periods(A.hid), [["Fictional A Power", "2026-11-01", "2026-11-30"]]);
      assert.deepEqual(await periods(B.hid), [["Fictional B Power", "2026-10-01", "2026-10-31"]]);
      const snapA = await snapshotMod.loadHouseholdSnapshot(db, A.hid, { events: false, stored: false });
      assert.deepEqual(snapA.bills.filter(b => b.periodStart).map(b => b.biller), ["Fictional A Power"], "the export carries only A's period");
      // D63 loadPeriodBills: only this household's bills with a period; the month narrows to the overlap; a read writes nothing.
      for (const [X, Y, month, other] of [[A, B, "2026-11", "2026-10"], [B, A, "2026-10", "2026-11"]] as const) {
        const [xStart, yStart] = [await fingerprint(X.hid), await fingerprint(Y.hid)];
        const all = await F.loadPeriodBills(store, X.hid), inMonth = await F.loadPeriodBills(store, X.hid, month), inOther = await F.loadPeriodBills(store, X.hid, other);
        assert.deepEqual([all.map(b => b.biller), inMonth.map(b => b.biller), inOther], [[`Fictional ${X.tag} Power`], [`Fictional ${X.tag} Power`], []], `${X.name}'s period bills`);
        assert.deepEqual(leaks(JSON.stringify(all), await needlesOf(Y)), [], `${X.name}'s period bills show ${Y.name}'s data`);
        assert.equal((await fingerprint(Y.hid)).text, yStart.text);
        assert.equal((await fingerprint(X.hid)).text, xStart.text, "a read writes nothing");
      }
      await assert.rejects(F.loadPeriodBills(store, ""), "a household id is required");
      await pg.query("delete from bills where id in ($1, $2)", [aPeriod, bPeriod]);
    });

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

    // ---------------------------------------------------------------- D62 foreign costs
    await check("foreignCosts and foreignCostInputs (D62): each household's costs hold its own charges, cards and paid invoices and none of the other's; reading changes nothing", async () => {
      const temp = new Map<string, string>();
      for (const X of [A, B]) {
        const id = randomUUID();
        temp.set(X.hid, id);
        await db.insert(schema.charges).values({
          id, householdId: X.hid, cardId: X.ids.card, merchant: `Isolation ${X.tag} abroad`, amountMinor: 3_000, currency: "JPY", date: "2026-11-10", category: "food", status: "confirmed", source: "manual", madeBy: "form",
          originalAmountMinor: 2_000, originalCurrency: "USD", fxRateMicro: 150_000_000, fxEstimated: false,
        });
      }
      try {
        for (const [X, Y] of [[A, B], [B, A]] as const) {
          const yStart = await fingerprint(Y.hid), xStart = await fingerprint(X.hid);
          const inputs = await F.foreignCostInputs(db, X.hid, "2026-11-14");
          assert.deepEqual(leaks(JSON.stringify(inputs), await needlesOf(Y)), [], `${X.name}'s inputs show ${Y.name}'s data`);
          assert.ok(inputs.charges.some(c => c.id === temp.get(X.hid)) && !inputs.charges.some(c => c.id === temp.get(Y.hid)));
          assert.ok(inputs.cards.some(c => c.id === X.ids.card) && !inputs.cards.some(c => c.id === Y.ids.card));
          const costs = await F.foreignCosts(db, X.hid);
          assert.deepEqual(leaks(JSON.stringify(costs), await needlesOf(Y)), [], `${X.name}'s costs show ${Y.name}'s data`);
          assert.equal(costs.charges.length, 1);
          assert.equal(costs.payoutTotals.count, 16, "Ben's sixteen paid invoices of this household only");
          assert.equal((await fingerprint(Y.hid)).text, yStart.text);
          assert.equal((await fingerprint(X.hid)).text, xStart.text, "a read writes nothing");
        }
      } finally {
        for (const [hid, id] of temp) await db.delete(schema.charges).where(and(eq(schema.charges.householdId, hid), eq(schema.charges.id, id)));
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

    await check("removing A's own model connection changes nothing of B's", async () => {
      const before = await fingerprint(B.hid);
      await F.deleteHouseholdConnection(store, A.hid);
      assert.equal(await F.connectionView(store, A.hid), null);
      assert.equal((await fingerprint(B.hid)).text, before.text);
      assert.ok(await F.connectionView(store, B.hid));
    });

    await check("27E: stored bytes and the removal of old raw files count and touch only the household's own documents", async () => {
      const old = new Date("2026-01-01T00:00:00Z"), later = new Date("2026-11-07T00:00:00Z");
      const made: Record<string, { id: string; path: string }> = {};
      for (const T of [A, B]) {
        const path = `${T.hid}/${randomUUID()}`;
        const [d] = await db.insert(schema.documents).values({ householdId: T.hid, kind: "upload", storagePath: path, mime: "application/pdf", status: "read", bytes: T === A ? 1000 : 5000 }).returning({ id: schema.documents.id });
        const extracted = { kind: "charge", name: "27E probe", date: "2026-01-01", amountMinor: 100, currency: "JPY", category: "food", businessBp: 0, cardId: null };
        await db.insert(schema.readings).values({ householdId: T.hid, documentId: d.id, extracted: { original: extracted, proposed: extracted }, target: "charge", status: "confirmed", confirmedAt: old });
        made[T.tag] = { id: d.id, path };
      }
      const removed: string[] = [];
      const fake = { remove: async (paths: string[]) => { removed.push(...paths); return { data: [], error: null } as never; } };
      const aBefore = await F.storedBytes(store, A.hid), bBefore = await F.storedBytes(store, B.hid);
      assert.ok(aBefore >= 1000 && bBefore >= 5000 && aBefore !== bBefore);
      const bStart = await fingerprint(B.hid);
      assert.ok(await F.removeExpiredFiles(store, A.hid, later, fake) >= 1);
      assert.ok(removed.includes(made.A.path) && removed.every(path => path.startsWith(A.hid + "/")), "only A's paths went to Storage");
      assert.equal((await fingerprint(B.hid)).text, bStart.text, "B's rows are as they were");
      assert.equal(await F.storedBytes(store, B.hid), bBefore, "B's count did not move");
      assert.equal(await F.storedBytes(store, A.hid), aBefore - 1000);
      await F.requireStorageRoom(store, B.hid, 10); // each household is counted against its own bytes only
    });

    await check("reminder settings, subscriptions, test sends and digest delivery stay in the calling household", async () => {
      const vapid = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
      const browser = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
      const rawPoint = async (key: CryptoKey) => Buffer.from(await crypto.subtle.exportKey("raw", key)).toString("base64url");
      const privateKey = (await crypto.subtle.exportKey("jwk", vapid.privateKey)).d;
      assert.ok(privateKey);
      const config = {
        APP_URL: "https://saver.example.test", RESEND_API_KEY: "fictional-reminder-key", REMINDER_FROM: "Fictional Saver <saver@example.test>",
        WEB_PUSH_PUBLIC_KEY: await rawPoint(vapid.publicKey),
        WEB_PUSH_PRIVATE_KEY: privateKey,
        WEB_PUSH_SUBJECT: "mailto:saver@example.test",
      };
      const beforeConfig = Object.fromEntries(Object.keys(config).map(key => [key, process.env[key]]));
      Object.assign(process.env, config);
      try {
        const identity = (t: Tenant) => ({ uid: t.ids.authUid, email: "fictional-" + t.tag.toLowerCase() + "@example.test" });
        const p256dh = await rawPoint(browser.publicKey);
        const subscription = (t: Tenant) => ({
          endpoint: "https://fcm.googleapis.com/fcm/send/fictional-isolation-" + t.tag,
          p256dh, auth: randomBytes(16).toString("base64url"),
        });
        const aSub = subscription(A), bSub = subscription(B);
        const due = { hour: 8, quietDays: [], emailOn: false };
        await F.saveReminderSettings(store, B.hid, identity(B), { ...due, hour: 9, quietDays: [1] });
        await F.subscribeReminder(store, B.hid, identity(B), bSub);
        const beforeB = await fingerprint(B.hid);
        const aIdentity = identity(A), bIdentity = identity(B);
        const missing = /member of this household/;
        await assert.rejects(F.reminderView(store, A.hid, bIdentity), missing);
        await assert.rejects(F.saveReminderSettings(store, A.hid, bIdentity, due), missing);
        await assert.rejects(F.subscribeReminder(store, A.hid, bIdentity, aSub), missing);
        await assert.rejects(F.unsubscribeReminder(store, A.hid, bIdentity, bSub.endpoint), missing);

        const sent: string[] = [];
        const fakeFetch: typeof fetch = async input => {
          sent.push(String(input));
          return new Response(null, { status: 201 });
        };
        await assert.rejects(F.sendTestReminder(store, A.hid, bIdentity, "push", bSub.endpoint, fakeFetch), missing);
        await assert.rejects(F.sendTestReminder(store, A.hid, aIdentity, "push", bSub.endpoint, fakeFetch), /Turn on push/);
        assert.equal(await F.unsubscribeReminder(store, A.hid, aIdentity, bSub.endpoint), false);
        assert.deepEqual(sent, []);

        await F.saveReminderSettings(store, A.hid, aIdentity, due);
        await F.subscribeReminder(store, A.hid, aIdentity, aSub);
        const aView = await F.reminderView(store, A.hid, aIdentity), bView = await F.reminderView(store, B.hid, bIdentity);
        assert.deepEqual([aView.hour, aView.quietDays, bView.hour, bView.quietDays], [8, [], 9, [1]]);
        const hash = async (endpoint: string) => Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(endpoint))).toString("hex");
        assert.ok(aView.endpointHashes.includes(await hash(aSub.endpoint)));
        assert.ok(!aView.endpointHashes.includes(await hash(bSub.endpoint)));
        assert.ok(bView.endpointHashes.includes(await hash(bSub.endpoint)));
        assert.ok(!bView.endpointHashes.includes(await hash(aSub.endpoint)));
        assert.equal(await F.sendTestReminder(store, A.hid, aIdentity, "push", aSub.endpoint, fakeFetch), true);
        assert.deepEqual(sent.splice(0), [aSub.endpoint]);
        assert.equal((await fingerprint(B.hid)).text, beforeB.text);
        // Give each household a due finding. A's pass must only deliver A's, even when B is eligible.
        const day = DEMO_DATE;
        for (const t of [A, B]) await db.insert(schema.suggestions).values({
          householdId: t.hid, kind: "bill_due", key: "isolation-reminder-" + t.tag, title: "Fictional bill", reason: "¥600, covered.",
          action: "bill", refId: t.ids.billConfirmed, urgency: 3, createdOn: day,
        });
        const bBeforePass = await fingerprint(B.hid);
        await F.runReminders(store, A.hid, new Date(day + "T04:00:00Z"), fakeFetch);
        assert.deepEqual(sent, [aSub.endpoint]);
        const receipts = await db.select().from(schema.reminders).where(and(eq(schema.reminders.householdId, A.hid), eq(schema.reminders.day, day)));
        assert.equal(receipts.length, 1);
        assert.equal(receipts[0].status, "sent");
        assert.deepEqual(leaks(JSON.stringify(receipts), await needlesOf(B)), []);
        assert.equal((await fingerprint(B.hid)).text, bBeforePass.text);
        assert.equal(await F.unsubscribeReminder(store, A.hid, aIdentity, aSub.endpoint), true);
        assert.equal((await fingerprint(B.hid)).text, bBeforePass.text);
      } finally {
        for (const [key, value] of Object.entries(beforeConfig)) {
          if (value === undefined) delete process.env[key]; else process.env[key] = value;
        }
      }
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
