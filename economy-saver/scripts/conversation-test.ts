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
