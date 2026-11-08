// D59, D44, D65: stored data (count, delete a kind, delete one item), the refusal for the record, documents deleted with their
// Storage objects while their confirmed bills stay, scope across households, and Import into an empty household (a round trip, the refusals).
// PGlite only; no network, no credentials; Storage is a recording stand-in passed to the functions. Every value is fictional.
// Run from the project root: npx tsx --tsconfig ./tsconfig.json scripts/data-test.ts
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "@/db/schema";
import { listCanvases, pinCanvas } from "@/db/canvases";
import { allTurns, saveTurn } from "@/db/conversation";
import { DATA_KINDS, countKind, countKinds, deleteConversation, deleteDocument, deleteKind, deleteOne, deleteTurn, type DocumentStore } from "@/db/data-kinds";
import { InputError } from "@/db/input-error";
import { addMemory, listMemory } from "@/db/memory";
import { DEVICE_MEMORY_WORDS, itemsToMove, moveToCloud, moveToDevice, readPlaces, requireCloud } from "@/db/place";
import { addMemoryItem, applyMemoryChanges, editMemoryItem, forgetMemoryItem } from "@/lib/store/memory-ops";
import { MAX_PINS } from "@/lib/canvas/schema";
import { appendTurn, latestOf, movePin, pinItem, recentOf, unpinItem, updatePin, type DevicePin } from "@/lib/store/journal-ops";
import type { ConversationTurn } from "@/lib/schema/turn";
import type { MemoryItem } from "@/lib/schema/memory";
import { NOT_EMPTY, OLD_VERSION, restoreHousehold } from "@/db/restore";
import { seedBen } from "@/db/seed";
import { loadMoneyState } from "@/db/household";
import { availableCash, low, series } from "@/lib/money/runway";
import { homeSentence } from "@/lib/money/sentence";
import { loadHouseholdSnapshot } from "@/db/snapshot";
import { DEMO_DATE } from "@/db/clock";
import type { Db } from "@/db/household";

const form = { madeBy: "form" } as const;
const recipe = (title: string) => ({ version: 1, title, blocks: [{ type: "number", label: "Cash today", query: { q: "cash" } }] });

/** A Storage stand-in: records what was asked to be removed; `fail` makes the next removal report an error. */
function fakeStore() {
  const removed: string[] = [];
  const store: DocumentStore & { fail: boolean } = {
    fail: false,
    async remove(paths) { if (store.fail) return { error: new Error("storage down") }; removed.push(...paths); return { error: null }; },
  };
  return { store, removed };
}

async function main() {
  const pg = new PGlite();
  const db = drizzle(pg, { schema }) as unknown as Db;
  let passed = 0;
  async function check(name: string, run: () => void | Promise<void>) { await run(); passed++; console.log(`✓ ${name}`); }
  try {
    await migrate(drizzle(pg, { schema }), { migrationsFolder: "./drizzle" });
    const a = await seedBen(db, { isDemo: true }), b = await seedBen(db, { isDemo: true, name: "ZZ Other Household" });
    const { store, removed } = fakeStore();
    const [aCard] = await db.select().from(schema.cards).where(eq(schema.cards.householdId, a)).limit(1);

    // Stored data: A gets 3 memories, 3 pins, turns in two conversations, two documents with readings; B gets one of each.
    const memA = [await addMemory(db, a, { kind: "fact", text: "Rent goes up in April" }, form), await addMemory(db, a, { kind: "preference", text: "Answer in Japanese" }, form),
      await addMemory(db, a, { kind: "goal", text: "¥300,000 for a trip in March" }, { madeBy: "ask", askId: randomUUID() })];
    const memB = await addMemory(db, b, { kind: "fact", text: "ZZ B memory" }, form);
    const pinA = [await pinCanvas(db, a, { title: "One", recipe: recipe("One") }, form), await pinCanvas(db, a, { title: "Two", recipe: recipe("Two") }, form), await pinCanvas(db, a, { title: "Three", recipe: recipe("Three") }, form)];
    const pinB = await pinCanvas(db, b, { title: "ZZ B pin", recipe: recipe("ZZ B pin") }, form);
    const convOne = randomUUID(), convTwo = randomUUID();
    const turn = (conversationId: string, question: string) => ({ id: randomUUID(), conversationId, question, kind: "answer" as const, reply: "Yes.", choices: null, recipe: null, sources: [] });
    const turnsA = [turn(convOne, "First?"), turn(convOne, "Second?"), turn(convTwo, "Third?")];
    for (const [i, t] of turnsA.entries()) await saveTurn(db, a, t, new Date(Date.UTC(2026, 10, 6, 1, i)));
    const turnB = turn(randomUUID(), "ZZ B question");
    await saveTurn(db, b, turnB);
    const doc = async (hid: string, withReading = true) => {
      const id = randomUUID();
      await db.insert(schema.documents).values({ id, householdId: hid, kind: "upload", storagePath: `${hid}/${id}`, mime: "application/pdf", status: "read" });
      if (withReading) await db.insert(schema.readings).values({ householdId: hid, documentId: id, extracted: { original: {}, proposed: {} }, target: "bill" });
      return id;
    };
    const docs = [await doc(a), await doc(a)];
    const docB = await doc(b);
    // A confirmed bill and charge made from the first document: they are part of the record and stay.
    const [keptBill] = await db.insert(schema.bills).values({ householdId: a, biller: "Fictional Water", amountMinor: 4100, currency: "JPY", due: "2026-12-05", category: "utilities", documentId: docs[0], madeBy: "reader" }).returning();
    const [keptCharge] = await db.insert(schema.charges).values({ householdId: a, cardId: aCard.id, merchant: "Fictional kiosk", amountMinor: 900, currency: "JPY", date: DEMO_DATE, source: "receipt", documentId: docs[0], madeBy: "reader" }).returning();
    const rowCount = async (table: typeof schema.documents | typeof schema.readings | typeof schema.memories | typeof schema.canvases | typeof schema.conversationTurns, hid: string) =>
      (await db.select().from(table).where(eq(table.householdId, hid))).length;

    const reminderData = async (hid: string, tag: string, days: string[]) => {
      const [member] = await db.select({ id: schema.members.id }).from(schema.members).where(eq(schema.members.householdId, hid));
      const memberRef = { householdId: hid, memberId: member.id };
      const receipts = await db.insert(schema.reminders).values(days.map(day => ({
        ...memberRef, channel: "push" as const, status: "sent" as const, day, suggestionIds: [],
      }))).returning({ id: schema.reminders.id });
      const devices = await db.insert(schema.pushSubscriptions).values(days.map((_, index) => ({
        ...memberRef, endpoint: "https://push.example.test/fictional-" + tag + "-" + index, p256dh: "fixture-point", auth: "fixture-auth",
      }))).returning({ id: schema.pushSubscriptions.id, endpoint: schema.pushSubscriptions.endpoint });
      return { receipts, devices };
    };
    const remindersA = await reminderData(a, "a", ["2026-11-13", DEMO_DATE]), remindersB = await reminderData(b, "b", [DEMO_DATE]);

    await check("countKind and countKinds report each kind for the requested household", async () => {
      assert.deepEqual([...DATA_KINDS], ["record", "memory", "canvases", "journal", "documents", "reminders", "push_subscriptions"]);
      const counts = await countKinds(db, a);
      assert.deepEqual([counts.memory, counts.canvases, counts.journal, counts.documents, counts.reminders, counts.push_subscriptions], [3, 3, 3, 2, 2, 2]);
      assert.ok(counts.record > 10, "Ben's record has bills, charges, clients, invoices");
      for (const kind of DATA_KINDS) assert.equal(await countKind(db, a, kind), counts[kind]);
      const other = await countKinds(db, b);
      assert.deepEqual([other.memory, other.canvases, other.journal, other.documents, other.reminders, other.push_subscriptions], [1, 1, 1, 1, 1, 1]);
      await assert.rejects(countKinds(db, ""), /household id is required/);
    });

    await check("reminders and push subscriptions are private, excluded from export, and removable one at a time or as a kind", async () => {
      const exported = JSON.stringify(await loadHouseholdSnapshot(db, a, { events: true, stored: true }));
      for (const row of remindersA.receipts) assert.ok(!exported.includes(row.id));
      for (const row of remindersA.devices) assert.ok(!exported.includes(row.id) && !exported.includes(row.endpoint));
      const kinds = [
        ["reminders", remindersA.receipts[0].id, remindersB.receipts[0].id],
        ["push_subscriptions", remindersA.devices[0].id, remindersB.devices[0].id],
      ] as const;
      for (const [kind, own, other] of kinds) {
        assert.equal(await deleteOne(db, a, kind, other, form), false);
        assert.equal(await deleteOne(db, a, kind, own, form), true);
        assert.equal(await deleteOne(db, a, kind, own, form), false);
        assert.equal(await countKind(db, a, kind), 1);
        assert.equal(await deleteKind(db, a, kind, form), 1);
        assert.equal(await countKind(db, a, kind), 0);
        assert.equal(await countKind(db, b, kind), 1);
      }
    });

    await check("the record is refused, by kind and by item, in words", async () => {
      await assert.rejects(deleteKind(db, a, "record", form), (e: unknown) => e instanceof InputError && /Delete everything/.test(e.message));
      await assert.rejects(deleteOne(db, a, "record", randomUUID(), form), InputError);
      assert.ok((await countKind(db, a, "record")) > 10, "nothing went");
    });

    await check("delete one: memory, a pin (the gap closes), a turn; another household's ids and unknown ids are not found", async () => {
      assert.equal(await deleteOne(db, a, "memory", memA[0].id, form), true);
      assert.equal(await deleteOne(db, a, "memory", memA[0].id, form), false, "again");
      assert.equal(await deleteOne(db, a, "memory", memB.id, form), false, "B's memory is not A's to delete");
      assert.equal(await deleteOne(db, a, "memory", "not-a-uuid", form), false);
      assert.equal(await deleteOne(db, a, "canvases", pinA[0].id, form), true);
      assert.deepEqual((await listCanvases(db, a)).map(p => [p.title, p.position]), [["Two", 0], ["Three", 1]]);
      assert.equal(await deleteOne(db, a, "canvases", pinB.id, form), false);
      assert.equal(await deleteOne(db, a, "journal", turnsA[0].id, form), true);
      assert.equal(await deleteTurn(db, a, turnsA[0].id), false);
      assert.equal(await deleteOne(db, a, "journal", turnB.id, form), false);
      assert.deepEqual((await allTurns(db, a)).map(t => t.question), ["Second?", "Third?"]);
      assert.equal((await listMemory(db, b)).length, 1);
      assert.equal((await listCanvases(db, b)).length, 1);
      assert.equal((await allTurns(db, b)).length, 1);
    });

    await check("delete a conversation removes its turns only", async () => {
      assert.equal(await deleteConversation(db, a, convTwo), 1);
      assert.equal(await deleteConversation(db, a, convTwo), 0);
      assert.equal(await deleteConversation(db, a, (await allTurns(db, b))[0].conversationId), 0, "B's conversation is not A's");
      assert.deepEqual((await allTurns(db, a)).map(t => t.question), ["Second?"]);
    });

    await check("delete one document removes its Storage object and its reading, keeps the confirmed bill and charge (link cleared), and refuses another household's", async () => {
      removed.length = 0;
      assert.equal(await deleteDocument(db, a, docB, form, store), false, "B's document");
      assert.deepEqual(removed, []);
      assert.equal(await deleteDocument(db, a, docs[0], form, store), true);
      assert.deepEqual(removed, [`${a}/${docs[0]}`]);
      assert.equal(await deleteDocument(db, a, docs[0], form, store), false, "again");
      assert.equal(await rowCount(schema.documents, a), 1);
      assert.equal((await db.select().from(schema.readings).where(and(eq(schema.readings.householdId, a), eq(schema.readings.documentId, docs[0])))).length, 0, "its reading went");
      const [bill] = await db.select().from(schema.bills).where(eq(schema.bills.id, keptBill.id));
      const [charge] = await db.select().from(schema.charges).where(eq(schema.charges.id, keptCharge.id));
      assert.deepEqual([bill.biller, bill.documentId, charge.merchant, charge.documentId], ["Fictional Water", null, "Fictional kiosk", null]);
      assert.equal(await rowCount(schema.documents, b), 1, "B's document stays");
    });

    await check("a Storage failure deletes nothing; a path outside the household is refused", async () => {
      const failing = fakeStore();
      failing.store.fail = true;
      await assert.rejects(deleteKind(db, a, "documents", form, failing.store), /Could not remove/);
      await assert.rejects(deleteDocument(db, a, docs[1], form, failing.store), /Could not remove/);
      assert.equal(await rowCount(schema.documents, a), 1);
      assert.equal(await rowCount(schema.readings, a), 1);
      const stray = randomUUID();
      await db.insert(schema.documents).values({ id: stray, householdId: a, kind: "upload", storagePath: `${b}/${stray}`, mime: "application/pdf", status: "read" });
      await assert.rejects(deleteKind(db, a, "documents", form, failing.store), /does not belong/);
      await db.delete(schema.documents).where(eq(schema.documents.id, stray));
    });

    await check("delete a kind: memory, canvases, journal and documents go for good; counts hit zero; the record and B are untouched; documents leave Storage", async () => {
      const recordBefore = await countKind(db, a, "record");
      removed.length = 0;
      assert.equal(await deleteKind(db, a, "documents", form, store), 1);
      assert.deepEqual(removed, [`${a}/${docs[1]}`]);
      assert.equal(await deleteKind(db, a, "documents", form, store), 0, "nothing left: no Storage call");
      assert.equal(await deleteKind(db, a, "memory", form), 2);
      assert.equal(await deleteKind(db, a, "canvases", form), 2);
      assert.equal(await deleteKind(db, a, "journal", form), 1);
      for (const kind of ["memory", "canvases", "journal", "documents"] as const) assert.equal(await countKind(db, a, kind), 0, kind);
      assert.equal(await countKind(db, a, "record"), recordBefore);
      const other = await countKinds(db, b);
      assert.deepEqual([other.memory, other.canvases, other.journal, other.documents], [1, 1, 1, 1]);
      assert.equal(await rowCount(schema.readings, b), 1);
      // The text of what was deleted is nowhere in the events.
      const events = await db.select().from(schema.events).where(eq(schema.events.householdId, a));
      assert.ok(!JSON.stringify(events).includes("Rent goes up in April") && !JSON.stringify(events).includes("Second?"));
      assert.ok(events.some(e => e.kind === "data_deleted"));
    });

    // ------------------------------------------------------------------ Import
    // A fresh household as the setup makes it: an owner, a card, a PayPal connection, today's rate. Nothing else.
    async function emptyHousehold(name: string, currency = "JPY") {
      const [h] = await db.insert(schema.households).values({ name, homeCurrency: currency, bankBalanceMinor: 1, isDemo: false }).returning();
      const [owner] = await db.insert(schema.members).values({ householdId: h.id, displayName: name, role: "owner", shareBp: 10_000 }).returning();
      await db.insert(schema.paypalConnections).values({ householdId: h.id, memberId: owner.id, balanceCurrency: currency });
      await db.insert(schema.cards).values({ householdId: h.id, memberId: owner.id, label: "Setup card", currency, closingDay: 25, dueDay: 10 });
      if (currency === "JPY") await db.insert(schema.fxRates).values({ householdId: h.id, date: "2026-11-01", base: "USD", quote: "JPY", rateMicro: 150_000_000 });
      return { id: h.id, owner: owner.id };
    }
    // Give A a second person, a shared bill she pays, a settlement, and stored kinds again.
    const [aOwner] = await db.select().from(schema.members).where(eq(schema.members.householdId, a));
    const [partner] = await db.insert(schema.members).values({ householdId: a, displayName: "Fictional Partner", role: "member", shareBp: 4000 }).returning();
    await db.update(schema.members).set({ shareBp: 6000 }).where(eq(schema.members.id, aOwner.id));
    await db.update(schema.households).set({ splitSince: "2026-10-01" }).where(eq(schema.households.id, a));
    await db.insert(schema.bills).values({ householdId: a, biller: "Fictional Internet", amountMinor: 5000, currency: "JPY", due: "2026-12-10", category: "utilities", memberId: null, paidByMemberId: partner.id });
    await db.insert(schema.bills).values({ householdId: a, biller: "Fictional Partner Phone", amountMinor: 3000, currency: "JPY", due: "2026-12-11", category: "utilities", memberId: partner.id });
    await db.insert(schema.settlements).values({ householdId: a, fromMemberId: partner.id, toMemberId: aOwner.id, amountMinor: 1200, currency: "JPY", through: "2026-10-31" });
    const [varies] = await db.insert(schema.bills).values({ householdId: a, biller: "Fictional Power", amountMinor: 9000, currency: "JPY", due: "2026-12-15", category: "utilities", repeatUnit: "month", repeatDay: 15, repeatUntil: "2027-06-15", amountVaries: true }).returning();
    await db.insert(schema.bills).values({ householdId: a, biller: "Fictional Power Nov", amountMinor: 9400, currency: "JPY", due: "2026-11-15", category: "utilities", seriesBillId: varies.id, periodStart: "2026-10-01", periodEnd: "2026-10-31" });
    const [aCardRow] = await db.select().from(schema.cards).where(eq(schema.cards.householdId, a)).limit(1);
    await db.insert(schema.charges).values({ householdId: a, cardId: aCardRow.id, merchant: "Fictional Abroad Shop", amountMinor: 3000, currency: "JPY", date: "2026-11-10", category: "other", status: "confirmed", source: "receipt", madeBy: "reader",
      originalAmountMinor: 2000, originalCurrency: "USD", fxRateMicro: 150_000_000, fxEstimated: true });
    await addMemory(db, a, { kind: "fact", text: "Rent goes up in April" }, form);
    await addMemory(db, a, { kind: "goal", text: "¥300,000 for a trip in March" }, { madeBy: "ask", askId: randomUUID() });
    await pinCanvas(db, a, { title: "One", recipe: recipe("One") }, form);
    await pinCanvas(db, a, { title: "Two", recipe: recipe("Two") }, form);
    const [anyClient] = await db.select().from(schema.clients).where(eq(schema.clients.householdId, a)).limit(1);
    const pinSliders = { clientId: anyClient.id, ...(await pinCanvas(db, a, { title: "Sliders", recipe: { version: 1, title: "Sliders", blocks: [{ type: "sliders", controls: [{ clientId: anyClient.id, maxDays: 14 }] }] } }, form)) };
    await saveTurn(db, a, turn(convOne, "Am I OK this month?"), new Date(Date.UTC(2026, 10, 6, 2, 0)));
    const exported = await loadHouseholdSnapshot(db, a, { events: true, stored: true });
    const file = JSON.parse(JSON.stringify(exported));

    await check("Import refuses: a version 1 file in words, a file that is not a household, a partial file, a file in another currency, a long number in memory", async () => {
      const c = await emptyHousehold("Fictional Importer");
      await assert.rejects(restoreHousehold(db, c.id, { ...file, version: 1 }), (e: unknown) => e instanceof InputError && e.message === OLD_VERSION && /version 1/.test(e.message));
      await assert.rejects(restoreHousehold(db, c.id, { version: 2, nonsense: true }), (e: unknown) => e instanceof InputError && /not a household file/.test(e.message));
      await assert.rejects(restoreHousehold(db, c.id, "text"), InputError);
      await assert.rejects(restoreHousehold(db, c.id, { ...file, truncated: { ...file.truncated, bills: true } }), /only part of a household/);
      await assert.rejects(restoreHousehold(db, c.id, { ...file, household: { ...file.household, homeCurrency: "USD" } }), /in USD and this household uses JPY/);
      await assert.rejects(restoreHousehold(db, c.id, { ...file, memory: [{ ...file.memory[0], text: "Card 4111 1111 1111 1111" }] }), /card or account numbers/);
      await assert.rejects(restoreHousehold(db, c.id, { ...file, members: file.members.map((m: { shareBp: number }) => ({ ...m, shareBp: 1 })) }), /shares/);
      assert.equal(await countKind(db, c.id, "record"), 0, "a refusal changes nothing");
    });

    // Ids are new on import; references are mapped. Compare two snapshots with every id (and every reference to one) taken out, and
    // check the references separately.
    const ID_KEYS = new Set(["id", "memberId", "paidByMemberId", "fromMemberId", "toMemberId", "cardId", "clientId", "seriesBillId", "conversationId", "documentId", "billId", "madeBy"]);
    const bare = (value: unknown): unknown => Array.isArray(value) ? value.map(bare) : value && typeof value === "object"
      ? Object.fromEntries(Object.entries(value).filter(([k]) => !ID_KEYS.has(k)).map(([k, v]) => [k, bare(v)])) : value;
    const sorted = (rows: unknown[]) => rows.map(r => JSON.stringify(bare(r))).sort();
    const engine = async (hid: string) => {
      const state = await loadMoneyState(db, hid, DEMO_DATE);
      return { cash: availableCash(state), low: low(series(state, "expected")), worst: low(series(state, "worst")), sentence: bare(homeSentence(state)), bills: state.bills.length, invoices: state.invoices.length, charges: state.charges.length };
    };
    const sourceEngine = await engine(a);

    await check("Import works while the source household still exists: new ids, every reference resolves, the same counts, money and sentence, and the same file imports into two empty households", async () => {
      const c = await emptyHousehold("Fictional Importer Three");
      const c2 = await emptyHousehold("Fictional Importer Four");
      const counts = await restoreHousehold(db, c.id, file);
      await restoreHousehold(db, c2.id, file);
      assert.equal(counts.bills, exported.bills.length);
      assert.equal(counts.clients, 3);
      const back = await loadHouseholdSnapshot(db, c.id, { events: true, stored: true });
      const back2 = await loadHouseholdSnapshot(db, c2.id, { events: true, stored: true });
      for (const snap of [back, back2]) {
        assert.deepEqual(
          { household: [snap.household.bankBalanceMinor, snap.household.paypalBalanceMinor, snap.household.splitSince, snap.household.homeCurrency], members: sorted(snap.members), cards: sorted(snap.cards), statements: sorted(snap.statements), clients: sorted(snap.clients),
            pots: sorted(snap.pots), balanceUpdates: sorted(snap.balanceUpdates), charges: sorted(snap.charges.map(x => ({ ...x, documentId: null }))), bills: sorted(snap.bills.map(x => ({ ...x, documentId: null }))),
            invoices: sorted(snap.invoices.map(x => ({ ...x, paypalInvoiceId: null, paypalStatus: null }))), settlements: sorted(snap.settlements), memory: sorted(snap.memory!), canvases: sorted(snap.canvases!), journal: sorted(snap.journal!) },
          { household: [exported.household.bankBalanceMinor, exported.household.paypalBalanceMinor, exported.household.splitSince, exported.household.homeCurrency], members: sorted(exported.members), cards: sorted(exported.cards), statements: sorted(exported.statements), clients: sorted(exported.clients),
            pots: sorted(exported.pots), balanceUpdates: sorted(exported.balanceUpdates), charges: sorted(exported.charges.map(x => ({ ...x, documentId: null }))), bills: sorted(exported.bills.map(x => ({ ...x, documentId: null }))),
            invoices: sorted(exported.invoices.map(x => ({ ...x, paypalInvoiceId: null, paypalStatus: null }))), settlements: sorted(exported.settlements), memory: sorted(exported.memory!), canvases: sorted(exported.canvases!), journal: sorted(exported.journal!) },
        );
      }
      // Every id is new, in both households and across them; the owner is the household's own.
      const idsOf = (snap: typeof back) => [snap.cards, snap.statements, snap.charges, snap.bills, snap.clients, snap.invoices, snap.pots, snap.settlements, snap.balanceUpdates, snap.memory!, snap.canvases!, snap.journal!].flatMap(list => list.map(x => x.id));
      const sourceIds = new Set([...idsOf(exported), ...exported.members.map(m => m.id)]);
      const ids1 = idsOf(back), ids2 = idsOf(back2);
      assert.ok(ids1.length > 20);
      assert.ok(ids1.every(id => !sourceIds.has(id)) && ids2.every(id => !sourceIds.has(id)) && ids1.every(id => !ids2.includes(id)), "all ids are new");
      assert.equal(back.members.find(x => x.role === "owner")!.id, c.owner);
      assert.ok(!back.members.some(m => m.id === partner.id), "the partner has a new id");
      // References resolve inside the imported household.
      const memberIds = new Set(back.members.map(x => x.id)), cardIds = new Set(back.cards.map(x => x.id)), clientIds = new Set(back.clients.map(x => x.id)), billIds = new Set(back.bills.map(x => x.id));
      assert.ok(back.cards.every(x => x.memberId === null || memberIds.has(x.memberId)));
      assert.ok(back.charges.every(x => cardIds.has(x.cardId)) && back.statements.every(x => cardIds.has(x.cardId)));
      assert.ok(back.invoices.every(x => clientIds.has(x.clientId)) && back.invoices.length > 0);
      assert.ok(back.bills.every(x => (x.memberId === null || memberIds.has(x.memberId)) && (x.paidByMemberId === null || memberIds.has(x.paidByMemberId)) && (!x.seriesBillId || billIds.has(x.seriesBillId))));
      assert.ok(back.settlements.every(x => memberIds.has(x.fromMemberId) && memberIds.has(x.toMemberId)));
      assert.equal(back.bills.find(x => x.biller === "Fictional Power Nov")!.seriesBillId, back.bills.find(x => x.biller === "Fictional Power")!.id, "the amount-varies link survived");
      assert.deepEqual([back.bills.find(x => x.biller === "Fictional Power Nov")!.periodStart, back.bills.find(x => x.biller === "Fictional Power Nov")!.periodEnd], ["2026-10-01", "2026-10-31"], "the billing period round-trips");
      assert.deepEqual([exported.bills.find(x => x.biller === "Fictional Power")!.periodStart ?? null], [null], "a bill with no period exports none");
      assert.equal(back.bills.find(x => x.biller === "Fictional Power")!.repeatUntil, "2027-06-15", "the last payment survived Import (D41)");
      assert.equal(back.settlements[0].toMemberId, c.owner);
      const slidersPin = back.canvases!.find(p => p.title === "Sliders")!;
      const sliderClient = (slidersPin.recipe.blocks[0] as { controls: { clientId: string }[] }).controls[0].clientId;
      assert.ok(clientIds.has(sliderClient) && sliderClient !== pinSliders.clientId, "a recipe's client id is mapped");
      const journalTurn = back.journal![0], journalTurn2 = back2.journal![0];
      assert.notEqual(journalTurn.conversationId, convOne);
      assert.notEqual(journalTurn.conversationId, journalTurn2.conversationId);
      assert.deepEqual(back.canvases!.map(p => p.position), [0, 1, 2]);
      assert.deepEqual(back.memory!.map(x => x.madeBy).sort(), ["ask", "form"], "memory keeps who said it");
      assert.equal(back.documents.length, 0);
      assert.ok(back.invoices.every(i => i.paypalInvoiceId === null), "PayPal ids are never taken from a file");
      // The engine sees the same household: cash, the low point, the sentence.
      assert.deepEqual(await engine(c.id), sourceEngine);
      assert.deepEqual(await engine(c2.id), sourceEngine);
      assert.equal(exported.cards.find(x => x.id === aCardRow.id)!.foreignFeeBp, 220, "Ben's Card A carries its foreign fee (D62)");
      assert.deepEqual(back.cards.map(x => x.foreignFeeBp).sort(), exported.cards.map(x => x.foreignFeeBp).sort(), "the foreign fee round-trips");
      const abroad = back.charges.find(x => x.merchant === "Fictional Abroad Shop")!;
      assert.deepEqual([abroad.fxEstimated, abroad.originalAmountMinor, abroad.originalCurrency], [true, 2000, "USD"], "fx_estimated round-trips");
      // Every restored row is made_by import (checked in the database).
      for (const table of [schema.bills, schema.charges, schema.invoices, schema.pots, schema.balanceUpdates] as const) {
        const rows = await db.select().from(table).where(eq(table.householdId, c.id));
        assert.ok(rows.length === 0 || rows.every(r => r.madeBy === "import"), table === schema.bills ? "bills" : "table");
      }
      const events = await db.select().from(schema.events).where(eq(schema.events.householdId, c.id));
      assert.deepEqual(events.map(e => [e.kind, e.madeBy]), [["household_imported", "import"]]);
      assert.ok(!JSON.stringify(events).includes("Rent goes up"));
      // The source is untouched.
      assert.equal((await loadHouseholdSnapshot(db, a, { events: true, stored: true })).bills.length, exported.bills.length);
    });

    await check("Import refuses a household that has anything in it: a bill, a client, a pot, a memory, a second person", async () => {
      const file2 = JSON.parse(JSON.stringify({ ...exported, memory: [], canvases: [], journal: [] }));
      const refuse = async (prepare: (id: string, owner: string) => Promise<unknown>) => {
        const c = await emptyHousehold("Fictional Full " + randomUUID().slice(0, 4));
        await prepare(c.id, c.owner);
        await assert.rejects(restoreHousehold(db, c.id, file2), (e: unknown) => e instanceof InputError && e.message === NOT_EMPTY);
      };
      await refuse(id => db.insert(schema.bills).values({ householdId: id, biller: "Fictional Gym", amountMinor: 1000, currency: "JPY", due: "2026-12-01", category: "other" }));
      await refuse(id => db.insert(schema.clients).values({ householdId: id, name: "Fictional Client", email: "c@example.test" }));
      await refuse(id => db.insert(schema.pots).values({ householdId: id, name: "Fictional Pot", currency: "JPY" }));
      await refuse(id => addMemory(db, id, { kind: "fact", text: "Fictional fact" }, form));
      await refuse(id => db.insert(schema.members).values({ householdId: id, displayName: "Fictional Second", role: "member", shareBp: 0 }));
      // Restoring a second time into the household that was just filled is refused too.
      const [filled] = await db.select().from(schema.households).where(eq(schema.households.name, "Fictional Importer Three"));
      await assert.rejects(restoreHousehold(db, filled.id, file2), (e: unknown) => e instanceof InputError && e.message === NOT_EMPTY);
    });

    await check("an older file without foreignFeeBp and fxEstimated still imports (D62): the fee is not entered and the charge is not an estimate", async () => {
      const old = JSON.parse(JSON.stringify(file));
      for (const card of old.cards) delete card.foreignFeeBp;
      for (const charge of old.charges) delete charge.fxEstimated;
      const c = await emptyHousehold("Fictional Importer Old File");
      await restoreHousehold(db, c.id, old);
      const back = await loadHouseholdSnapshot(db, c.id, { events: true, stored: true });
      assert.ok(back.cards.every(x => x.foreignFeeBp === null));
      assert.ok(back.charges.length > 0 && back.charges.every(x => x.fxEstimated === false));
    });

    await check("the restored household's own data is its own: deleting its kinds works like any other and leaves B alone", async () => {
      const [filled] = await db.select().from(schema.households).where(eq(schema.households.name, "Fictional Importer Three"));
      assert.deepEqual([await countKind(db, filled.id, "memory"), await countKind(db, filled.id, "canvases"), await countKind(db, filled.id, "journal")], [2, 3, 1]);
      await deleteKind(db, filled.id, "memory", form);
      await deleteKind(db, filled.id, "canvases", form);
      await deleteKind(db, filled.id, "journal", form);
      assert.deepEqual(await countKinds(db, filled.id).then(x => [x.memory, x.canvases, x.journal]), [0, 0, 0]);
      const other = await countKinds(db, b);
      assert.deepEqual([other.memory, other.canvases, other.journal, other.documents], [1, 1, 1, 1]);
    });


    // ---------------------------------------------------------------- 24B: this device only (D59)
    await check("moving memory, canvases and conversations to the device leaves nothing on the server, and moving back restores the same items", async () => {
      const c = await seedBen(db, { isDemo: true });
      const mem = [await addMemory(db, c, { kind: "fact", text: "Rent goes up in April" }, form), await addMemory(db, c, { kind: "instruction", text: "Answer in Japanese" }, form)];
      const pins = [await pinCanvas(db, c, { title: "Cash", recipe: recipe("Cash") }, form), await pinCanvas(db, c, { title: "Bills", recipe: recipe("Bills") }, form)];
      const conv = randomUUID();
      const t = (question: string) => ({ id: randomUUID(), conversationId: conv, question, kind: "answer" as const, reply: "Yes.", choices: null, recipe: null, sources: [{ label: "Coming up", href: "/#coming-up" }] });
      const stored = [t("One?"), t("Two?")];
      for (const [i, x] of stored.entries()) await saveTurn(db, c, x, new Date(Date.UTC(2026, 10, 6, 1, i)));
      await db.update(schema.conversationTurns).set({ thumb: 1 }).where(eq(schema.conversationTurns.id, stored[0].id));
      assert.deepEqual(await readPlaces(db, c), { memory: "cloud", canvases: "cloud", journal: "cloud" });
      const events = async () => (await db.select().from(schema.events).where(eq(schema.events.householdId, c))).filter(e => e.kind === "data_moved");

      const taken: Record<string, { id: string }[]> = {};
      for (const kind of ["memory", "canvases", "journal"] as const) {
        taken[kind] = await itemsToMove(db, c, kind) as { id: string }[];
        // a set that changed since the browser read it moves nothing
        await assert.rejects(moveToDevice(db, c, kind, taken[kind].slice(1).map(i => i.id), form), (e: unknown) => e instanceof InputError && /Nothing was moved/.test(e.message));
        assert.equal((await readPlaces(db, c))[kind], "cloud");
        assert.equal(await countKind(db, c, kind), taken[kind].length, "refused: still on the server");
        assert.equal(await moveToDevice(db, c, kind, taken[kind].map(i => i.id), form), taken[kind].length);
        assert.equal(await countKind(db, c, kind), 0, `${kind}: nothing is left on the server`);
        assert.equal((await readPlaces(db, c))[kind], "device");
        await assert.rejects(moveToDevice(db, c, kind, [], form), (e: unknown) => e instanceof InputError && /already kept on this device/.test(e.message));
        await assert.rejects(itemsToMove(db, c, kind), InputError);
        await assert.rejects(requireCloud(db, c, kind), (e: unknown) => e instanceof InputError && /on this device only/.test(e.message));
      }
      const rows = await events();
      assert.equal(rows.length, 3, "one event for each move");
      assert.ok(rows.every(e => !/Rent|Japanese|Cash|Bills|One\?|Two\?/.test(e.title ?? "")), "an event never carries an item");
      assert.deepEqual((await db.select().from(schema.households).where(eq(schema.households.id, c)))[0].memoryPlace, "device");

      // back to the cloud: the browser posts what it holds (a bad item refuses the whole move)
      const bad = [{ ...taken.memory[0], text: "card 4111 1111 1111 1111" }];
      await assert.rejects(moveToCloud(db, c, "memory", bad, form), InputError);
      await assert.rejects(moveToCloud(db, c, "memory", [{ id: "nope" }], form), InputError);
      assert.equal(await countKind(db, c, "memory"), 0);
      for (const kind of ["memory", "canvases", "journal"] as const) {
        assert.equal(await moveToCloud(db, c, kind, taken[kind], form), taken[kind].length);
        assert.equal((await readPlaces(db, c))[kind], "cloud");
      }
      await assert.rejects(moveToCloud(db, c, "memory", [], form), (e: unknown) => e instanceof InputError && /already kept in our cloud/.test(e.message));
      assert.deepEqual((await listMemory(db, c)).map(m => m.id).sort(), mem.map(m => m.id).sort());
      assert.deepEqual((await listCanvases(db, c)).map(p => [p.id, p.title, p.position]), pins.map(p => [p.id, p.title, p.position]));
      const turns = await allTurns(db, c);
      assert.deepEqual(turns.map(x => x.id), stored.map(x => x.id));
      assert.equal(turns[0].thumb, 1, "the thumb comes back");
      assert.equal((await events()).length, 6);
    });

    await check("a cloud write for a kind kept on the device is refused, so a kind is never in both places", async () => {
      const c = await seedBen(db, { isDemo: true });
      await addMemory(db, c, { kind: "fact", text: "Something" }, form);
      const ids = (await itemsToMove(db, c, "memory") as { id: string }[]).map(i => i.id);
      await moveToDevice(db, c, "memory", ids, form);
      await assert.rejects(requireCloud(db, c, "memory"), InputError);
      await requireCloud(db, c, "canvases");
      await requireCloud(db, c, "journal");
    });

    await check("memory operations: the same rules as the cloud (400 characters, no 12-digit run, 200 items, one item for the same words), and a change list applies in order", () => {
      const now = new Date("2026-11-06T01:00:00Z");
      let items: MemoryItem[] = [];
      const a = addMemoryItem(items, { kind: "fact", text: "Rent goes up in April" }, { madeBy: "ask", askId: randomUUID() }, now, randomUUID());
      assert.equal(a.added, true);
      items = a.items;
      assert.equal(addMemoryItem(items, { kind: "fact", text: "Rent goes up in April" }, { madeBy: "form" }, now, randomUUID()).added, false);
      assert.throws(() => addMemoryItem(items, { kind: "fact", text: "x".repeat(401) }, { madeBy: "form" }, now, randomUUID()), InputError);
      assert.throws(() => addMemoryItem(items, { kind: "fact", text: "my card 4111 1111 1111 1111" }, { madeBy: "form" }, now, randomUUID()), InputError);
      assert.throws(() => addMemoryItem(items, { kind: "nonsense", text: "x" }, { madeBy: "form" }, now, randomUUID()), InputError);
      const full = Array.from({ length: 200 }, (_, i) => ({ ...a.item, id: randomUUID(), text: `Fact ${i}` }));
      assert.throws(() => addMemoryItem(full, { kind: "fact", text: "One more" }, { madeBy: "form" }, now, randomUUID()), /200 things/);
      const b = addMemoryItem(items, { kind: "goal", text: "A trip in March" }, { madeBy: "form" }, now, randomUUID());
      assert.deepEqual(b.items.map(i => i.kind), ["fact", "goal"], "page order of the kinds");
      assert.equal(editMemoryItem(b.items, b.item.id, { text: "A trip in April" }, now)?.item.text, "A trip in April");
      assert.throws(() => editMemoryItem(b.items, b.item.id, { kind: "fact", text: "Rent goes up in April" }, now), /already knows/);
      assert.equal(editMemoryItem(b.items, randomUUID(), { text: "x" }, now), null);
      assert.deepEqual(forgetMemoryItem(b.items, a.item.id).items.map(i => i.id), [b.item.id]);
      assert.equal(forgetMemoryItem(b.items, randomUUID()).removed, false);
      const changed = applyMemoryChanges(items, [{ op: "add", item: b.item }, { op: "forget", id: a.item.id }, { op: "forget", id: randomUUID() }]);
      assert.deepEqual(changed.map(i => i.id), [b.item.id]);
      assert.throws(() => applyMemoryChanges(items, [{ op: "add", item: { id: "x" } }]));
    });

    await check("journal and pin operations: 200 turns, ten minutes, the last three, at most 8 pins in order", () => {
      const conv = randomUUID();
      const turn = (i: number, conversationId = conv): ConversationTurn => ({
        version: 1, id: randomUUID(), conversationId, question: `Q${i}`, kind: "answer", reply: "Yes.", choices: null, recipe: null, sources: [], thumb: null, createdAt: new Date(Date.UTC(2026, 10, 6, 1, 0, i)).toISOString(),
      });
      let turns: ConversationTurn[] = [];
      for (let i = 0; i < 205; i++) turns = appendTurn(turns, turn(i));
      assert.equal(turns.length, 200);
      assert.equal(turns[0].question, "Q5", "the oldest five went");
      assert.equal(appendTurn(turns, turns[3]).length, 200, "a retried question is one turn");
      const near = new Date(Date.UTC(2026, 10, 6, 1, 5)), far = new Date(Date.UTC(2026, 10, 6, 1, 30));
      assert.deepEqual(recentOf(turns, conv, near).map(x => x.question), ["Q202", "Q203", "Q204"]);
      assert.deepEqual(recentOf(turns, conv, far), [], "older than ten minutes");
      assert.deepEqual(recentOf(turns, randomUUID(), near), []);
      assert.equal(latestOf(turns, near)?.turns.length, 200);
      assert.equal(latestOf(turns, far), null);
      const other = turn(300, randomUUID());
      assert.equal(latestOf([...turns, other], new Date(Date.UTC(2026, 10, 6, 1, 6)))?.conversationId, other.conversationId);

      const r = recipe("Cash"), at = new Date("2026-11-06T01:00:00Z");
      let pins: DevicePin[] = [];
      for (let i = 0; i < MAX_PINS; i++) pins = pinItem(pins, { title: `Pin ${i}`, recipe: r }, at, randomUUID());
      assert.throws(() => pinItem(pins, { title: "Ninth", recipe: r }, at, randomUUID()), /Unpin one first/);
      assert.throws(() => pinItem([], { title: "", recipe: r }, at, randomUUID()), InputError);
      assert.throws(() => pinItem([], { title: "Bad", recipe: { version: 1, title: "Bad", blocks: [{ type: "number", label: "Cash", amount: 5, query: { q: "cash" } }] } }, at, randomUUID()), InputError);
      const moved = movePin(pins, pins[0].id, "down")!;
      assert.deepEqual(moved.slice(0, 2).map(p => p.title), ["Pin 1", "Pin 0"]);
      assert.deepEqual(moved.map(p => p.position), [0, 1, 2, 3, 4, 5, 6, 7]);
      assert.deepEqual(movePin(pins, pins[0].id, "up")!.map(p => p.title), pins.map(p => p.title), "past an end changes nothing");
      assert.equal(movePin(pins, randomUUID(), "up"), null);
      const gone = unpinItem(moved, moved[0].id)!;
      assert.deepEqual([gone.length, gone[0].position, gone[6].position], [7, 0, 6]);
      assert.equal(updatePin(pins, randomUUID(), r), null);
      assert.equal(updatePin(pins, pins[2].id, recipe("Changed"))![2].recipe.title, "Changed");
      assert.ok(DEVICE_MEMORY_WORDS.includes("one device"));
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
