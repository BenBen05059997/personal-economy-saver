// The Ask conversation and the pins on Home (D60, D57): turns kept 200 a household, the ten-minute window, thumbs, the pins' order and cap,
// scope across households, and removal with the household or by Reset. Fictional data only; PGlite, no credentials.
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { listCanvases, MAX_PINS, moveCanvas, pinCanvas, unpinCanvas, updateCanvas } from "@/db/canvases";
import { allTurns, latestConversation, recentTurns, saveTurn, setThumb, type NewTurn } from "@/db/conversation";
import { resetDemoHousehold } from "@/db/demo";
import { InputError } from "@/db/input-error";
import { deleteHousehold, listEvents, type Db } from "@/db/household";
import { seedBen } from "@/db/seed";
import { RECIPE_VERSION, type Recipe } from "@/lib/canvas/schema";
import { ConversationTurn } from "@/lib/schema/turn";

const T0 = new Date("2026-11-06T09:00:00Z");
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);
const recipe = (title: string): Recipe => ({ version: RECIPE_VERSION, title, blocks: [{ type: "number", label: "Cash today", query: { q: "cash" } }] });
const turn = (conversationId: string, question: string, extra: Partial<NewTurn> = {}): NewTurn => ({
  id: crypto.randomUUID(), conversationId, question, kind: "answer", reply: `Reply to ${question}`, choices: null, recipe: null, sources: [], ...extra,
});

async function main() {
  const pg = new PGlite();
  const db = drizzle(pg, { schema }) as unknown as Db;
  let passed = 0;
  async function check(name: string, run: () => void | Promise<void>) { await run(); passed++; console.log(`✓ ${name}`); }
  try {
    await migrate(drizzle(pg, { schema }), { migrationsFolder: "./drizzle" });
    const a = await seedBen(db, { isDemo: true }), b = await seedBen(db, { isDemo: true });
    const conv = crypto.randomUUID();

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

    await check("recent turns are the last three, only while the latest turn is under ten minutes old", async () => {
      assert.deepEqual((await recentTurns(db, a, conv, at(3))).map(t => t.question), ["What is due?", "Invoice Acme", "Retried"]);
      await saveTurn(db, a, turn(conv, "Fourth"), at(4));
      assert.deepEqual((await recentTurns(db, a, conv, at(5))).map(t => t.question), ["Invoice Acme", "Retried", "Fourth"]);
      assert.equal((await recentTurns(db, a, conv, at(13))).length, 3, "nine minutes after the last turn");
      assert.equal((await recentTurns(db, a, conv, at(14))).length, 0, "ten minutes after the last turn");
      assert.deepEqual(await recentTurns(db, a, crypto.randomUUID(), at(5)), []);
    });

    await check("the latest conversation is the newest one while it is under ten minutes old, with all its turns", async () => {
      const other = crypto.randomUUID();
      await saveTurn(db, a, turn(other, "Newer conversation"), at(6));
      const latest = await latestConversation(db, a, at(8));
      assert.equal(latest?.conversationId, other);
      assert.deepEqual(latest?.turns.map(t => t.question), ["Newer conversation"]);
      assert.equal(await latestConversation(db, a, at(16)), null);
      assert.equal(await latestConversation(db, b, at(8)), null, "another household has none");
    });

    await check("thumbs: set, change, clear; another household's turn is refused", async () => {
      const [first] = await allTurns(db, a);
      assert.equal(await setThumb(db, a, first.id, 1), true);
      assert.equal((await allTurns(db, a))[0].thumb, 1);
      assert.equal(await setThumb(db, a, first.id, -1), true);
      assert.equal((await allTurns(db, a))[0].thumb, -1);
      assert.equal(await setThumb(db, a, first.id, null), true);
      assert.equal((await allTurns(db, a))[0].thumb, null);
      assert.equal(await setThumb(db, b, first.id, 1), false);
      assert.equal((await allTurns(db, a))[0].thumb, null);
      await assert.rejects(setThumb(db, a, first.id, 5 as never), "the database holds the line too");
      await assert.rejects(setThumb(db, "", first.id, 1), /household id/);
    });

    await check("at most 200 turns a household: the oldest go in the same transaction, another household is untouched", async () => {
      await saveTurn(db, b, turn(crypto.randomUUID(), "Household b keeps this"), at(0));
      const thread = crypto.randomUUID();
      for (let i = 0; i < 205; i++) await saveTurn(db, a, turn(thread, `Bulk ${i}`), at(100 + i));
      const turns = await allTurns(db, a);
      assert.equal(turns.length, 200);
      assert.equal(turns[0].question, "Bulk 5");
      assert.equal(turns.at(-1)!.question, "Bulk 204");
      assert.equal((await allTurns(db, b)).length, 1);
    });

    await check("the question is 1 to 320 characters and the kind is one of three", async () => {
      await assert.rejects(saveTurn(db, b, turn(conv, ""), at(1)));
      await assert.rejects(saveTurn(db, b, turn(conv, "x".repeat(321)), at(1)));
      await assert.rejects(saveTurn(db, b, turn(conv, "ok", { kind: "other" as never }), at(1)));
    });

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

    await check("another household's pins cannot be changed, moved or removed, and are not listed", async () => {
      const [theirs] = await listCanvases(db, a);
      assert.equal(await updateCanvas(db, b, theirs.id, recipe("Hijack"), { madeBy: "form" }), false);
      assert.equal(await moveCanvas(db, b, theirs.id, "down", { madeBy: "form" }), false);
      assert.equal(await unpinCanvas(db, b, theirs.id, { madeBy: "form" }), false);
      assert.equal((await listCanvases(db, b)).length, 0);
      assert.equal((await listCanvases(db, a))[0].title, theirs.title);
      await assert.rejects(listCanvases(db, ""), /household id/);
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
