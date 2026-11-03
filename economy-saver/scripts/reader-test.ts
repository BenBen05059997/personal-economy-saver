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
import { forwardingAddress, householdForRecipient } from "@/lib/reader/forwarding";

async function test() {
  process.env.SUPABASE_URL = "https://storage.example";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "fictional-test-value";
  process.env.SUPABASE_DOCUMENT_BUCKET = "fictional-documents";
  process.env.ANTHROPIC_API_KEY = "fictional-test-value";
  process.env.ANTHROPIC_DAILY_READ_LIMIT = "8";
  process.env.ANTHROPIC_DOCUMENT_MODEL = "fixture-document";
  process.env.ANTHROPIC_TEXT_MODEL = "fixture-text";
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
    let empty = false;
    let stop = "end_turn";
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
        assert.equal(body.tool_choice, undefined);
        assert.equal(body.output_config.format.type, "json_schema");
        if (expectedMime === "message/rfc822") assert.ok(body.messages[0].content.some((v: { text?: string }) => v.text?.includes("Minato kiosk")));
        else assert.equal(body.messages[0].content[0].source.media_type, expectedMime);
        calls++;
        return Response.json({ id: "msg_fixture", type: "message", role: "assistant", model: body.model, stop_reason: stop, stop_sequence: null,
          content: [{ type: "text", text: JSON.stringify({ items: empty ? [] : [extracted] }) }], usage: { input_tokens: 1, output_tokens: 1 } });
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

    const countBefore = calls;
    const retry = await storeDocument(db, a, "email", expectedMime, file("Subject: retry\r\n\r\nMinato kiosk again"));
    delete process.env.ANTHROPIC_TEXT_MODEL;
    await readDocument(db, a, retry);
    assert.equal(calls, countBefore);
    assert.equal((await readerInbox(db, a)).jobs.find(j => j.id === retry)?.error, "ANTHROPIC_TEXT_MODEL is not set");
    process.env.ANTHROPIC_TEXT_MODEL = "fixture-text";
    await readDocument(db, a, retry, true);
    assert.equal(calls, countBefore + 1);
    console.log("✓ Missing model fails clearly; retry uses one more reserved AI call");

    empty = true;
    const nonfinancial = await storeDocument(db, a, "email", expectedMime, file("Subject: hello\r\n\r\nMinato kiosk newsletter"));
    await readDocument(db, a, nonfinancial);
    const [finished] = await db.select().from(schema.documents).where(and(eq(schema.documents.householdId, a), eq(schema.documents.id, nonfinancial)));
    assert.equal(finished.status, "read");
    assert.equal((await readerInbox(db, a)).jobs.length, 0);
    console.log("✓ A nonfinancial email finishes with nothing to confirm");

    for (const [reason, message] of [["refusal", "AI reader declined to read this document."], ["max_tokens", "Document has too many records to read in one request."]]) {
      stop = reason;
      await assert.rejects(extractDocument(file("Subject: x\r\n\r\nMinato kiosk"), expectedMime, { today: "2026-11-14", currency: "JPY", cards: [] }, async () => "fictional-test-value"), { message });
    }
    stop = "end_turn";
    console.log("✓ A refusal or a cut-off answer fails with a clear message");

    isPublic = true;
    await assert.rejects(storeDocument(db, b, "upload", "application/pdf", file("%PDF-B")), /private bucket/);
    isPublic = false;
    await removeHouseholdDocuments(db, a);
    assert.equal(objects.size, 0);
    console.log("✓ Public buckets are refused; cleanup removes the household’s private objects");
  } finally { globalThis.fetch = originalFetch; await pg.close(); }
}
test().catch(error => { console.error("Reader checks failed", error instanceof Error ? error.stack?.split("\n").filter(line => line.trim().startsWith("at ")).slice(0, 4).join("\n") : ""); process.exitCode = 1; });
