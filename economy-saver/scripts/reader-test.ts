// PGlite + local HTTP boundary doubles. The reader never contacts Supabase or Anthropic in this script.
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { and, eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { seedBen } from "@/db/seed";
import { loadMoneyState } from "@/db/household";
import { readDocument, storeDocument } from "@/db/reader-job";
import { extractDocument } from "@/lib/reader/extract";
import { reviewReading } from "@/db/readings";
import { readerInbox } from "@/db/reader-inbox";
import { removeHouseholdDocuments } from "@/db/document-cleanup";
import { correctionText } from "@/lib/reader/correction";
import { listMemory } from "@/db/memory";
import { forwardingAddress, householdForRecipient } from "@/lib/reader/forwarding";

const conn = { protocol: "anthropic" as const, baseUrl: "https://api.anthropic.com", key: "fictional-test-value", textModel: "fixture-text", documentModel: "fixture-document", own: false };

async function test() {
  process.env.SUPABASE_URL = "https://storage.example";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "fictional-test-value";
  process.env.SUPABASE_DOCUMENT_BUCKET = "fictional-documents";
  process.env.AI_PROTOCOL = "anthropic";
  process.env.AI_API_KEY = "fictional-test-value";
  process.env.AI_DAILY_LIMIT = "8";
  process.env.AI_DOCUMENT_MODEL = "fixture-document";
  process.env.AI_TEXT_MODEL = "fixture-text";
  process.env.FORWARDING_DOMAIN = "inbox.example";
  process.env.INBOUND_ADDRESS_KEY = "ab".repeat(32);
  const pg = new PGlite();
  const originalFetch = globalThis.fetch;
  try {
    const db = drizzle(pg, { schema });
    await migrate(db, { migrationsFolder: "./drizzle" });
    const a = await seedBen(db, { isDemo: true }), b = await seedBen(db, { isDemo: true });
    const aState = await loadMoneyState(db, a, "2026-11-14");
    const card = aState.cards[0];
    const bills = aState.bills.length;
    const objects = new Map<string, Blob>();
    let isPublic = false;
    let calls = 0;
    let refusePdf = false;
    const openaiBodies: { model: string; tool_choice: unknown; tools: { function: { name: string } }[]; messages: { role: string; content: unknown }[] }[] = [];
    let empty = false;
    let stop = "tool_use";
    let expectedMime = "application/pdf";
    let extracted = { kind: "bill", name: "Harbor Lights", amountMinor: 11200, currency: "JPY", category: "other", date: "2026-11-27", cardId: null as string | null };
    globalThis.fetch = async (input, init) => {
      const request = new Request(input, init);
      const url = new URL(request.url);
      if (url.host === "api.anthropic.com") {
        assert.equal(url.pathname, "/v1/messages");
        assert.equal(request.headers.get("authorization"), "Bearer fictional-test-value");
        const body = await request.json();
        assert.equal(body.model, expectedMime === "message/rfc822" ? "fixture-text" : "fixture-document");
        assert.deepEqual(body.tool_choice, { type: "tool", name: "record_items" });
        assert.deepEqual(body.tools.map((t: { name: string }) => t.name), ["record_items"]);
        assert.equal(body.output_config, undefined, "a forced tool does not carry the effort setting");
        if (expectedMime === "message/rfc822") {
          const content = body.messages[0].content;
          assert.ok((typeof content === "string" ? content : content.map((v: { text?: string }) => v.text).join("\n")).includes("Minato kiosk"));
        }
        else assert.equal(body.messages[0].content[0].source.media_type, expectedMime);
        calls++;
        return Response.json({ id: "msg_fixture", type: "message", role: "assistant", model: body.model, stop_reason: stop, stop_sequence: null,
          content: [{ type: "tool_use", id: "toolu_fixture", name: "record_items", input: { items: empty ? [] : [extracted] } }], usage: { input_tokens: 1, output_tokens: 1 } });
      }
      if (url.host === "llm.example") {
        assert.equal(url.pathname, "/v1/chat/completions");
        assert.equal(request.headers.get("authorization"), "Bearer fictional-openai-value");
        const body = await request.json();
        openaiBodies.push(body);
        if (refusePdf) return Response.json({ error: { message: "file inputs are not supported" } }, { status: 400 });
        return Response.json({ id: "chatcmpl-fixture", object: "chat.completion", created: 1, model: body.model,
          choices: [{ index: 0, finish_reason: "tool_calls", message: { role: "assistant", content: null, tool_calls: [
            { id: "call_1", type: "function", function: { name: "record_items", arguments: JSON.stringify({ items: [extracted] }) } }] } }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
      }
      assert.equal(url.host, "storage.example");
      if (url.pathname.includes("/bucket/")) return Response.json({ name: "fictional-documents", public: isPublic });
      const key = url.pathname.split("fictional-documents/")[1];
      if (request.method === "POST") { objects.set(key, await request.blob()); return Response.json({ Key: key }); }
      if (request.method === "GET") return objects.has(key) ? new Response(objects.get(key)) : Response.json({}, { status: 404 });
      if (request.method === "DELETE") {
        const { prefixes } = await request.json();
        for (const path of prefixes) objects.delete(path);
        return Response.json([]);
      }
      throw new Error("Unexpected storage operation");
    };
    const address = await forwardingAddress(db, a);
    assert.equal(address.split("@")[0].length, 64);
    assert.ok(!address.includes(a));
    assert.equal(await forwardingAddress(db, a), address);
    assert.equal(await householdForRecipient(db, address.toUpperCase()), a);
    assert.equal(await householdForRecipient(db, address.replace("inbox.example", "wrong.example")), null);
    const changed = (address.startsWith("a") ? "b" : "a") + address.slice(1);
    assert.equal(await householdForRecipient(db, changed), null);
    console.log("✓ Forwarding alias is stable, authenticated, case-insensitive and scoped");

    const file = (s: string) => new TextEncoder().encode(s).buffer;
    const raw = file("%PDF-1.7 fictional fixture");
    const doc = await storeDocument(db, a, "upload", expectedMime, raw);
    await Promise.all([readDocument(db, a, doc), readDocument(db, a, doc)]);
    await readDocument(db, a, doc);
    assert.equal(await storeDocument(db, a, "upload", expectedMime, raw), doc);
    assert.equal(calls, 1);
    const first = (await readerInbox(db, a)).readings[0];
    assert.equal(first.value.name, "Harbor Lights");
    assert.equal((await loadMoneyState(db, a, "2026-11-14")).bills.length, bills);
    assert.deepEqual(await readerInbox(db, b), { readings: [], jobs: [] });
    assert.equal(await reviewReading(db, b, first.id, first.value), false);
    const corrected = { ...first.value, name: "Harbor Energy", category: "utilities" as const, amountMinor: 11220 };
    assert.equal(await reviewReading(db, a, first.id, corrected), true);
    assert.equal(await reviewReading(db, a, first.id, corrected), false);
    assert.equal((await loadMoneyState(db, a, "2026-11-14")).bills.length, bills + 1);
    extracted.amountMinor = 9000;
    const second = await storeDocument(db, a, "upload", expectedMime, file("%PDF-1.7 fictional second month"));
    await readDocument(db, a, second);
    const again = (await readerInbox(db, a)).readings[0];
    assert.equal(again.value.category, "utilities");
    assert.equal(again.value.name, "Harbor Energy");
    assert.equal(again.value.amountMinor, 9000);
    assert.equal(await reviewReading(db, a, again.id, null), true);
    console.log("✓ Upload → read → confirm is scoped and idempotent; corrected labels recur, amounts do not");

    expectedMime = "message/rfc822";
    extracted = { ...extracted, kind: "charge", name: "Minato kiosk", cardId: card.id, currency: "USD", amountMinor: 1250, date: "2026-11-14" };
    const email = file("From: sender@example.invalid\r\nSubject: Card B purchase\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nMinato kiosk USD 12.50");
    const message = await storeDocument(db, a, "email", expectedMime, email);
    await readDocument(db, a, message);
    const charge = (await readerInbox(db, a)).readings[0];
    const bCard = (await loadMoneyState(db, b, "2026-11-14")).cards[0];
    await assert.rejects(reviewReading(db, a, charge.id, { ...charge.value, cardId: bCard.id }), /household/);
    assert.equal(await reviewReading(db, a, charge.id, charge.value), true);
    const [stored] = await db.select().from(schema.charges).where(and(eq(schema.charges.householdId, a), eq(schema.charges.documentId, message)));
    assert.equal(stored.source, "card_email");
    assert.equal(stored.originalAmountMinor, 1250);
    assert.equal(stored.fxRateMicro, 150000000);
    assert.equal(stored.amountMinor, 1875);
    console.log("✓ Forwarded MIME email produces a card charge, dated FX snapshot and exact integer amounts");

    // D58: the correction offer. Only a changed name, category, work share or card is offered; an amount or a date never is.
    const read = { kind: "bill" as const, name: "HIKARI DENKI KK", category: null, businessBp: 0, cardId: null };
    assert.equal(correctionText(read, { ...read }), null);
    assert.equal(correctionText(read, { ...read, name: "Hikari Denki", category: "utilities", businessBp: 3000 }), "Bills from “HIKARI DENKI KK” are Hikari Denki, Utilities, 30% for work.");
    assert.equal(correctionText(read, { ...read, name: "Hikari Denki" }), "Bills from “HIKARI DENKI KK” are Hikari Denki.");
    assert.equal(correctionText(read, { ...read, category: "utilities" }), "Bills from “HIKARI DENKI KK” are HIKARI DENKI KK, Utilities, personal.");
    assert.ok(correctionText(read, { ...read, businessBp: 10_000, category: "utilities" })?.endsWith("all for work."));
    const chargeRead = { kind: "charge" as const, name: "Minato kiosk", category: "food" as const, businessBp: 0, cardId: null };
    assert.equal(correctionText(chargeRead, { ...chargeRead, cardId: "c1" }, "Card B"), "Charges from “Minato kiosk” are Minato kiosk, Food, personal, on Card B.");
    assert.equal(correctionText({ ...chargeRead, name: "y".repeat(160) }, { ...chargeRead, name: "x".repeat(160), cardId: "c1" }, "z".repeat(80)), null, "over 400 characters: not offered");
    assert.equal(correctionText(read, { ...read, name: "Ref 1234 5678 9012" }), null, "a long number is never offered");
    await db.delete(schema.requestBuckets).where(eq(schema.requestBuckets.householdId, a)); // a fresh minute for the reads below
    const savedExtracted = extracted, savedMime = expectedMime;
    const offered = async (label: string, remember: boolean | undefined, change: { name?: string; category?: "utilities" }, amountOnly = false) => {
      extracted = { ...savedExtracted, kind: "bill", name: label, cardId: null, currency: "JPY", amountMinor: 8000, date: "2026-12-05", category: null as never };
      const id = await storeDocument(db, a, "upload", "application/pdf", file("%PDF-1.7 fictional " + label));
      expectedMime = "application/pdf";
      await readDocument(db, a, id);
      const item = (await readerInbox(db, a)).readings.find(r => r.value.name === label)!;
      const confirmed = { ...item.value, businessBp: 0, category: "utilities" as const, ...change, ...(amountOnly && { amountMinor: 9100, date: "2026-12-07" }) };
      assert.equal(await reviewReading(db, a, item.id, confirmed, {}, remember), true);
    };
    const corrections = async () => (await listMemory(db, a)).filter(i => i.kind === "correction");
    assert.equal((await corrections()).length, 0, "the earlier confirm renamed and recategorised Harbor Lights with the box unticked: nothing was written");
    await offered("SAKURA GAS KK", true, { name: "Sakura Gas" }, true); // the amount and the date changed too
    assert.equal(correctionText({ ...read, category: "utilities" }, { ...read, category: "utilities" }), null, "an amount or a date alone is never offered (they are not even arguments)");
    const kept = await corrections();
    assert.equal(kept.length, 1, "a ticked box writes one correction");
    assert.equal(kept[0].text, "Bills from “SAKURA GAS KK” are Sakura Gas, Utilities, personal.");
    assert.equal(kept[0].madeBy, "form");
    extracted = savedExtracted; expectedMime = savedMime;
    await db.delete(schema.requestBuckets).where(eq(schema.requestBuckets.householdId, a));
    console.log("✓ The correction offer covers name, category, share and card, never an amount or a date; a ticked box writes one correction");

    extracted = { ...extracted, kind: "bill", name: "Fictional Cloud", cardId: null, currency: "JPY", amountMinor: 12_000, date: "2026-12-01", category: "subscriptions" }; // the retried document reads as an annual bill
    const countBefore = calls;
    const retry = await storeDocument(db, a, "email", expectedMime, file("Subject: retry\r\n\r\nMinato kiosk again"));
    delete process.env.AI_TEXT_MODEL;
    await readDocument(db, a, retry);
    assert.equal(calls, countBefore);
    assert.equal((await readerInbox(db, a)).jobs.find(j => j.id === retry)?.error, "AI_TEXT_MODEL is not set");
    process.env.AI_TEXT_MODEL = "fixture-text";
    await readDocument(db, a, retry, true);
    assert.equal(calls, countBefore + 1);
    console.log("✓ Missing model fails clearly; retry uses one more reserved AI call");

    const plan = (await readerInbox(db, a)).readings[0];
    assert.deepEqual([plan.value.repeat, plan.value.nextAmountMinor, plan.value.nextAmountFrom, plan.value.cancelBy], [null, null, null, null], "the reader never proposes a repeat, a new amount or a cancel-by date");
    for (const [change, message] of [[{ cancelBy: "2026-12-02" }, /before the bill is next charged on Dec 1/], [{ nextAmountMinor: 13_000 }, /together with the date/], [{ nextAmountFrom: "2027-12-01" }, /together with the date/], [{ repeat: null, nextAmountMinor: 13_000, nextAmountFrom: "2027-12-01" }, /needs a bill that repeats/]] as const) {
      await assert.rejects(reviewReading(db, a, plan.id, { ...plan.value, repeat: "year", ...change }), message);
    }
    assert.equal((await readerInbox(db, a)).readings.some(r => r.id === plan.id), true, "a refused review leaves the reading in To check");
    assert.equal(await reviewReading(db, a, plan.id, { ...plan.value, repeat: "year", nextAmountMinor: 13_000, nextAmountFrom: "2027-12-01", cancelBy: "2026-11-20" }), true);
    const [planRow] = await db.select().from(schema.bills).where(and(eq(schema.bills.householdId, a), eq(schema.bills.documentId, retry)));
    assert.deepEqual([planRow.status, planRow.repeatUnit, planRow.repeatDay, planRow.amountMinor, planRow.nextAmountMinor, planRow.nextAmountFrom, planRow.cancelBy], ["confirmed", "year", null, 12_000, 13_000, "2027-12-01", "2026-11-20"]);
    assert.deepEqual((await loadMoneyState(db, a, "2026-11-14")).cancelNotices.map(n => [n.biller, n.renewsOn, n.amount]), [["Fictional Cloud", "2026-12-01", 12_000]]);
    console.log("✓ The review card's repeat, new amount and cancel-by date are checked like a typed-in bill and stored with the confirmed bill");

    empty = true;
    const nonfinancial = await storeDocument(db, a, "email", expectedMime, file("Subject: hello\r\n\r\nMinato kiosk newsletter"));
    await readDocument(db, a, nonfinancial);
    const [finished] = await db.select().from(schema.documents).where(and(eq(schema.documents.householdId, a), eq(schema.documents.id, nonfinancial)));
    assert.equal(finished.status, "read");
    assert.equal((await readerInbox(db, a)).jobs.length, 0);
    console.log("✓ A nonfinancial email finishes with nothing to confirm");

    for (const [reason, message] of [["refusal", "AI reader declined to read this document."], ["max_tokens", "Document has too many records to read in one request."]]) {
      stop = reason;
      await assert.rejects(extractDocument(file("Subject: x\r\n\r\nMinato kiosk"), expectedMime, { today: "2026-11-14", currency: "JPY", cards: [] }, async () => conn), { message });
    }
    stop = "tool_use";
    console.log("✓ A refusal or a cut-off answer fails with a clear message");

    const openai = { protocol: "openai" as const, baseUrl: "https://llm.example/v1", key: "fictional-openai-value", textModel: "fixture-text", documentModel: "fixture-document", own: true };
    const context = { today: "2026-11-14", currency: "JPY", cards: [] as { id: string; label: string }[] };
    extracted = { ...extracted, kind: "bill", name: "Harbor Lights", cardId: null, currency: "JPY", amountMinor: 11_200, date: "2026-11-27", category: "other" };
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]).buffer;
    const items = await extractDocument(png, "image/png", context, async () => openai);
    assert.deepEqual(items.map(i => [i.name, i.amountMinor]), [["Harbor Lights", 11_200]]);
    const [sent] = openaiBodies;
    assert.equal(sent.model, "fixture-document");
    assert.deepEqual(sent.tool_choice, { type: "function", function: { name: "record_items" } });
    assert.deepEqual(sent.tools.map(t => t.function.name), ["record_items"]);
    assert.deepEqual(sent.messages.map(m => m.role), ["system", "user"]);
    assert.deepEqual(sent.messages[1].content, [{ type: "image_url", image_url: { url: "data:image/png;base64," + Buffer.from(png).toString("base64") } }]);
    refusePdf = true;
    await assert.rejects(extractDocument(file("%PDF-1.7 fictional"), "application/pdf", context, async () => openai),
      { message: "This model could not read the PDF. Upload a photo of it, or choose another model in Settings." });
    refusePdf = false;
    await assert.rejects(extractDocument(png, "image/png", context, async () => ({ ...openai, baseUrl: "http://llm.example/v1" })), /that address can't be used/i);
    console.log("✓ OpenAI-compatible protocol: an image goes as an image_url part through the forced tool; a PDF the model refuses becomes a clear message");

    isPublic = true;
    await assert.rejects(storeDocument(db, b, "upload", "application/pdf", file("%PDF-B")), /private bucket/);
    isPublic = false;
    await removeHouseholdDocuments(db, a);
    assert.equal(objects.size, 0);
    console.log("✓ Public buckets are refused; cleanup removes the household’s private objects");
  } finally { globalThis.fetch = originalFetch; await pg.close(); }
}
test().catch(error => { console.error("Reader checks failed", error instanceof Error ? error.stack?.split("\n").filter(line => line.trim().startsWith("at ")).slice(0, 4).join("\n") : "", error instanceof Error ? error.message : ""); process.exitCode = 1; });
