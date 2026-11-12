// "Here's my bill" in Ask (D61), the server half: a file attached through Upload's storage and reader, the card drawn by code from its readings,
// Confirm refused while a question the card asked is unanswered, the canvas with the bill marked, and the document turn in the conversation context.
// The reader is faked as reader-test does it: globalThis.fetch answers for Storage and for the model. Fictional data only; PGlite, no credentials.
// Run from the project root: npx tsx --tsconfig ./tsconfig.json scripts/ask-document-test.ts
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { and, eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { seedBen } from "@/db/seed";
import { contextText, assembleContext } from "@/db/ask";
import { allTurns } from "@/db/conversation";
import { deleteDocument } from "@/db/data-kinds";
import { attachDocument, documentCard } from "@/db/document-card";
import { loadMoneyState } from "@/db/household";
import { moveToDevice } from "@/db/place";
import { readDocument } from "@/db/reader-job";
import { proposeReadings, reviewReading } from "@/db/readings";
import { addMember } from "@/db/people";
import { tools } from "@/lib/agent/tools";
import { InputError } from "@/db/input-error";
import { readingForm } from "@/lib/reader/form";
import { readerInbox } from "@/db/reader-inbox";
import { loadCanvasContext } from "@/lib/canvas/request";
import { resolveRecipe, type FlowData, type TimelineData } from "@/lib/canvas/resolve";
import { RecipeSchema } from "@/lib/canvas/schema";
import { blockWords } from "@/lib/canvas/words";
import { dayLabel, money } from "@/lib/money/format";
import { categoryLabel } from "@/lib/money/categories";
import { monthByCategory } from "@/lib/money/month";
import { AMOUNT_NOT_KNOWN } from "@/lib/money/gaps";
import { daysBetween, low, series } from "@/lib/money/runway";
import { homeSentence } from "@/lib/money/sentence";
import { readUpload } from "@/lib/reader/accept";
import { buildCard, cardContext, DOCUMENT_WORDS, documentCanvas, needsForm, readLine, savedCard, whoseWords, type CardReading } from "@/lib/reader/document-card";
import { extractSchema, type Extracted } from "@/lib/reader/extract";
import { ReaderError } from "@/lib/reader/settings";
import { TURN_VERSION, type ConversationTurn } from "@/lib/schema/turn";

const bill = (over: Partial<Extracted> = {}): Extracted => extractSchema.parse({
  kind: "bill", name: "Kawa Gym", date: "2026-11-27", amountMinor: 6000, currency: "JPY", category: "other", cardId: null, ...over,
});
const bytesOf = (text: string) => new TextEncoder().encode(text).buffer as ArrayBuffer;
const form = { madeBy: "form" } as const;

async function main() {
  process.env.SUPABASE_URL = "https://storage.example";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "fictional-test-value";
  process.env.SUPABASE_DOCUMENT_BUCKET = "fictional-documents";
  process.env.AI_PROTOCOL = "anthropic";
  process.env.AI_API_KEY = "fictional-test-value";
  process.env.AI_DOCUMENT_MODEL = "fixture-document";
  process.env.AI_TEXT_MODEL = "fixture-text";
  const pg = new PGlite({ extensions: { pg_trgm } });
  const originalFetch = globalThis.fetch;
  let passed = 0;
  const ok = (name: string) => { passed++; console.log(`✓ ${name}`); };
  try {
    const db = drizzle(pg, { schema });
    await migrate(db, { migrationsFolder: "./drizzle" });
    const a = await seedBen(db, { isDemo: true });
    const TODAY = "2026-11-14";

    // ---------------------------------------------------------------- the fake Storage and model
    const objects = new Map<string, Blob>();
    let items: unknown[] = [];
    let modelStatus = 200;
    let modelCalls = 0;
    globalThis.fetch = async (input, init) => {
      const request = new Request(input, init);
      const url = new URL(request.url);
      if (url.host === "api.anthropic.com") {
        modelCalls++;
        if (modelStatus !== 200) return Response.json({ error: { type: "authentication_error", message: "invalid x-api-key" } }, { status: modelStatus });
        const body = await request.json();
        return Response.json({ id: "msg_fixture", type: "message", role: "assistant", model: body.model, stop_reason: "tool_use", stop_sequence: null,
          content: [{ type: "tool_use", id: "toolu_fixture", name: "record_items", input: { items } }], usage: { input_tokens: 1, output_tokens: 1 } });
      }
      assert.equal(url.host, "storage.example");
      if (url.pathname.includes("/bucket/")) return Response.json({ name: "fictional-documents", public: false });
      const key = url.pathname.split("fictional-documents/")[1];
      if (request.method === "POST") { objects.set(key, await request.blob()); return Response.json({ Key: key }); }
      if (request.method === "GET") return objects.has(key) ? new Response(objects.get(key)) : Response.json({}, { status: 404 });
      if (request.method === "DELETE") { for (const path of (await request.json()).prefixes) objects.delete(path); return Response.json([]); }
      throw new Error("Unexpected storage operation");
    };
    const freshMinute = async (hid: string) => { await db.delete(schema.requestBuckets).where(eq(schema.requestBuckets.householdId, hid)); };
    const attach = (hid: string, pdf: string, extra: { text?: string | null; id?: string; conversationId?: string } = {}) =>
      attachDocument(db, hid, { id: extra.id ?? crypto.randomUUID(), conversationId: extra.conversationId ?? crypto.randomUUID(), text: extra.text ?? null, mime: "application/pdf", bytes: bytesOf(`%PDF-1.7 ${pdf}`) });
    const read = async (hid: string, documentId: string) => { await freshMinute(hid); await readDocument(db, hid, documentId); return documentCard(db, hid, documentId); };

    // ================================================================ pure
    const CARD_B = "6f1c2b7e-3d4a-4f58-9b0e-1a2b3c4d5e6f";
    const cards = [{ id: CARD_B, label: "Card B" }];
    assert.equal(readLine(bill(), cards), "Kawa Gym · ¥6,000 · due Nov 27");
    assert.equal(readLine(bill({ repeat: "month" }), cards), "Kawa Gym · ¥6,000 · due Nov 27 · every month");
    assert.equal(readLine(bill({ repeat: "year" }), cards), "Kawa Gym · ¥6,000 · due Nov 27 · every year");
    assert.equal(readLine(bill({ kind: "charge", name: "Noodle shop", amountMinor: 3800, date: "2026-11-12", cardId: CARD_B }), cards), "Noodle shop · ¥3,800 · Nov 12 · Card B");
    assert.equal(readLine(bill({ name: null, amountMinor: null, currency: null }), cards), `Bill · ${AMOUNT_NOT_KNOWN} · due Nov 27`);
    assert.equal(readLine(bill({ date: null }), cards), "Kawa Gym · ¥6,000 · date not known");
    assert.ok(!readLine(bill({ amountMinor: null, currency: null, date: null }), cards).includes("¥0"), "an unknown amount is never ¥0");
    assert.ok(!readLine(bill({ kind: "charge", name: null, date: "2026-11-12" }), cards).includes("Card B"), "a charge with no known card shows no card");
    assert.ok(readLine(bill({ kind: "charge", name: null, date: "2026-11-12" }), cards).startsWith("Card charge · "));
    ok("readLine: the four shapes, an unknown amount and an unknown date, never ¥0");

    const daysOf = (today: string, due: string | null, billId: string | null = "x") => {
      const recipe = documentCanvas(today, { name: "Kawa Gym", billId, due });
      assert.equal(RecipeSchema.safeParse(recipe).success, true, "the recipe passes RecipeSchema");
      const [, flow, events] = recipe.blocks;
      assert.ok(flow.type === "flow_chart" && events.type === "timeline");
      assert.equal(flow.query.days, events.query.days);
      return flow.query.days;
    };
    assert.equal(daysOf("2026-11-06", "2026-11-27"), 25);
    assert.equal(daysOf("2026-11-06", null), 25);
    assert.equal(daysOf("2026-11-28", "2026-11-29"), 7, "clamped up to a week");
    assert.equal(daysOf("2026-11-06", "2026-12-20"), 45);
    assert.equal(daysOf("2026-11-06", "2027-03-01"), 60, "clamped down to 60 days");
    const noMark = documentCanvas("2026-11-06", { name: "x".repeat(100), billId: null, due: "2026-11-27" });
    assert.equal(noMark.title, `${"x".repeat(64)} in your month`);
    assert.ok(noMark.blocks.every(block => !("mark" in block)), "no mark key without a bill id");
    const marked = documentCanvas("2026-11-06", { name: "Kawa Gym", billId: "bill-1", due: "2026-11-27" });
    assert.ok(marked.blocks.filter(block => "mark" in block).length === 2 && marked.title === "Kawa Gym in your month");
    ok("documentCanvas: days (25, 7, 45, 60), the recipe schema, no mark key without a bill");

    // ================================================================ the mark on the resolver (a hand-worked household)
    const ctx = await loadCanvasContext(db, a, { blocks: [] });
    assert.equal(ctx.state.today, TODAY);
    const withKawa = {
      ...ctx, state: { ...ctx.state, bills: [
        ...ctx.state.bills,
        { id: "kawa@2026-11-27", biller: "Kawa Gym", amount: 6000, due: "2026-11-27", category: "other" as const, businessBp: 0, status: "confirmed" as const, repeatUnit: "month" as const, repeatDay: 27, startsOn: "2026-11-27", startAmount: 6000 },
        { id: "kawa@2026-12-27", biller: "Kawa Gym", amount: 6000, due: "2026-12-27", category: "other" as const, businessBp: 0, status: "confirmed" as const, repeatUnit: "month" as const, repeatDay: 27, startsOn: "2026-11-27", startAmount: 6000 },
      ],
      // a window past the plan's is expanded from the stored series (27D), so the series is stored too
      storedBills: [...ctx.state.storedBills, { id: "kawa", biller: "Kawa Gym", amount: 6000, due: "2026-11-27", category: "other" as const, businessBp: 0, status: "confirmed" as const, repeatUnit: "month" as const, repeatDay: 27 }] },
    };
    const recipeWith = (markId: string | undefined, days = 60) => ({
      version: 1 as const, title: "Probe", blocks: [
        { type: "flow_chart" as const, query: { q: "flow" as const, days }, ...(markId && { mark: markId }) },
        { type: "timeline" as const, query: { q: "events" as const, days }, ...(markId && { mark: markId }) },
      ],
    });
    const parts = (recipe: ReturnType<typeof recipeWith>, c = withKawa) => {
      const [flow, timeline] = resolveRecipe(recipe, c);
      assert.ok(flow.type === "flow_chart" && timeline.type === "timeline");
      return { flow: flow.data as FlowData, timeline: timeline.data as TimelineData, blocks: [flow, timeline] };
    };
    const hit = parts(recipeWith("kawa"));
    assert.deepEqual(hit.flow.mark, { index: daysBetween(TODAY, "2026-11-27"), label: "Kawa Gym ¥6,000 · Nov 27" });
    assert.ok(hit.flow.mark!.index < hit.flow.points.length);
    assert.ok(hit.flow.aria.endsWith(" Marked: Kawa Gym ¥6,000 · Nov 27."));
    const markedRows = hit.timeline.rows.filter(row => row.marked);
    assert.deepEqual(markedRows.map(row => row.id), ["kawa@2026-11-27", "kawa@2026-12-27"], "both occurrences inside the window");
    assert.ok(hit.timeline.rows.filter(row => !row.marked).every(row => !row.id.startsWith("kawa")));
    assert.equal(parts(recipeWith("kawa", 30)).timeline.rows.filter(row => row.marked).length, 1, "only the occurrence inside 30 days");
    const viaOccurrence = parts(recipeWith("kawa@2026-12-27"));
    assert.equal(viaOccurrence.flow.mark?.index, daysBetween(TODAY, "2026-11-27"), "an occurrence id names the whole bill");
    const unknown = parts(recipeWith("no-such-bill"));
    assert.equal(unknown.flow.mark, null);
    assert.ok(unknown.timeline.rows.every(row => !row.marked));
    const plain = parts(recipeWith(undefined));
    assert.equal(plain.flow.mark, null);
    assert.ok(plain.timeline.rows.every(row => !row.marked));
    const { mark: _mark, ...flowRest } = hit.flow; void _mark;
    const { mark: _none, ...plainRest } = plain.flow; void _none;
    assert.deepEqual({ ...flowRest, aria: "" }, { ...plainRest, aria: "" }, "a mark changes nothing but the mark and the aria line");
    assert.deepEqual(hit.timeline.rows.map(({ marked, ...row }) => (void marked, row)), plain.timeline.rows.map(({ marked, ...row }) => (void marked, row)));
    const outside = parts({ ...recipeWith("kawa", 7) });
    assert.equal(outside.flow.mark, null, "a bill outside the window draws no mark and raises no error");
    assert.ok(blockWords(hit.blocks.length ? recipeWith("kawa").blocks[0] : recipeWith("kawa").blocks[0]).endsWith(", one bill marked"));
    assert.ok(blockWords(recipeWith("kawa").blocks[1]).endsWith(", one bill marked"));
    assert.ok(!blockWords(recipeWith(undefined).blocks[0]).includes("marked") && !blockWords(recipeWith(undefined).blocks[1]).includes("marked"));
    ok("the mark: index and label on the chart, marked timeline rows, unknown id, no mark, words");

    // ================================================================ buildCard (pure)
    const reading = (over: Partial<CardReading> = {}): CardReading => ({ id: crypto.randomUUID(), status: "to_check", value: bill(), link: null, targetId: null, confirmedAt: null, ...over });
    const input = (status: "queued" | "reading" | "read" | "failed", readings: CardReading[] = [], error: string | null = null) => ({ documentId: crypto.randomUUID(), doc: { status, error }, readings });
    assert.equal(buildCard({ documentId: "d", doc: null, readings: [] }, null).words, DOCUMENT_WORDS.deleted);
    assert.equal(buildCard({ documentId: "d", doc: null, readings: [] }, null).status, "gone");
    for (const status of ["queued", "reading"] as const) { const card = buildCard(input(status), null); assert.deepEqual([card.status, card.words, card.items.length], ["reading", "Reading your bill…", 0]); }
    const failed = buildCard(input("failed", [], "Document could not be read from Storage. Upload the original again."), null);
    assert.deepEqual([failed.status, failed.words, failed.error], ["failed", "This file could not be read: Document could not be read from Storage. Upload the original again.", "Document could not be read from Storage. Upload the original again."]);
    assert.equal(buildCard(input("failed"), null).words, "This file could not be read: Try again.");
    const empty = buildCard(input("read"), ctx);
    assert.deepEqual([empty.status, empty.words, empty.items.length, empty.canvas], ["read", "Nothing to add was found in this file.", 0, null]);
    const waitingCard = buildCard(input("read", [reading()]), null);
    assert.deepEqual([waitingCard.words, waitingCard.canvas, waitingCard.items[0].checks, waitingCard.items[0].target], ["Read from your bill:", null, [], null]);
    const withChecks = buildCard(input("read", [reading(), reading({ status: "rejected" }), reading({ status: "confirmed", targetId: crypto.randomUUID(), confirmedAt: "2026-11-14T01:00:00.000Z" })]), ctx);
    assert.deepEqual(withChecks.items.map(item => item.status), ["to_check", "rejected", "confirmed"]);
    assert.deepEqual(withChecks.items.map(item => item.checks.length > 0), [true, false, false], "checks only on a to_check item");
    assert.equal(withChecks.items[0].checks[0].kind, "repeat_unknown");
    assert.equal(withChecks.items[2].target?.kind, "bill");
    assert.equal(withChecks.items[1].target, null);
    assert.equal(withChecks.words, DOCUMENT_WORDS.confirmed);
    assert.ok(withChecks.canvas, "a confirmed item draws the canvas when the money state is given");
    const text = cardContext(withChecks);
    assert.ok(text.startsWith(DOCUMENT_WORDS.confirmed) && text.includes("Kawa Gym · ¥6,000 · due Nov 27 (waiting for the user's OK)") && text.includes("(not added)") && text.includes("(added)"));
    // savedCard (pure): the summary parts and the links, a part left out when unknown, never ¥0
    const hikari = bill({ name: "Hikari Denki", amountMinor: 11220, category: "utilities" });
    const target = { kind: "bill" as const, id: crypto.randomUUID() };
    // the stored one-off bill, as the household's spending holds it once confirmed
    const hikariRow = { id: target.id, biller: "Hikari Denki", amount: 11220, due: "2026-11-27", category: "utilities" as const, businessBp: 0, status: "confirmed" as const };
    const withStored = { ...ctx, spending: { ...ctx.spending, bills: [...ctx.spending.bills, hikariRow] } };
    const novUtilities = monthByCategory(withStored.spending, TODAY, "2026-11").categories.find(c => c.category === "utilities")!.totalMinor;
    const oneOff = savedCard({ value: hikari, target, seriesId: null }, withStored);
    assert.equal(oneOff.words, `Saved: Hikari Denki ¥11,220 · Utilities · due Nov 27 · Utilities in November: ${money(novUtilities, "JPY")} with this bill.`, "a one-off bill due later this month counts in the month");
    assert.ok(novUtilities >= 11220);
    assert.deepEqual(oneOff.links.map(link => link.href), [`/bills#bill-${target.id}`, "/spending#category-utilities", `/#bill-${target.id}`]);
    assert.equal(savedCard({ value: hikari, target, seriesId: "series-1" }, ctx).links[0].href, "/bills#series-series-1", "a bill that joined a series links to the series");
    const noAmount = savedCard({ value: bill({ name: "Hikari Denki", amountMinor: null, currency: null, date: null, category: "utilities" }), target, seriesId: null }, ctx);
    assert.equal(noAmount.words, "Saved: Hikari Denki · Utilities.");
    assert.ok(!noAmount.words.includes("¥0") && noAmount.links.length === 1, "no amount, no date: no ¥0, no month or Home link");
    assert.ok(!savedCard({ value: bill({ date: "2027-01-27", category: "utilities" }), target, seriesId: null }, ctx).links.some(link => link.href.startsWith("/spending")), "Spending cannot show a future month");
    assert.ok(!savedCard({ value: bill({ date: "2026-12-20", category: "utilities" }), target, seriesId: null }, ctx).links.some(link => link.href.startsWith("/#")), "beyond Home's 30 days: no Home link");
    assert.equal(savedCard({ value: bill({ date: "2026-10-05", category: "utilities" }), target, seriesId: null }, ctx).links[1].href, "/spending?month=2026-10#category-utilities", "a past month names the month");
    ok("buildCard and cardContext: each row of the words table, item statuses, checks only on to_check");

    // ================================================================ the database
    const sentenceBefore = homeSentence(await loadMoneyState(db, a, TODAY)).text;
    const billsBefore = (await db.select().from(schema.bills).where(eq(schema.bills.householdId, a))).length;

    // 1. attach
    const conversationId = crypto.randomUUID();
    items = [bill()];
    const first = await attach(a, "kawa gym december", { conversationId });
    assert.deepEqual([first.turn.kind, first.turn.question, first.turn.reply, first.turn.documentId, first.turn.version], ["document", "Here's my bill", DOCUMENT_WORDS.sent, first.documentId, TURN_VERSION]);
    assert.deepEqual([first.turn.choices, first.turn.recipe, first.turn.sources, first.turn.thumb], [null, null, [], null]);
    const [docRow] = await db.select().from(schema.documents).where(eq(schema.documents.id, first.documentId));
    assert.deepEqual([docRow.status, docRow.kind, docRow.householdId], ["queued", "upload", a]);
    assert.deepEqual([first.card.status, first.card.words, first.card.items.length], ["reading", "Reading your bill…", 0]);
    const stored = (await allTurns(db, a)).filter(t => t.id === first.turn.id);
    assert.deepEqual(stored, [first.turn], "the turn is stored exactly as returned");
    const texted = await attach(a, "typed words", { text: "Gym bill for December" });
    assert.equal(texted.turn.question, "Gym bill for December");
    assert.equal(ConversationTurnParses(texted.turn), true);
    ok("attachDocument: a document turn, a queued document, a reading card, typed words become the question");

    // 2. read
    const card = await read(a, first.documentId);
    assert.equal(card.status, "read");
    assert.equal(card.items.length, 1);
    assert.equal(card.items[0].read, "Kawa Gym · ¥6,000 · due Nov 27");
    assert.deepEqual(card.items[0].checks.map(check => check.kind), ["repeat_unknown"]);
    assert.equal(card.items[0].checks[0].words, "Does Kawa Gym come again?");
    assert.equal(card.words, "Read from your bill:");
    assert.equal(card.canvas, null);
    assert.equal(homeSentence(await loadMoneyState(db, a, TODAY)).text, sentenceBefore, "a reading never enters the numbers");
    assert.equal((await db.select().from(schema.bills).where(eq(schema.bills.householdId, a))).length, billsBefore);
    ok("after the read: one item, its read line and its repeat question; Ben's sentence is unchanged");

    // 3. the answer rule
    const readingId = card.items[0].readingId;
    const asProposed = card.items[0].value;
    await assert.rejects(reviewReading(db, a, readingId, asProposed, {}, false, []), (e: unknown) => e instanceof ReaderError && e.message === "Answer the question first: Does Kawa Gym come again?");
    assert.equal((await db.select().from(schema.bills).where(eq(schema.bills.householdId, a))).length, billsBefore, "nothing was saved");
    assert.equal((await documentCard(db, a, first.documentId)).items[0].status, "to_check");
    assert.equal(await reviewReading(db, a, readingId, { ...asProposed, repeat: "month" }, {}, false, ["repeat_unknown"]), true);
    const done = await documentCard(db, a, first.documentId);
    assert.equal(done.items[0].status, "confirmed");
    const [saved] = await db.select().from(schema.bills).where(and(eq(schema.bills.householdId, a), eq(schema.bills.biller, "Kawa Gym")));
    assert.deepEqual([saved.repeatUnit, saved.amountMinor, saved.due, saved.status], ["month", 6000, "2026-11-27", "confirmed"]);
    assert.deepEqual(done.items[0].target, { kind: "bill", id: saved.id });
    const [readingRow] = await db.select().from(schema.readings).where(eq(schema.readings.id, readingId));
    assert.equal((readingRow.extracted as { targetId: string }).targetId, saved.id);
    ok("Confirm without the answer is refused and saves nothing; with it, a monthly bill is saved and the card names it");

    // 5b. where it now lives: the line and the links, the month total the one Spending draws
    const spendNow = (await loadCanvasContext(db, a, { blocks: [] })).spending;
    const novOther = monthByCategory(spendNow, TODAY, "2026-11").categories.find(c => c.category === "other")!.totalMinor;
    assert.equal(done.items[0].saved?.words, `Saved: Kawa Gym ¥6,000 · Other · due Nov 27 · Other in November: ${money(novOther, "JPY")} with this bill.`);
    assert.deepEqual(done.items[0].saved?.links.map(link => link.href), [`/bills#series-${saved.id}`, "/spending#category-other", `/#series-${saved.id}`], "a repeating bill links to its series");
    ok("a confirmed repeating bill: the saved line, the month total equal to Spending's, series links");

    // 6. the canvas after Confirm
    assert.equal(done.words, DOCUMENT_WORDS.confirmed);
    assert.ok(done.canvas);
    const [sentenceBlock, flowBlock, timelineBlock] = done.canvas.blocks;
    assert.ok(sentenceBlock.type === "sentence" && flowBlock.type === "flow_chart" && timelineBlock.type === "timeline");
    const flowQuery = done.canvas.recipe.blocks[1];
    assert.ok(flowQuery.type === "flow_chart");
    assert.equal(flowQuery.query.days, daysBetween(TODAY, "2026-11-30") + 1);
    assert.equal(flowQuery.mark, saved.id);
    const nowState = await loadMoneyState(db, a, TODAY);
    const point = low(series(nowState, "worst", flowQuery.query.days));
    assert.equal(flowBlock.data.lowLabel, `${money(point.amount, "JPY")} · ${dayLabel(point.date)}`);
    assert.deepEqual(flowBlock.data.mark, { index: daysBetween(TODAY, "2026-11-27"), label: "Kawa Gym ¥6,000 · Nov 27" });
    assert.equal(timelineBlock.data.rows.filter(row => row.marked).length, 1);
    assert.equal(sentenceBlock.data.text, homeSentence(nowState).text);
    ok("after Confirm: the canvas holds the chart's own lowest point, the marked bill and the confirmed words");

    // 4. To check needs no answer
    items = [bill({ name: "Sakura Water", date: "2026-12-20" })];
    const sakura = await read(a, (await attach(a, "sakura water")).documentId);
    assert.deepEqual(sakura.items[0].checks.map(check => check.kind), ["repeat_unknown"]);
    assert.equal(await reviewReading(db, a, sakura.items[0].readingId, sakura.items[0].value), true, "answered undefined: no rule");
    ok("a Confirm from To check (no answers sent) needs no answer");

    // 5. a check moot after Edit, a check raised by the edit alone
    items = [bill({ name: "Maple Tea", date: "2026-12-21" })];
    const maple = await read(a, (await attach(a, "maple tea")).documentId);
    assert.equal(await reviewReading(db, a, maple.items[0].readingId, { ...maple.items[0].value, repeat: null }, {}, false, ["repeat_unknown"]), true, "Just this once: a one-off");
    const [mapleRow] = await db.select().from(schema.bills).where(and(eq(schema.bills.householdId, a), eq(schema.bills.biller, "Maple Tea")));
    assert.equal(mapleRow.repeatUnit, null);
    items = [bill({ name: "Pine Rent", date: "2026-12-22" })];
    const pine = await read(a, (await attach(a, "pine rent")).documentId);
    assert.equal(await reviewReading(db, a, pine.items[0].readingId, { ...pine.items[0].value, repeat: "year" }, {}, false, []), true, "Edit set Every year: the question is moot");
    items = [bill({ name: "Hana Clinic", date: "2026-12-23" })];
    const hana = await read(a, (await attach(a, "hana clinic")).documentId);
    assert.equal(await reviewReading(db, a, hana.items[0].readingId, { ...hana.items[0].value, date: "2026-11-01" }, {}, false, ["repeat_unknown"]), true, "past due raised only by the person's own edit does not block");
    items = [bill({ name: "Kawa Gym", date: "2027-01-15" })];
    const triple = await read(a, (await attach(a, "kawa gym january")).documentId);
    assert.deepEqual(triple.items[0].checks, [], "a monthly Kawa Gym is known: nothing asked");
    assert.equal(await reviewReading(db, a, triple.items[0].readingId, { ...triple.items[0].value, amountMinor: 18_000 }, {}, false, []), true, "far from usual raised only by the edit does not block");
    ok("a check made moot by Edit, or raised only by the person's own edit, does not block a Confirm from Ask");

    // 7. two charges
    const cardId = nowState.cards[0].id;
    items = [
      { kind: "charge", name: "Noodle shop", amountMinor: 3800, currency: "JPY", category: "food", date: "2026-11-12", cardId },
      { kind: "charge", name: "Bookshop", amountMinor: null, currency: null, category: "other", date: "2026-11-13", cardId },
    ];
    const twoRead = await read(a, (await attach(a, "card email with two charges")).documentId);
    // Look them up by name.
    const named = (c: typeof twoRead, name: string) => c.items.find(item => item.value.name === name)!;
    assert.equal(twoRead.items.length, 2);
    assert.deepEqual(twoRead.items.map(item => item.checks.map(check => check.kind)).sort(), [[], ["missing"]], "each item has its own checks");
    assert.deepEqual(named(twoRead, "Bookshop").checks.map(check => check.kind), ["missing"]);
    assert.equal(named(twoRead, "Noodle shop").read, `Noodle shop · ¥3,800 · Nov 12 · ${nowState.cards[0].label}`);
    const two = twoRead;
    assert.equal(await reviewReading(db, a, named(two, "Noodle shop").readingId, named(two, "Noodle shop").value, {}, false, []), true);
    const afterOne = await documentCard(db, a, two.documentId);
    assert.deepEqual(afterOne.items.map(item => item.status).sort(), ["confirmed", "to_check"]);
    assert.equal(named(afterOne, "Noodle shop").target?.kind, "charge");
    assert.equal(named(afterOne, "Bookshop").status, "to_check");
    assert.ok(afterOne.canvas && afterOne.canvas.blocks[1].type === "flow_chart" && afterOne.canvas.blocks[1].data.mark === null, "a charge sits in its card's row: no mark");
    assert.ok(afterOne.canvas.recipe.blocks.every(block => !("mark" in block)));
    const noodle = named(afterOne, "Noodle shop");
    const novFood = monthByCategory((await loadCanvasContext(db, a, { blocks: [] })).spending, TODAY, "2026-11").categories.find(c => c.category === noodle.value.category)!.totalMinor;
    assert.ok(noodle.saved!.words.startsWith(`Saved: Noodle shop ¥3,800 · ${categoryLabel(noodle.value.category!)} · ${nowState.cards[0].label}, Nov 12 · `));
    assert.ok(noodle.saved!.words.endsWith(`in November: ${money(novFood, "JPY")} with this charge.`));
    assert.deepEqual(noodle.saved!.links.map(link => link.href), [`/cards/${noodle.value.cardId}#charge-${noodle.target!.id}`, `/spending#category-${noodle.value.category}`], "a charge has no Home link");
    assert.equal(named(afterOne, "Bookshop").saved, null, "nothing is saved for an item still waiting");
    ok("a document with two charges: two items with their own checks; Confirming one leaves the other; the canvas has no mark");

    // readings from one file keep the model's order: distinct created_at, ids chosen so id order is the reverse of read order
    const orderDoc = await attach(a, "three bills in one file");
    await db.update(schema.documents).set({ status: "read" }).where(eq(schema.documents.id, orderDoc.documentId));
    const order = ["Alder Bills", "Birch Bills", "Cedar Bills"];
    await proposeReadings(db, a, orderDoc.documentId, order.map((name, index) => bill({ name, date: `2026-12-0${index + 1}` })));
    const reverseIds = ["ffffffff-0000-4000-8000-000000000001", "88888888-0000-4000-8000-000000000002", "00000000-0000-4000-8000-000000000003"];
    for (const [index, name] of order.entries()) {
      const rows = await db.select().from(schema.readings).where(eq(schema.readings.documentId, orderDoc.documentId));
      const row = rows.find(r => (r.extracted as { original: { name: string } }).original.name === name)!;
      await db.update(schema.readings).set({ id: reverseIds[index] }).where(eq(schema.readings.id, row.id));
    }
    assert.deepEqual((await documentCard(db, a, orderDoc.documentId)).items.map(item => item.value.name), order, "the Ask card lists them in the order read");
    assert.deepEqual((await readerInbox(db, a)).readings.filter(r => r.documentId === orderDoc.documentId).map(r => r.value.name), order, "To check lists them in the order read");
    ok("three readings from one file: the Ask card and To check keep the model's order though the ids sort the other way");

    // a repeating bill whose first date is past the plan window: the chart looks as far as its days (27D), so the mark is found
    items = [bill({ name: "Far Pool", date: "2026-12-27", repeat: "month" })];
    const far = await read(a, (await attach(a, "far pool")).documentId);
    assert.equal(await reviewReading(db, a, far.items[0].readingId, far.items[0].value, {}, false, []), true);
    const farDone = await documentCard(db, a, far.documentId);
    assert.ok(farDone.canvas && farDone.canvas.blocks[1].type === "flow_chart" && farDone.canvas.blocks[1].data.mark !== null && farDone.canvas.blocks[1].data.mark.index === 43 && /Far Pool/.test(farDone.canvas.blocks[1].data.mark.label));
    assert.equal(farDone.canvas.recipe.blocks[1].type === "flow_chart" && farDone.canvas.recipe.blocks[1].query.days, 44);

    // 8. the same file twice
    items = [bill({ name: "Tama Bus Pass", date: "2026-12-02" })];
    const twiceConversation = crypto.randomUUID();
    const one = await attach(a, "bus pass", { conversationId: twiceConversation });
    await read(a, one.documentId);
    const callsBefore = modelCalls;
    const two2 = await attach(a, "bus pass", { conversationId: twiceConversation });
    assert.equal(two2.documentId, one.documentId);
    assert.equal(two2.card.status, "read", "the second card already shows what happened");
    await freshMinute(a);
    await readDocument(db, a, two2.documentId);
    assert.equal(modelCalls, callsBefore, "one read");
    assert.equal((await db.select().from(schema.documents).where(and(eq(schema.documents.householdId, a), eq(schema.documents.id, one.documentId)))).length, 1);
    assert.equal((await allTurns(db, a)).filter(t => t.documentId === one.documentId).length, 2, "two turns");
    ok("the same file attached twice: one document, one read, two turns");

    // 9. a deleted file
    assert.equal(await deleteDocument(db, a, two.documentId, form, { remove: async () => ({ error: null }) } as never), true);
    const removed = await documentCard(db, a, two.documentId);
    assert.deepEqual([removed.status, removed.words], ["gone", "This file was deleted."]);
    ok("a removed document is gone with nothing of the file in the words");

    // 11. a failed read
    items = [bill({ name: "Never Read", date: "2026-12-04" })];
    modelStatus = 401;
    const bad = await attach(a, "model refuses");
    const failedCard = await read(a, bad.documentId);
    assert.equal(failedCard.status, "failed");
    assert.ok(failedCard.error && failedCard.words === `This file could not be read: ${failedCard.error}`);
    modelStatus = 200;
    const savedModel = process.env.AI_DOCUMENT_MODEL;
    delete process.env.AI_DOCUMENT_MODEL;
    const noModel = await attach(a, "no model set");
    const noModelCard = await read(a, noModel.documentId);
    process.env.AI_DOCUMENT_MODEL = savedModel;
    assert.equal(noModelCard.words, "This file could not be read: The AI model isn’t set up on this server yet.");
    assert.equal(noModelCard.items.length, 0);
    ok("a read that fails: the card says so in the reader's own words");

    // 13. the conversation context
    const contextTurns = (await allTurns(db, a)).filter(t => t.conversationId === conversationId);
    assert.equal(contextTurns.length, 1);
    const cardNow = await documentCard(db, a, first.documentId, { draw: false });
    assert.deepEqual(cardNow.items[0].checks, [], "draw: false loads no money state");
    assert.equal(cardNow.canvas, null);
    const quoted = contextText(contextTurns, null, new Map([[first.documentId, cardNow]]));
    assert.ok(quoted.includes(JSON.stringify(cardContext(cardNow))));
    assert.ok(quoted.includes(DOCUMENT_WORDS.sent), "the turn is preserved alongside its separate card");
    assert.ok(quoted.includes("read every number again from the tools"));
    assert.ok(contextText(contextTurns, null).includes(DOCUMENT_WORDS.sent), "without a card the stored reply stands");
    const { context: viaDb } = await assembleContext(db, a, { conversationId, canvas: null });
    assert.ok(viaDb.includes("Kawa Gym · ¥6,000 · due Nov 27 · every month (added)"), "the stored turn reaches the context as its card");
    ok("assembleContext keeps the attached document card with its turn");

    // 10. the journal on the device
    await moveToDevice(db, a, "journal", (await allTurns(db, a)).map(t => t.id), form);
    const turnsBefore = (await db.select().from(schema.conversationTurns).where(eq(schema.conversationTurns.householdId, a))).length;
    const onDevice = await attach(a, "journal on the device");
    assert.equal(onDevice.turn.kind, "document");
    assert.equal(onDevice.card.status, "reading");
    assert.equal((await db.select().from(schema.conversationTurns).where(eq(schema.conversationTurns.householdId, a))).length, turnsBefore);
    assert.equal(turnsBefore, 0);
    ok("with the journal on the device, the turn is returned and no conversation row is written");

    // 12. readUpload
    const post = (body: BodyInit, headers: Record<string, string> = {}) => new Request("http://app.test/api/ask/document", { method: "POST", body, headers });
    const multipart = (file: File | string, extra: Record<string, string> = {}) => { const fd = new FormData(); fd.set("document", file); for (const [k, v] of Object.entries(extra)) fd.set(k, v); return fd; };
    await assert.rejects(readUpload(post(JSON.stringify({}), { "content-type": "application/json" })), (e: unknown) => e instanceof ReaderError && e.message === "Select a file to upload.");
    await assert.rejects(readUpload(post(multipart(new File(["hello"], "a.txt", { type: "text/plain" })))), (e: unknown) => e instanceof ReaderError && e.message === "Select a PDF, JPEG, PNG or WebP file.");
    await assert.rejects(readUpload(post(multipart("not a file"))), (e: unknown) => e instanceof ReaderError && e.message === "Select a PDF, JPEG, PNG or WebP file.");
    await assert.rejects(readUpload(post(multipart(new File(["hello"], "a.pdf", { type: "application/pdf" })))), (e: unknown) => e instanceof ReaderError && e.message === "File contents do not match the selected file type.");
    await assert.rejects(readUpload(post(multipart(new File(["%PDF-1.7 " + "x".repeat(6 * 1024 * 1024 + 9000)], "big.pdf", { type: "application/pdf" })))), (e: unknown) => e instanceof ReaderError && e.message === "Document exceeds the 6 MiB limit.");
    const accepted = await readUpload(post(multipart(new File(["%PDF-1.7 fine"], "a.pdf", { type: "application/pdf" }), { id: "abc", text: "hello" })));
    assert.deepEqual([accepted.mime, accepted.bytes.byteLength, accepted.form.get("id"), accepted.form.get("text")], ["application/pdf", 13, "abc", "hello"]);
    ok("readUpload: Upload's words for a non-multipart body, a wrong type, mismatched bytes and a body over the limit; a good file returns its form");

    // ================================================================ D61: whose (D45), after everything else: the household gets a second person here
    const tool = tools.find(t => t.name === "set_whose")!;
    assert.equal(tool.scope, "draft");
    const links: { label: string; href: string }[] = [];
    const toolCtx = (hid: string) => ({ madeBy: "ask", db, householdId: hid, state: () => loadMoneyState(db, hid, TODAY), appUrl: new URL("http://127.0.0.1:3123"), addLink: (link: { label: string; href: string }) => links.push(link) }) as never;
    const setWhose = (hid: string, input: { reading: string; shared: boolean; person?: string | null }) => tool.run(toolCtx(hid), tool.input.parse({ person: null, ...input }) as never);
    items = [bill({ name: "Hikari Denki", amountMinor: 11_220, date: "2026-11-27", category: "utilities", repeat: "month" }), { kind: "charge", name: "Ramen Kita", amountMinor: 1200, currency: "JPY", category: "food", date: "2026-11-13", cardId: (await loadMoneyState(db, a, TODAY)).cards[0].id }];
    const whoseCard = await read(a, (await attach(a, "whose")).documentId);
    const denki = whoseCard.items.find(item => item.value.name === "Hikari Denki")!, ramen = whoseCard.items.find(item => item.value.name === "Ramen Kita")!;
    await assert.rejects(setWhose(a, { reading: "Hikari Denki", shared: true, person: "Ben" }), (e: unknown) => e instanceof InputError && /second person/.test(e.message), "a household of one has no choice to make");
    assert.equal(whoseWords("bill", { shared: true, memberId: null, paidByMemberId: null }, [{ id: "x", name: "Ben" }]), null, "one member: no words");
    const aki = await addMember(db, a, { name: "Aki" });
    const ben = (await loadMoneyState(db, a, TODAY)).split.members[0].id;
    // the form's choice reaches readingForm
    const formOf = (fields: Record<string, string>, target: "bill" | "charge" = "bill") => { const fd = new FormData(); for (const [k, v] of Object.entries({ target, name: "Hikari Denki", amount: "11220", currency: "JPY", date: "2026-11-27", category: "utilities", businessShare: "personal", cardId: "", ...fields })) fd.set(k, v); return fd; };
    assert.equal(readingForm(formOf({})).whose, undefined, "no Whose field (one person): not set");
    assert.deepEqual(readingForm(formOf({ whose: "shared", paidByMemberId: aki })).whose, { shared: true, memberId: null, paidByMemberId: aki });
    assert.deepEqual(readingForm(formOf({ whose: aki })).whose, { shared: false, memberId: aki, paidByMemberId: null });
    assert.deepEqual(readingForm(formOf({ whose: "shared" }, "charge")).whose, { shared: true, memberId: null, paidByMemberId: null });
    assert.equal(readingForm(formOf({ whose: "own" }, "charge")).whose?.shared, false);
    // the tool: a fixed sentence, a link to the item, nothing confirmed
    assert.equal(await setWhose(a, { reading: "hikari denki", shared: false, person: "aki" }), "Marked Hikari Denki as Aki\u2019s. Confirm it on the card.");
    assert.deepEqual(links, [{ label: "Open in To check", href: `http://127.0.0.1:3123/to-check#reading-${denki.readingId}` }]);
    const reMarked = (await documentCard(db, a, whoseCard.documentId)).items.find(item => item.readingId === denki.readingId)!;
    assert.deepEqual([reMarked.status, reMarked.value.whose], ["to_check", { shared: false, memberId: aki, paidByMemberId: null }], "a draft edit: still waiting");
    assert.equal(await setWhose(a, { reading: "Hikari Denki", shared: true, person: "Aki" }), "Marked Hikari Denki as shared, Aki pays. Confirm it on the card.");
    await assert.rejects(setWhose(a, { reading: "Hikari Denki", shared: true, person: "Chie" }), (e: unknown) => e instanceof InputError && e.message === "Nobody called Chie is in this household");
    await assert.rejects(setWhose(a, { reading: "Hikari Denki", shared: false }), (e: unknown) => e instanceof InputError && /Say whose bill/.test(e.message));
    await assert.rejects(setWhose(a, { reading: "Ramen Kita", shared: true, person: "Aki" }), (e: unknown) => e instanceof InputError && /leave person empty/.test(e.message));
    await assert.rejects(setWhose(a, { reading: "No Such Bill", shared: true }), (e: unknown) => e instanceof InputError && /Nothing called No Such Bill is waiting/.test(e.message));
    // Confirm saves it as the form does, and the saved line says whose
    const waitingDenki = (await documentCard(db, a, whoseCard.documentId)).items.find(item => item.readingId === denki.readingId)!;
    assert.equal(await reviewReading(db, a, denki.readingId, waitingDenki.value, {}), true);
    const savedDenki = (await documentCard(db, a, whoseCard.documentId)).items.find(item => item.readingId === denki.readingId)!;
    const [denkiBill] = await db.select().from(schema.bills).where(eq(schema.bills.id, savedDenki.target!.id));
    assert.deepEqual([denkiBill.memberId, denkiBill.paidByMemberId], [null, aki]);
    assert.match(savedDenki.saved!.words, /^Saved: Hikari Denki ¥11,220 · Shared, Aki pays · Utilities · due Nov 27/);
    await assert.rejects(setWhose(a, { reading: "Hikari Denki", shared: false, person: "Ben" }), (e: unknown) => e instanceof InputError && /Nothing called Hikari Denki is waiting/.test(e.message), "a reading that is not waiting is refused");
    // a person's own bill, and a shared charge (paid by the card's owner, who must be someone)
    items = [bill({ name: "Aki Dojo", amountMinor: 5000, date: "2026-12-01" })];
    const dojo = await read(a, (await attach(a, "dojo")).documentId);
    assert.equal(await reviewReading(db, a, dojo.items[0].readingId, { ...dojo.items[0].value, whose: { shared: false, memberId: aki, paidByMemberId: null } }, {}), true);
    const [dojoBill] = await db.select().from(schema.bills).where(and(eq(schema.bills.householdId, a), eq(schema.bills.biller, "Aki Dojo")));
    assert.deepEqual([dojoBill.memberId, dojoBill.paidByMemberId], [aki, null]);
    assert.match((await documentCard(db, a, dojo.documentId)).items[0].saved!.words, /^Saved: Aki Dojo ¥5,000 · Aki\u2019s · /);
    const shareRamen = { ...ramen.value, whose: { shared: true, memberId: null, paidByMemberId: null } };
    await db.update(schema.cards).set({ memberId: null }).where(eq(schema.cards.id, ramen.value.cardId!));
    await assert.rejects(reviewReading(db, a, ramen.readingId, shareRamen, {}), (e: unknown) => e instanceof ReaderError && /belongs to a person/.test(e.message), "a shared charge needs a card with an owner");
    await db.update(schema.cards).set({ memberId: ben }).where(eq(schema.cards.id, ramen.value.cardId!));
    await setWhose(a, { reading: "Ramen Kita", shared: true });
    assert.equal(await reviewReading(db, a, ramen.readingId, shareRamen, {}), true);
    const [ramenCharge] = await db.select().from(schema.charges).where(and(eq(schema.charges.householdId, a), eq(schema.charges.merchant, "Ramen Kita")));
    assert.equal(ramenCharge.shared, true);
    assert.match((await documentCard(db, a, whoseCard.documentId)).items.find(item => item.readingId === ramen.readingId)!.saved!.words, /^Saved: Ramen Kita ¥1,200 · Shared, Ben pays · /);
    ok("whose: one person gets no choice; two get one; the form field and Ask's set_whose both fill it; Confirm saves the person or shared and who pays; the refusals");

    assert.equal(needsForm(bill()), false, "a complete reading goes to Confirm");
    assert.equal(needsForm(bill({ currency: null })), true, "an amount with no currency opens the full form, where the person picks one");
    assert.equal(needsForm(bill({ amountMinor: null, currency: null })), false, "no amount is the missing-amount question's job, not the form's");
    ok("needsForm: an amount read without a currency opens the full form");

    console.log(`Ask-document checks passed (${passed}).`);
  } finally {
    globalThis.fetch = originalFetch;
    await pg.close();
  }
}

function ConversationTurnParses(turn: ConversationTurn): boolean {
  return turn.documentId !== undefined && turn.documentId !== null && turn.question.length > 0;
}

main().catch(error => { console.error(error); process.exit(1); });
