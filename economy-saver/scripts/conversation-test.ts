// The Ask conversation and the pins on Home (D60, D57): all turns kept, the context budget, thumbs, the pins' order and cap,
// scope across households, and removal with the household or by Reset. Fictional data only; PGlite, no credentials.
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { listCanvases, MAX_PINS, moveCanvas, pinCanvas, unpinCanvas, updateCanvas } from "@/db/canvases";
import { allTurns, saveTurn, setThumb, spaceThread, type NewTurn } from "@/db/conversation";
import { resetDemoHousehold } from "@/db/demo";
import { InputError } from "@/db/input-error";
import { deleteHousehold, listEvents, type Db } from "@/db/household";
import { seedBen } from "@/db/seed";
import { RECIPE_VERSION, type Recipe } from "@/lib/canvas/schema";
import { ConversationTurn, splitSources, storeSources } from "@/lib/schema/turn";
import { assembleContext } from "@/db/ask";
import { contextTail, THREAD_CONTEXT_MAX, turnWords } from "@/lib/agent/context";
import { loadHouseholdSnapshot } from "@/db/snapshot";
import { restoreHousehold } from "@/db/restore";
import { HouseholdSnapshot } from "@/lib/schema/household";
import { householdDate } from "@/db/account";
import { draftsOfTurns } from "@/db/ask-drafts";
import { setBankBalance } from "@/db/bank-balance";
import { billInput, insertBill, removeBill } from "@/db/bills";
import { chargeInput, insertCharge, removeCharge } from "@/db/charges";
import { confirmPending } from "@/db/confirm";
import { loadMoneyState } from "@/db/household";
import { addMember } from "@/db/people";
import { potInput, savePot } from "@/db/pots";
import { loadSpending } from "@/db/spending";
import type { ViewResult } from "@/lib/views/types";
import { chipOf } from "@/lib/agent/draft-card";
import { HISTORY_MONTHS, monthBounds, monthsBack } from "@/lib/money/spending";

const T0 = new Date("2026-11-06T09:00:00Z");
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);
const recipe = (title: string): Recipe => ({ version: RECIPE_VERSION, title, blocks: [{ type: "number", label: "Cash today", query: { q: "cash" } }] });
const turn = (conversationId: string, question: string, extra: Partial<NewTurn> = {}): NewTurn => ({
  id: crypto.randomUUID(), conversationId, question, kind: "answer", reply: `Reply to ${question}`, choices: null, recipe: null, sources: [], ...extra,
});

async function main() {
  const pg = new PGlite({ extensions: { pg_trgm } });
  const db = drizzle(pg, { schema }) as unknown as Db;
  let passed = 0;
  async function check(name: string, run: () => void | Promise<void>) { await run(); passed++; console.log(`✓ ${name}`); }
  try {
    await migrate(drizzle(pg, { schema }), { migrationsFolder: "./drizzle" });
    const a = await seedBen(db, { isDemo: true }), b = await seedBen(db, { isDemo: true });
    const conv = crypto.randomUUID();

    await check("a turn keeps the links of what it saved beside its sources, and an older turn without them still loads", async () => {
      const links = [{ label: "Open To check", href: "/to-check" }];
      const sources = [{ label: "Clients", href: "/clients" }];
      const saved = turn(crypto.randomUUID(), "Groceries 8400 with Aki", { sources: storeSources(sources, links) });
      const older = turn(saved.conversationId, "Older question", { sources });
      await saveTurn(db, b, saved, at(30)); await saveTurn(db, b, older, at(31));
      const [back, plain] = await spaceThread(db, b, saved.conversationId);
      assert.doesNotThrow(() => ConversationTurn.parse(back));
      assert.deepEqual(splitSources(back.sources), { sources, links });
      assert.deepEqual(splitSources(plain.sources), { sources, links: [] });
    });

    await check("a turn is saved with its sources, choices and recipe, and reads back valid against the schema", async () => {
      const first = turn(conv, "What is due?", { sources: [{ label: "Coming up", href: "/#coming-up" }], recipe: recipe("Cash") });
      const clarify = turn(conv, "Invoice Acme", { kind: "clarify", reply: "Which one?", choices: ["Acme Studio", "Acme Labs"] });
      await saveTurn(db, a, first, at(0));
      await saveTurn(db, a, clarify, at(1));
      const turns = await allTurns(db, a);
      assert.deepEqual(turns.map(t => t.question), ["What is due?", "Invoice Acme"]);
      for (const t of turns) assert.doesNotThrow(() => ConversationTurn.parse(t));
      assert.deepEqual(turns[1].choices, ["Acme Studio", "Acme Labs"]);
      assert.equal(turns[0].recipe?.title, "Cash");
      assert.equal(turns[0].thumb, null);
    });

    await check("a retried question (same id) is one row", async () => {
      const again = turn(conv, "Retried", { id: crypto.randomUUID() });
      await saveTurn(db, a, again, at(2));
      await saveTurn(db, a, { ...again, reply: "Another words" }, at(2));
      assert.equal((await allTurns(db, a)).filter(t => t.id === again.id).length, 1);
    });

    await check("the context has no clock cutoff or fixed turn count, and another thread stays out", async () => {
      await saveTurn(db, a, turn(conv, "Fourth"), at(4));
      const c = crypto.randomUUID();
      await saveTurn(db, a, turn(c, "Newer unrelated conversation"), at(6));
      const context = await assembleContext(db, a, { conversationId: conv, canvas: null });
      for (const text of ["What is due?", "Invoice Acme", "Retried", "Fourth"]) assert.ok(context.context.includes(text));
      assert.ok(!context.context.includes("Newer unrelated conversation"));
    });

    await check("thumbs: set, change, clear", async () => {
      const [first] = await allTurns(db, a);
      assert.equal(await setThumb(db, a, first.id, 1), true);
      assert.equal((await allTurns(db, a))[0].thumb, 1);
      assert.equal(await setThumb(db, a, first.id, -1), true);
      assert.equal((await allTurns(db, a))[0].thumb, -1);
      assert.equal(await setThumb(db, a, first.id, null), true);
      assert.equal((await allTurns(db, a))[0].thumb, null);
      await assert.rejects(setThumb(db, a, first.id, 5 as never), "the database holds the line too");
      await assert.rejects(setThumb(db, "", first.id, 1), /household id/);
    });

    await check("a thread keeps all turns, including the oldest", async () => {
      const earlier = await allTurns(db, a);
      const thread = crypto.randomUUID();
      for (let i = 0; i < 205; i++) await saveTurn(db, a, turn(thread, `Bulk ${i}`), at(100 + i));
      const turns = await allTurns(db, a);
      assert.equal(turns.length, earlier.length + 205);
      assert.deepEqual(turns.slice(0, earlier.length), earlier);
      assert.equal(turns[earlier.length].question, "Bulk 0");
      assert.equal(turns.at(-1)!.question, "Bulk 204");
    });

    await check("the question is 1 to 320 characters and the kind is one of four", async () => {
      await assert.rejects(saveTurn(db, b, turn(conv, ""), at(1)));
      await assert.rejects(saveTurn(db, b, turn(conv, "x".repeat(321)), at(1)));
      await assert.rejects(saveTurn(db, b, turn(conv, "ok", { kind: "other" as never }), at(1)));
    });


    // ------------------------------------------------------------ D60: a turn that holds a file
    const waitingSet = async (hid: string, status: "queued" | "reading" | "read" | "failed", reading?: "to_check" | "confirmed" | "rejected") => {
      const [doc] = await db.insert(schema.documents).values({ householdId: hid, kind: "upload", storagePath: `${hid}/${crypto.randomUUID()}.pdf`, mime: "application/pdf", status }).returning();
      if (reading) await db.insert(schema.readings).values({ householdId: hid, documentId: doc.id, extracted: {}, status: reading, target: "bill" });
      return doc.id;
    };
    const documentTurn = (conversationId: string, documentId: string) => turn(conversationId, "Here's my bill", { kind: "document", reply: "Reading your bill…", documentId });

    await check("a document turn saves and reads back with its documentId; an ordinary turn has no documentId key; the database refuses other kinds", async () => {
      const c = crypto.randomUUID(), doc = await waitingSet(a, "queued");
      const t = documentTurn(c, doc);
      await saveTurn(db, a, t, at(1000));
      await saveTurn(db, a, turn(c, "Plain"), at(1001));
      const [back, plain] = (await allTurns(db, a)).filter(x => x.conversationId === c);
      assert.equal(back.kind, "document");
      assert.equal(back.documentId, doc);
      assert.doesNotThrow(() => ConversationTurn.parse(back));
      assert.equal("documentId" in plain, false);
      assert.doesNotThrow(() => ConversationTurn.parse(plain));
      await assert.rejects(saveTurn(db, b, turn(c, "no", { kind: "other" as never }), at(1)));
    });

    await check("the budget drops oldest turns and always carries the retained document cards", async () => {
      const c = crypto.randomUUID(), doc = await waitingSet(a, "queued");
      await saveTurn(db, a, turn(c, "Omitted old", { reply: "a".repeat(6000) }), at(2000));
      await saveTurn(db, a, turn(c, "Retained newer", { reply: "b".repeat(6000) }), at(2001));
      await saveTurn(db, a, documentTurn(c, doc), at(2002));
      const raw = await spaceThread(db, a, c);
      const tail = contextTail(raw);
      assert.equal(tail.omitted, 1);
      assert.ok(tail.turns.map(turnWords).join("\n").length <= THREAD_CONTEXT_MAX);
      const context = await assembleContext(db, a, { conversationId: c, canvas: null });
      assert.ok(context.context.includes("1 earlier turn remains"));
      assert.ok(!context.context.includes("Omitted old"));
      assert.ok(context.context.includes("Retained newer"));
      assert.ok(context.context.includes(doc));
      assert.match(context.context, /Cards for the attached documents[\s\S]*Reading your bill/);
    });

    await check("a household file with a document turn parses, and Import keeps the kind but not the document", async () => {
      const c = crypto.randomUUID(), doc = await waitingSet(a, "queued");
      await saveTurn(db, a, documentTurn(c, doc), at(30_000));
      const exported = await loadHouseholdSnapshot(db, a, { events: true, stored: true });
      assert.ok(exported.journal!.some(t => t.kind === "document" && t.documentId === doc));
      const file = JSON.parse(JSON.stringify(exported));
      assert.doesNotThrow(() => HouseholdSnapshot.parse(file));
      const [h] = await db.insert(schema.households).values({ name: "Fictional Importer", homeCurrency: "JPY", bankBalanceMinor: 1, isDemo: false }).returning();
      const [owner] = await db.insert(schema.members).values({ householdId: h.id, displayName: "Fictional Importer", role: "owner", shareBp: 10_000 }).returning();
      await db.insert(schema.paypalConnections).values({ householdId: h.id, memberId: owner.id, balanceCurrency: "JPY" });
      await db.insert(schema.cards).values({ householdId: h.id, memberId: owner.id, label: "Setup card", currency: "JPY", closingDay: 25, dueDay: 10 });
      await db.insert(schema.fxRates).values({ householdId: h.id, date: "2026-11-01", base: "USD", quote: "JPY", rateMicro: 150_000_000 });
      await restoreHousehold(db, h.id, file);
      const back = (await allTurns(db, h.id)).filter(t => t.kind === "document");
      assert.ok(back.length >= 1);
      assert.ok(back.every(t => !("documentId" in t)));
    });

    // The test documents have no stored file; remove them (their readings go with them) so deleting a household needs no storage.
    await db.delete(schema.documents);

    // ------------------------------------------------------------ pins
    await check("pins keep their order, the ninth is refused, and every change records its event", async () => {
      const made: string[] = [];
      for (let i = 0; i < MAX_PINS; i++) made.push((await pinCanvas(db, a, { title: `Pin ${i}`, recipe: recipe(`Pin ${i}`) }, { madeBy: "form" })).id);
      assert.deepEqual((await listCanvases(db, a)).map(p => p.position), [0, 1, 2, 3, 4, 5, 6, 7]);
      await assert.rejects(pinCanvas(db, a, { title: "One too many", recipe: recipe("x") }, { madeBy: "form" }), (error: Error) => error instanceof InputError && error.message === "Unpin one first.");
      assert.equal(await moveCanvas(db, a, made[3], "up", { madeBy: "form" }), true);
      assert.deepEqual((await listCanvases(db, a)).map(p => p.title).slice(0, 5), ["Pin 0", "Pin 1", "Pin 3", "Pin 2", "Pin 4"]);
      assert.equal(await moveCanvas(db, a, made[0], "up", { madeBy: "form" }), true, "moving the first one up changes nothing");
      assert.equal((await listCanvases(db, a))[0].title, "Pin 0");
      assert.equal(await moveCanvas(db, a, made[7], "down", { madeBy: "form" }), true);
      assert.equal((await listCanvases(db, a)).at(-1)!.title, "Pin 7");
      assert.equal(await unpinCanvas(db, a, made[1], { madeBy: "form" }), true);
      assert.deepEqual((await listCanvases(db, a)).map(p => p.position), [0, 1, 2, 3, 4, 5, 6], "the gap closes");
      const kinds = (await listEvents(db, a)).map(e => e.kind);
      assert.equal(kinds.filter(k => k === "canvas_pinned").length, 8);
      assert.ok(kinds.includes("canvas_changed") && kinds.includes("canvas_unpinned"));
      await pinCanvas(db, a, { title: "Eight again", recipe: recipe("Eight again") }, { madeBy: "form" });
    });

    await check("a pin is checked: a bad recipe, a title that is too long and an amount in a block are refused; update replaces the recipe", async () => {
      const mine = (await listCanvases(db, a))[0];
      await assert.rejects(updateCanvas(db, a, mine.id, { version: 1, title: "x", blocks: [{ type: "number", label: "Cash", amount: 5, query: { q: "cash" } }] }, { madeBy: "form" }), InputError);
      await assert.rejects(unpinCanvas(db, a, "not-a-uuid", { madeBy: "form" }).then(ok => { if (!ok) throw new InputError("gone"); }), InputError).catch(() => undefined);
      assert.equal(await updateCanvas(db, a, mine.id, recipe("Changed"), { madeBy: "form" }), true);
      assert.equal((await listCanvases(db, a))[0].recipe.title, "Changed");
      await assert.rejects(pinCanvas(db, b, { title: "x".repeat(81), recipe: recipe("x") }, { madeBy: "form" }), InputError);
      await assert.rejects(pinCanvas(db, b, { title: "ok", recipe: { ...recipe("x"), extra: 1 } }, { madeBy: "form" }), InputError);
    });

    await check("a turn's drafts are read from the rows now: waiting, confirmed, then not added, for a bill, a charge, a pot and a balance", async () => {
      const d = await seedBen(db, { isDemo: true });
      const aki = await addMember(db, d, { name: "Aki" });
      const [card] = await db.select().from(schema.cards).where(eq(schema.cards.householdId, d));
      const owners = await db.select().from(schema.members).where(eq(schema.members.householdId, d));
      await db.update(schema.cards).set({ memberId: owners.find(m => m.displayName === "Ben")!.id }).where(eq(schema.cards.id, card.id));
      const rowsOf = (draft: { result: ViewResult | null }) => (draft.result as ViewResult<"before_after">).data!.rows;
      const today = await householdDate(db, d);
      const context = async () => {
        const state = await loadMoneyState(db, d, today);
        const current = today.slice(0, 7);
        return { state, spending: await loadSpending(db, d, { from: monthBounds(monthsBack(current, HISTORY_MONTHS)).first, to: monthBounds(current).last }) };
      };
      const turnId = crypto.randomUUID(), by = { madeBy: "ask", askId: turnId } as const;
      const ids = { bill: crypto.randomUUID(), charge: crypto.randomUUID(), pot: crypto.randomUUID(), balance: crypto.randomUUID() };
      await insertBill(db, d, billInput.parse({ id: ids.bill, biller: "Fictional Water Works", amount: "6200", due: today.slice(0, 8) + "28", category: "utilities", memberId: aki }), "pending", by);
      await insertCharge(db, d, chargeInput.parse({ id: ids.charge, cardId: card.id, merchant: "Fictional Market", amount: "8400", date: today, category: "food", shared: true }), "pending", "manual", by);
      await savePot(db, d, potInput.parse({ id: ids.pot, name: "Trip to Osaka", target: "60000", targetDate: "2027-03-31", fillPct: "10" }), "pending", by);
      await setBankBalance(db, d, { id: ids.balance, amount: "92000" }, "pending", by);
      const other = crypto.randomUUID();
      await insertBill(db, d, billInput.parse({ id: crypto.randomUUID(), biller: "Fictional unrelated", amount: "100", due: today, category: "other" }), "pending", { madeBy: "ask", askId: other });
      await insertBill(db, d, billInput.parse({ id: crypto.randomUUID(), biller: "Fictional by hand", amount: "100", due: today, category: "other" }), "pending", { madeBy: "form" });

      let read = await draftsOfTurns(db, d, [turnId], await context());
      const [bill, charge, pot, balance] = read[turnId];
      assert.deepEqual(read[turnId].map(x => [x.kind, x.state]), [["bill", "waiting"], ["charge", "waiting"], ["pot", "waiting"], ["balance", "waiting"]]);
      assert.equal(chipOf(read[turnId]), "waiting");
      assert.equal(Object.keys(read).length, 1, "only the turns asked about; a draft by hand belongs to no turn");
      assert.deepEqual(bill.fields.map(f => f.label), ["Item", "Due", "Category", "Whose"]);
      assert.equal(bill.fields[0].value, "Fictional Water Works · ¥6,200");
      assert.equal(charge.fields.find(f => f.label === "Shared")?.value, "Ben ¥4,200, Aki ¥4,200");
      assert.equal(pot.fields.find(f => f.label === "Target")?.value, "¥60,000 by Mar 31");
      assert.equal(balance.fields[0].value, "¥92,000");
      for (const draft of read[turnId]) { assert.equal(draft.result?.view, "what_changed"); assert.equal(draft.result?.figures.status, "pending"); assert.equal(draft.saved, null); }
      const owed = rowsOf(charge).find(row => row.key.startsWith("owed-"));
      assert.equal(owed?.change, "+¥8,400", "the charge moves the card's owed amount by exactly its amount");
      assert.ok(rowsOf(charge).some(row => row.label === "Aki owes Ben" && row.after === "¥4,200"));
      assert.equal(rowsOf(balance).find(row => row.key === "bank")?.after, "¥92,000");
      assert.equal(bill.remove, "/api/remove"); assert.equal(pot.remove, "/api/pots/remove"); assert.equal(balance.remove, null, "To check has no way to remove a balance update");

      for (const kind of ["charge", "pot", "balance"] as const) assert.equal(await confirmPending(db, d, kind, ids[kind]), true);
      read = await draftsOfTurns(db, d, [turnId], await context());
      assert.deepEqual(read[turnId].map(x => [x.kind, x.state]), [["bill", "waiting"], ["charge", "confirmed"], ["pot", "confirmed"], ["balance", "confirmed"]]);
      assert.equal(chipOf(read[turnId]), "waiting", "one still waiting keeps the chip on waiting");
      const [, c2, p2, b2] = read[turnId];
      assert.equal(c2.title, `What changed: Fictional Market ¥8,400 on ${card.label}`);
      assert.equal(c2.saved?.line.startsWith("Fictional Market · ¥8,400"), true);
      assert.deepEqual(c2.result?.table?.head, ["", "Without it", "With it", "Change"]);
      assert.equal(c2.result?.figures.status, "confirmed");
      const moved = (draft: { result: ViewResult | null }) => rowsOf(draft).filter(row => row.change !== null && row.key !== "low").map(row => [row.key, row.before, row.after]);
      assert.deepEqual(moved(c2), moved(charge), "after Confirm it shows the same two sides");
      assert.equal(p2.title, "What changed: Pot \u201cTrip to Osaka\u201d");
      assert.equal(p2.result?.figures.status, "confirmed");
      assert.deepEqual(rowsOf(pot)[0], { key: "pots", label: "Saving pots", before: "0", after: "1", change: "+1" });
      assert.deepEqual(rowsOf(p2)[0], rowsOf(pot)[0], "a saved pot reads the same count, from the engine");
      assert.deepEqual(p2.result?.table?.head, ["", "Without it", "With it", "Change"]);
      assert.match(pot.fields.find(f => f.label === "To get there")?.value ?? "", /^¥1[25],000 a month$/, "the monthly sum comes from the goal engine");
      assert.ok(rowsOf(charge).every(row => row.key !== "low"), "the lowest-day row is left out when the item does not move it");
      assert.equal(b2.result, null, "a saved balance keeps only its new amount, so there is no before to draw");
      assert.equal(b2.saved?.line, "Bank balance ¥92,000");
      assert.equal(b2.state, "confirmed");
      assert.ok(b2.places.some(place => place.href === "/"));

      assert.equal(await removeBill(db, d, ids.bill), true);
      read = await draftsOfTurns(db, d, [turnId], await context());
      assert.equal(read[turnId][0].state, "not_added");
      assert.equal(read[turnId][0].name, "Fictional Water Works");
      assert.equal(chipOf(read[turnId]), "confirmed");
      assert.equal(chipOf([{ state: "not_added" }]), "not_added");
      assert.equal(chipOf([]), null);
      assert.equal(await removeCharge(db, d, ids.charge), true);
      read = await draftsOfTurns(db, d, [turnId, other], await context());
      assert.equal(read[turnId][1].state, "not_added");
      assert.deepEqual(read[other].map(x => x.state), ["waiting"]);
      assert.deepEqual(await draftsOfTurns(db, a, [turnId], await context()), {}, "another household's turn id reads nothing");
    });

    await check("turns and pins go with the household, and a Reset starts clean", async () => {
      const c = await seedBen(db, { isDemo: true });
      await saveTurn(db, c, turn(crypto.randomUUID(), "Gone with the household"), at(0));
      await pinCanvas(db, c, { title: "Gone", recipe: recipe("Gone") }, { madeBy: "form" });
      const reset = await resetDemoHousehold(db, c);
      assert.ok(reset && reset !== c);
      assert.equal((await db.select().from(schema.conversationTurns).where(eq(schema.conversationTurns.householdId, c))).length, 0);
      assert.equal((await db.select().from(schema.canvases).where(eq(schema.canvases.householdId, c))).length, 0);
      assert.equal((await allTurns(db, reset)).length + (await listCanvases(db, reset)).length, 0);
      await saveTurn(db, b, turn(crypto.randomUUID(), "Will be deleted"), at(0));
      await pinCanvas(db, b, { title: "Will be deleted", recipe: recipe("x") }, { madeBy: "form" });
      await deleteHousehold(db, b);
      assert.equal((await db.select().from(schema.conversationTurns).where(eq(schema.conversationTurns.householdId, b))).length, 0);
      assert.equal((await db.select().from(schema.canvases).where(eq(schema.canvases.householdId, b))).length, 0);
    });

    console.log(`Conversation checks passed (${passed}).`);
  } finally {
    await pg.close();
  }
}

main().catch(error => { console.error("Conversation tests failed", error instanceof Error ? error.stack?.split("\n").slice(0, 6).join("\n") : error); process.exit(1); });
