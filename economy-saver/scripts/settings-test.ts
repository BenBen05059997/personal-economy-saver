// Isolated SQL contract tests. The test-only Vault double does not claim encryption verification.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { and, eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { missingAskSetting } from "@/lib/agent/availability";
import { AiKeyError, deleteHouseholdConnection, deleteHouseholdKey, aiConnection, connectionView, saveHouseholdConnection } from "@/db/ai-key";
import { checkConnection } from "@/lib/ai/check";
import { fakeModel, type FakeMode } from "./ai-fake";
import { seedBen } from "@/db/seed";
import { parseMinor } from "@/db/money";
import { savePeople } from "@/db/people";
import { billEditInput, updateBill } from "@/db/bills";
import { loadSettings, settingsInput, updateSettings } from "@/db/settings";
import { deleteHousehold, loadMoneyState } from "@/db/household";
import { resetDemoHousehold } from "@/db/demo";
import { runDaily } from "@/db/daily";
import { confirmPending } from "@/db/confirm";
import { fundingOptions } from "@/lib/money/options";
import { usd } from "@/lib/money/format";
import { reviewReading } from "@/db/readings";
import { finishSetup, setupForm } from "@/db/account";
import { loadNavigationData } from "@/db/workspace";
import { listMcpTokens } from "@/db/mcp-tokens";

const setWhose = async (db: Parameters<typeof updateBill>[0], hid: string, billId: string, memberId: string | null, paidByMemberId: string | null = null) => {
  const [bill] = await db.select().from(schema.bills).where(and(eq(schema.bills.householdId, hid), eq(schema.bills.id, billId)));
  return updateBill(db, hid, billEditInput.parse({ id: billId, biller: bill.biller, amount: String(bill.amountMinor), due: bill.due, category: bill.category, businessBp: bill.businessBp, memberId, paidByMemberId }), { madeBy: "form" });
}; // Settings → Bills → Edit with only whose changed

const AI_SETTINGS = ["APP_URL", "AI_PROTOCOL", "AI_BASE_URL", "AI_API_KEY", "AI_DAILY_LIMIT", "AI_TEXT_MODEL", "AI_DOCUMENT_MODEL"];

async function main() {
  const pg = new PGlite();
  const db = drizzle(pg, { schema });
  let passed = 0;
  async function check(name: string, run: () => Promise<void>) {
    await run(); passed++; console.log(`✓ ${name}`);
  }
  const previous = Object.fromEntries(AI_SETTINGS.map(name => [name, process.env[name]]));
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
    await check("Settings loads navigation, settings and token list in one household-scoped read transaction", async () => {
      const [workspace, settings, tokens] = await db.transaction(tx => Promise.all([
        loadNavigationData(tx, a), loadSettings(tx, a), listMcpTokens(tx, a),
      ]), { isolationLevel: "repeatable read", accessMode: "read only" });
      assert.equal(workspace.name, "Ben");
      assert.equal(workspace.pending, 1);
      assert.equal(settings.household.bank, 67_000);
      assert.ok(settings.cards.length > 0);
      assert.deepEqual(tokens, []);
      assert.ok(settings.cards.every(card => card.householdId === a));
    });
    const fictional = "sk-ant-fictional-" + "a".repeat(40);
    const another = "sk-ant-fictional-" + "b".repeat(40);
    process.env.AI_PROTOCOL = "anthropic";
    process.env.AI_API_KEY = fictional;
    process.env.AI_DAILY_LIMIT = "2";
    process.env.AI_TEXT_MODEL = "fixture-text";
    process.env.AI_DOCUMENT_MODEL = "fixture-document";
    const aiKey = async (...args: [Parameters<typeof aiConnection>[0], string, Date?]) => (await aiConnection(args[0], args[1], "text", args[2])).key;
    const APP = new URL("https://app.example");
    const own = (hid: string, over: Partial<Parameters<typeof saveHouseholdConnection>[2]> = {}, mode: FakeMode = "good", signedIn = true) => {
      const model = fakeModel(mode);
      return { model, done: saveHouseholdConnection(db, hid, { provider: "openai", baseUrl: "", textModel: "fixture-own", documentModel: "", sameForDocuments: true, key: fictional, ...over },
        { signedIn, check: connection => checkConnection(connection, { fetch: model.fetch, appUrl: process.env.APP_URL ? new URL(process.env.APP_URL) : APP }) }) };
    };
    const row = async (hid: string) => (await db.select().from(schema.households).where(eq(schema.households.id, hid)))[0];
    const aiEvents = async (hid: string) => (await db.select().from(schema.events).where(and(eq(schema.events.householdId, hid), eq(schema.events.kind, "ai_model_changed")))).map(e => e.title);
    const vaultCount = async () => (await pg.query<{ n: number }>("select count(*)::integer as n from vault.secrets")).rows[0].n;
    await check("default calls reserve quota atomically and reset at the household local midnight", async () => {
      const before = new Date("2026-11-02T14:59:59Z"), after = new Date("2026-11-02T15:00:00Z");
      const calls = await Promise.allSettled([aiKey(db, a, before), aiKey(db, a, before), aiKey(db, a, before)]);
      assert.equal(calls.filter(call => call.status === "fulfilled").length, 2);
      assert.equal(calls.filter(call => call.status === "rejected").length, 1);
      await aiKey(db, a, after);
      const settings = await loadSettings(db, a);
      assert.equal(settings.household.aiReadsDay, "2026-11-03"); assert.equal(settings.household.aiReadsToday, 1);
      await aiKey(db, b, before);
      delete process.env.AI_API_KEY;
      await assert.rejects(aiKey(db, a, after), /AI_API_KEY is not set/);
      process.env.AI_API_KEY = fictional;
    });
    await check("a listed provider is saved with its own address, checked, and its result stored; the key is only ever a hint", async () => {
      const reads = (await loadSettings(db, a)).household.aiReadsToday;
      const { model, done } = own(a);
      await done;
      assert.ok(model.seen.length >= 4 && model.seen.every(s => new URL(s.url).host === "api.openai.com" && s.model === "fixture-own"));
      const saved = await row(a);
      assert.deepEqual([saved.aiProvider, saved.aiProtocol, saved.aiBaseUrl, saved.aiTextModel, saved.aiDocumentModel], ["openai", "openai", "https://api.openai.com/v1", "fixture-own", "fixture-own"]);
      assert.equal(saved.aiKeyHint, "…aaaa");
      assert.equal((saved.aiCheck as { passed: string[] }).passed.length, 3);
      const view = await connectionView(db, a);
      assert.deepEqual([view?.provider, view?.label, view?.host, view?.textModel, view?.sameForDocuments, view?.hint, view?.tested, view?.check?.failed.length], ["openai", "OpenAI", "api.openai.com", "fixture-own", true, "…aaaa", false, 0]);
      assert.ok(!JSON.stringify(view).includes(fictional));
      const c = await aiConnection(db, a, "document");
      assert.deepEqual(c, { protocol: "openai", baseUrl: "https://api.openai.com/v1", key: fictional, textModel: "fixture-own", documentModel: "fixture-own", own: true });
      assert.equal((await loadSettings(db, a)).household.aiReadsToday, reads, "an own connection uses no allowance");
      const titles = await aiEvents(a);
      assert.deepEqual(titles, ["AI model changed to OpenAI, fixture-own"]);
      assert.ok(titles.every(t => !t.includes(fictional)));
      assert.equal(await vaultCount(), 1);
    });
    await check("a new key replaces the Vault secret under the same name; an empty key keeps it for the same provider only", async () => {
      await own(a, { key: another, textModel: "second", sameForDocuments: false, documentModel: "docs" }).done;
      assert.equal(await vaultCount(), 1);
      const names = await pg.query<{ name: string }>("select name from vault.secrets");
      assert.deepEqual(names.rows.map(r => r.name), [`household:${a}:anthropic`]);
      assert.equal((await aiConnection(db, a, "document")).key, another);
      assert.equal((await aiConnection(db, a, "document")).documentModel, "docs");
      assert.equal((await row(a)).aiKeyHint, "…bbbb");
      await own(a, { key: "", textModel: "third" }).done;
      assert.equal((await aiConnection(db, a, "text")).key, another, "kept");
      await assert.rejects(own(a, { provider: "groq", key: "" }).done, /Enter the key/);
      assert.equal((await aiConnection(db, a, "text")).key, another, "a refused save changes nothing");
      await own(a, { provider: "custom", baseUrl: "https://models.example/v1", key: "" }).done;
      assert.equal(await vaultCount(), 0, "a key never moves to another host");
      const noKey = await aiConnection(db, a, "text");
      assert.deepEqual([noKey.key, noKey.baseUrl, noKey.protocol, noKey.own], [null, "https://models.example/v1", "openai", true]);
      assert.equal((await row(a)).aiKeyHint, null);
      assert.equal((await connectionView(db, a))?.hint, null);
    });
    await check("custom needs an account; every address rule refuses before any model call and stores nothing", async () => {
      const before = JSON.stringify(await row(a));
      await assert.rejects(own(a, { provider: "custom", baseUrl: "https://models.example/v1" }, "good", false).done, /A custom address needs an account\. Sign in from Settings → Account\./);
      for (const baseUrl of ["http://models.example/v1", "https://10.0.0.5/v1", "https://user:pw@models.example/v1", "https://localhost/v1", "nonsense", "https://models.example/v1?k=1"]) {
        const attempt = own(a, { provider: "custom", baseUrl });
        await assert.rejects(attempt.done, /That address can't be used/, baseUrl);
        assert.equal(attempt.model.seen.length, 0);
      }
      assert.equal(JSON.stringify(await row(a)), before);
      await assert.rejects(own(a, { provider: "nothing" }).done, /Choose a provider/);
      // a model on this machine is reachable only when the app itself runs locally
      process.env.APP_URL = "https://app.example";
      await assert.rejects(own(a, { provider: "custom", baseUrl: "http://localhost:11434/v1" }).done, /https/);
      process.env.APP_URL = "http://127.0.0.1:3123";
      await own(a, { provider: "custom", baseUrl: "http://localhost:11434/v1/", key: "" }).done;
      assert.equal((await row(a)).aiBaseUrl, "http://localhost:11434/v1");
      process.env.APP_URL = "https://app.example";
      await assert.rejects(aiConnection(db, a, "text"), /address can't be used/, "the address is checked again on every call");
      process.env.APP_URL = "http://127.0.0.1:3123";
      assert.equal((await aiConnection(db, a, "text")).baseUrl, "http://localhost:11434/v1");
      delete process.env.APP_URL;
    });
    await check("the key and model fields have their shapes", async () => {
      for (const key of ["has space", "a".repeat(501), "tab\there"]) await assert.rejects(own(b, { key }).done, /1 to 500 characters/, key.slice(0, 8));
      await assert.rejects(own(b, { key: "" }).done, /Enter the key/, "a listed provider needs a key");
      for (const textModel of ["", "two words", "x".repeat(201)]) await assert.rejects(own(b, { textModel }).done, /Enter the model for questions/);
      await assert.rejects(own(b, { sameForDocuments: false, documentModel: "" }).done, /Enter the model for documents/);
      assert.equal(await connectionView(db, b), null);
      assert.equal((await row(b)).aiProtocol, null);
    });
    await check("a model that does not call tools is refused in words and nothing is stored; the other failures are stored and shown", async () => {
      const before = JSON.stringify(await row(a)), events = (await aiEvents(a)).length, secrets = await vaultCount();
      await assert.rejects(own(a, { provider: "mistral", textModel: "no-tools" }, "notools").done, (error: unknown) => error instanceof AiKeyError && /did not call the app's tools/.test(error.message) && !error.message.includes(fictional));
      await assert.rejects(own(a, { provider: "mistral", textModel: "down" }, "down").done, /refused the request.*401/);
      assert.equal(JSON.stringify(await row(a)), before);
      assert.equal((await aiEvents(a)).length, events);
      assert.equal(await vaultCount(), secrets);
      await own(a, { provider: "mistral", textModel: "careless" }, "injected").done;
      const view = await connectionView(db, a);
      assert.deepEqual([view?.check?.passed.length, view?.check?.failed.map(f => f.name)], [2, ["ignores_injection"]]);
      assert.equal(view?.tested, false);
      assert.equal((await aiEvents(a)).length, events + 1);
    });
    await check("Use this app's default clears the columns and the Vault key, writes one event, and the default allowance applies again", async () => {
      await deleteHouseholdConnection(db, a);
      const cleared = await row(a);
      assert.deepEqual([cleared.aiProvider, cleared.aiProtocol, cleared.aiBaseUrl, cleared.aiTextModel, cleared.aiDocumentModel, cleared.aiCheck, cleared.aiKeySecretId, cleared.aiKeyHint], Array(8).fill(null));
      assert.equal(await vaultCount(), 0);
      assert.equal(await connectionView(db, a), null);
      const events = await aiEvents(a);
      assert.equal(events.filter(t => t === "AI model changed to this app's default").length, 1);
      await deleteHouseholdConnection(db, a);
      assert.equal((await aiEvents(a)).length, events.length, "nothing to clear, nothing recorded");
      const c = await aiConnection(db, a, "text", new Date("2026-11-20T00:00:00Z"));
      assert.deepEqual([c.own, c.textModel], [false, "fixture-text"]);
      await own(a).done;
      await db.transaction(tx => deleteHouseholdKey(tx, a));
      assert.equal((await row(a)).aiProtocol, null, "Reset, upgrade, the sweeper and deletion clear the whole connection");
      assert.equal(await vaultCount(), 0);
    });
    await check("an own connection needs no server setting and no allowance; a missing model for the need is a clear error", async () => {
      await own(a).done;
      const saved = { ...Object.fromEntries(AI_SETTINGS.map(name => [name, process.env[name]])) };
      for (const name of AI_SETTINGS) delete process.env[name];
      try {
        assert.equal(missingAskSetting(false), "AI_TEXT_MODEL");
        assert.equal(missingAskSetting(true), null);
        const c = await aiConnection(db, a, "text");
        assert.deepEqual([c.own, c.key], [true, fictional]);
        await db.update(schema.households).set({ aiDocumentModel: null }).where(eq(schema.households.id, a));
        await assert.rejects(aiConnection(db, a, "document"), { message: "Your AI model has no model for documents. Choose one in Settings." });
        assert.equal((await aiConnection(db, a, "text")).textModel, "fixture-own");
        await db.update(schema.households).set({ aiTextModel: null }).where(eq(schema.households.id, a));
        await assert.rejects(aiConnection(db, a, "text"), { message: "Your AI model has no model for questions. Choose one in Settings." });
      } finally {
        for (const [name, value] of Object.entries(saved)) if (value !== undefined) process.env[name] = value;
      }
      await db.transaction(tx => deleteHouseholdKey(tx, a));
    });
    await check("the connection says whose it is, which protocol and which models, and a missing model stops before any allowance is used", async () => {
      const day = new Date("2026-11-02T14:59:59Z"); // the same household day as the quota check above
      process.env.AI_DAILY_LIMIT = "10";
      const used = async () => (await loadSettings(db, b)).household.aiReadsToday;
      const before = await used();
      const server = await aiConnection(db, b, "document", day);
      assert.deepEqual(server, { protocol: "anthropic", baseUrl: "https://api.anthropic.com", key: fictional, textModel: "fixture-text", documentModel: "fixture-document", own: false });
      assert.equal(await used(), before + 1);
      process.env.AI_PROTOCOL = "openai";
      await assert.rejects(aiConnection(db, b, "text", day), /AI_BASE_URL is not set/);
      process.env.AI_BASE_URL = "https://models.example/v1";
      const other = await aiConnection(db, b, "text", day);
      assert.deepEqual([other.protocol, other.baseUrl, other.own], ["openai", "https://models.example/v1", false]);
      process.env.AI_PROTOCOL = "anthropic"; delete process.env.AI_BASE_URL;
      const reserved = await used();
      delete process.env.AI_DOCUMENT_MODEL;
      await assert.rejects(aiConnection(db, b, "document", day), /AI_DOCUMENT_MODEL is not set/);
      assert.equal(await used(), reserved);
      process.env.AI_DOCUMENT_MODEL = "fixture-document";
      assert.equal(missingAskSetting(false), null);
      delete process.env.AI_DAILY_LIMIT;
      assert.equal(missingAskSetting(false), "AI_DAILY_LIMIT");
      assert.equal(missingAskSetting(true), null);
      process.env.AI_DAILY_LIMIT = "2";
    });
    await check("a corrupted pointer cannot read, replace or delete another household’s key", async () => {
      await own(a).done; await own(b).done;
      const [source] = await db.select().from(schema.households).where(eq(schema.households.id, b));
      const mine = (await row(a)).aiKeySecretId;
      await db.update(schema.households).set({ aiKeySecretId: source.aiKeySecretId }).where(eq(schema.households.id, a));
      await assert.rejects(aiKey(db, a), AiKeyError);
      await assert.rejects(own(a, { key: another }).done, AiKeyError);
      await assert.rejects(db.transaction(tx => deleteHouseholdKey(tx, a)), AiKeyError);
      assert.equal(await aiKey(db, b), fictional);
      await db.update(schema.households).set({ aiKeySecretId: mine }).where(eq(schema.households.id, a));
      await db.transaction(tx => deleteHouseholdKey(tx, a));
      await db.transaction(tx => deleteHouseholdKey(tx, b));
    });
    await check("bank amounts preserve cents and member/card/bill writes stay in the household", async () => {
      assert.equal(parseMinor("-12.37", "USD"), -1237); assert.equal(parseMinor("0.01", "USD"), 1);
      assert.throws(() => parseMinor("0.01", "JPY")); assert.throws(() => parseMinor("1.234", "USD"));
      const settingsA = await loadSettings(db, a), settingsB = await loadSettings(db, b);
      await updateSettings(db, a, settingsInput.parse({ kind: "household", name: "Fictional household", bank: "23456" }));
      assert.equal((await loadSettings(db, a)).household.bank, 23456);
      const bankEvents = async () => (await db.select().from(schema.events).where(and(eq(schema.events.householdId, a), eq(schema.events.kind, "bank_balance")))).length;
      const written = await bankEvents();
      await updateSettings(db, a, settingsInput.parse({ kind: "household", name: "Renamed household", bank: "23456" }));
      assert.equal(await bankEvents(), written, "a rename with the same balance goes through setBankBalance only when the balance changes");
      await updateSettings(db, a, settingsInput.parse({ kind: "household", name: "Renamed household", bank: "-100" }));
      assert.equal((await loadSettings(db, a)).household.bank, -100);
      assert.equal(await bankEvents(), written + 1, "Settings changes the balance through setBankBalance (old and new in an event)");
      await updateSettings(db, a, settingsInput.parse({ kind: "household", name: "Fictional household", bank: "23456" }));
      await assert.rejects(savePeople(db, a, { people: [{ id: settingsB.people[0].id, name: "Wrong household" }] }));
      await assert.rejects(setWhose(db, a, settingsA.bills[0].id, settingsB.people[0].id));
      await setWhose(db, a, settingsA.bills[0].id, settingsA.people[0].id);
      assert.equal((await loadSettings(db, a)).bills[0].memberId, settingsA.people[0].id);
      await assert.rejects(db.update(schema.cards).set({ memberId: settingsB.people[0].id }).where(and(eq(schema.cards.householdId, a), eq(schema.cards.id, settingsA.cards[0].id))));
      await assert.rejects(db.insert(schema.bills).values({ householdId: a, memberId: settingsB.people[0].id, biller: "Invalid", amountMinor: 1, currency: "JPY", due: "2026-11-20", category: "other", status: "pending" }));
      await assert.rejects(db.insert(schema.users).values({ householdId: a, memberId: settingsB.people[0].id, authUserId: randomUUID() }));
      const [person] = await db.insert(schema.members).values({ householdId: a, displayName: "Fictional partner", shareBp: 0 }).returning();
      await setWhose(db, a, settingsA.bills[0].id, person.id);
      await db.update(schema.cards).set({ memberId: person.id }).where(and(eq(schema.cards.householdId, a), eq(schema.cards.id, settingsA.cards[0].id)));
      await db.delete(schema.members).where(and(eq(schema.members.householdId, a), eq(schema.members.id, person.id)));
      const afterDelete = await loadSettings(db, a);
      assert.equal(afterDelete.bills[0].memberId, null); assert.equal(afterDelete.cards[0].memberId, null);
    });
    await check("Activity says what a settings change was: a rename, a card added, a card edited, nothing when nothing changed", async () => {
      const titles = async () => (await db.select().from(schema.events).where(and(eq(schema.events.householdId, a), eq(schema.events.kind, "settings_updated"))).orderBy(schema.events.occurredAt, schema.events.id)).map(e => e.title);
      const before = (await titles()).length;
      const [household] = await db.select().from(schema.households).where(eq(schema.households.id, a));
      const bank = String(household.bankBalanceMinor);
      await updateSettings(db, a, settingsInput.parse({ kind: "household", name: "Renamed in Activity", bank }));
      await updateSettings(db, a, settingsInput.parse({ kind: "household", name: "Renamed in Activity", bank }));
      await updateSettings(db, a, settingsInput.parse({ kind: "card", id: "", label: "Card C", memberId: "", closingDay: 5, dueDay: 25, limit: "" }));
      const card = (await loadSettings(db, a)).cards.find(c => c.label === "Card C")!;
      const form = { kind: "card", id: card.id, label: "Card C", memberId: "", closingDay: 5, dueDay: 25, limit: "" };
      await updateSettings(db, a, settingsInput.parse({ ...form, dueDay: 27 }));
      await updateSettings(db, a, settingsInput.parse({ ...form, dueDay: 27, limit: "100000" }));
      assert.deepEqual((await titles()).slice(before), [
        "Household renamed to Renamed in Activity", "Card C added", "Card C: due day 25 → 27", "Card C: limit no limit → ¥100,000",
      ]);
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
      const value = { kind: "charge" as const, name: "Fictional receipt", date: "2026-11-14", amountMinor: 567, currency: "JPY" as const, category: "other" as const, businessBp: 0, cardId: card.id, repeat: null, nextAmountMinor: null, nextAmountFrom: null, cancelBy: null, repeatUntil: null };
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
      await own(a, { key: another }).done; await own(b).done;
      await resetDemoHousehold(db, a);
      assert.equal(await vaultCount(), 1, "Reset removed a's secret and left b's");
      assert.equal(await aiKey(db, b), fictional);
      const upgrade = await seedBen(db, { isDemo: true });
      await own(upgrade).done;
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
        assert.equal(await aiKey(db, b), fictional);
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
    console.log(`${passed}/${passed} settings and AI-key contract checks passed.`);
  } finally {
    for (const [name, value] of Object.entries(previous)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
    await pg.close();
  }
}
main().catch(error => { console.error("Settings contract verification failed", error instanceof Error ? error.message : ""); process.exitCode = 1; });
