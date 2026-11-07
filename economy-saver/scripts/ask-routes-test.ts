// The Ask doors and their neighbours: /api/ask (body limit, input, rate limit, error mapping), /api/ask/thumb, /api/confirm as Ask's
// document card posts it (from=ask, returnTo, answered), the email limits in extractDocument, and the branches of missingAskSetting.
// The route handlers are called directly with a hand-built Request: Module._load hands them the PGlite database in place of
// src/db/client and a fixed cookie jar in place of next/headers (nothing else is replaced); `/api/ask`'s answerQuestion is
// replaced only in the cases that need a thrown error, and runs for real otherwise. Fictional data only; PGlite, no credentials.
// Run from the project root: npx tsx --tsconfig ./tsconfig.json scripts/ask-routes-test.ts
import assert from "node:assert/strict";
import Module from "node:module";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { and, eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { seedBen } from "@/db/seed";
import { saveTurn } from "@/db/conversation";
import { moveToDevice } from "@/db/place";
import { proposeReadings } from "@/db/readings";
import { requestCount } from "@/db/rate-limit";
import { AiKeyError } from "@/db/ai-key";
import { InputError } from "@/db/input-error";
import { AgentError } from "@/lib/agent/run";
import { MissingAuthSetting } from "@/lib/supabase-auth";
import { askUnavailable, missingAskSetting, serverDefaultHost } from "@/lib/agent/availability";
import { extractDocument, extractSchema } from "@/lib/reader/extract";
import { ReaderError } from "@/lib/reader/settings";

type Handler = (request: Request) => Promise<Response>;
const ORIGIN = "http://127.0.0.1:3123";

async function main() {
  const pg = new PGlite();
  const db = drizzle(pg, { schema });
  let passed = 0;
  const ok = (name: string) => { passed++; console.log(`✓ ${name}`); };

  // ---- the two stand-ins, installed before any route is imported
  let cookie: string | null = null;
  let asking: ((...args: unknown[]) => Promise<unknown>) | null = null;
  const loader = Module as unknown as { _load: (request: string, parent: unknown, isMain: boolean) => unknown; _resolveFilename: (request: string, parent: unknown, isMain: boolean) => string };
  const realLoad = loader._load;
  loader._load = function (request, parent, isMain) {
    if (request === "next/headers") return { cookies: async () => ({ getAll: () => (cookie ? [{ name: "household", value: cookie }] : []), get: (name: string) => (name === "household" && cookie ? { name, value: cookie } : undefined) }) };
    const resolved = (() => { try { return loader._resolveFilename(request, parent, isMain); } catch { return ""; } })();
    if (resolved.endsWith("/src/db/client.ts")) return { db: () => db, MissingDatabaseUrl: class extends Error {} };
    const real = realLoad.call(this, request, parent, isMain);
    if (resolved.endsWith("/src/db/ask.ts")) return { ...(real as object), answerQuestion: (...args: unknown[]) => (asking ? asking(...args) : (real as { answerQuestion: (...a: unknown[]) => Promise<unknown> }).answerQuestion(...args)) };
    return real;
  };
  const infoLines: string[] = [];
  const realInfo = console.info;
  console.info = (...args: unknown[]) => { infoLines.push(args.map(String).join(" ")); };
  const savedEnv = { ...process.env };

  try {
    await migrate(db, { migrationsFolder: "./drizzle" });
    const a = await seedBen(db, { isDemo: true }), b = await seedBen(db, { isDemo: true });
    process.env.APP_URL = ORIGIN;
    const ask = (await import("@/app/api/ask/route")).POST as Handler;
    const thumb = (await import("@/app/api/ask/thumb/route")).POST as Handler;
    const confirm = (await import("@/app/api/confirm/route")).POST as Handler;

    const post = (path: string, body: BodyInit | null, headers: Record<string, string> = {}) =>
      new Request(`${ORIGIN}${path}`, { method: "POST", body, headers: { origin: ORIGIN, host: "127.0.0.1:3123", ...headers } });
    const json = (path: string, value: unknown, headers: Record<string, string> = {}) => post(path, typeof value === "string" ? value : JSON.stringify(value), { "content-type": "application/json", ...headers });
    const question = (over: Record<string, unknown> = {}) => ({ id: crypto.randomUUID(), conversationId: crypto.randomUUID(), text: "Am I fine this month?", source: "manual", canvas: null, ...over });
    const say = async (response: Response) => ({ status: response.status, text: await response.text(), headers: response.headers });

    // ------------------------------------------------------------ the guard (all three routes)
    for (const [name, handler, path] of [["ask", ask, "/api/ask"], ["thumb", thumb, "/api/ask/thumb"], ["confirm", confirm, "/api/confirm"]] as const) {
      cookie = a;
      assert.equal((await handler(json(path, question(), { origin: "http://evil.example" }))).status, 403, `${name}: another origin`);
      assert.equal((await handler(new Request(`${ORIGIN}${path}`, { method: "POST", body: "{}", headers: { host: "127.0.0.1:3123" } }))).status, 403, `${name}: no Origin header on a POST`);
      cookie = null;
      assert.equal((await handler(json(path, question()))).status, 401, `${name}: no household cookie`);
      cookie = crypto.randomUUID();
      assert.equal((await handler(json(path, question()))).status, 401, `${name}: a cookie for no household`);
    }
    ok("all three routes: another origin or no Origin header is 403; no cookie, or one for no household, is 401");

    // ------------------------------------------------------------ /api/ask: body, input, limit
    cookie = a;
    const MAX = 128 * 1024;
    const pad = (size: number) => JSON.stringify({ ...question(), memory: [], pad: "x".repeat(size) });
    const encoded = (text: string) => new TextEncoder().encode(text).length;
    const room = MAX - encoded(pad(0));
    const atLimit = await say(await ask(json("/api/ask", pad(room))));
    assert.equal(encoded(pad(room)), MAX);
    assert.notEqual(atLimit.text, "That is more than one question can carry. Delete some of what the assistant remembers, or start a new conversation.", "exactly 128 KiB is not too big");
    await db.delete(schema.requestBuckets).where(eq(schema.requestBuckets.householdId, a));
    const over = await say(await ask(json("/api/ask", pad(room + 1))));
    assert.deepEqual([over.status, over.text], [400, "That is more than one question can carry. Delete some of what the assistant remembers, or start a new conversation."]);
    assert.equal(over.headers.get("cache-control"), "private, no-store");
    const multibyte = "あ".repeat(Math.ceil(MAX / 3) + 1); // few characters, over the limit in bytes
    assert.ok(multibyte.length < MAX && encoded(multibyte) > MAX);
    assert.equal((await ask(json("/api/ask", multibyte))).status, 400);
    assert.equal(await requestCount(db, a, "ask"), 0, "an oversize body spends no request");
    ok("/api/ask: 128 KiB (counted in bytes, not characters) is the limit; over it is 400 with the fixed sentence and no request spent");

    for (const [label, body] of [["not JSON", "{nope"], ["empty body", ""], ["JSON null", "null"], ["an array", "[]"], ["no id", JSON.stringify({ ...question(), id: undefined })],
      ["an id that is not a uuid", JSON.stringify(question({ id: "1" }))], ["blank text", JSON.stringify(question({ text: "   " }))], ["321 characters", JSON.stringify(question({ text: "a".repeat(321) }))],
      ["a source that is neither", JSON.stringify(question({ source: "telepathy" }))], ["a canvas that is not a recipe", JSON.stringify(question({ canvas: { blocks: "no" } }))],
      ["201 memory items", JSON.stringify(question({ memory: Array.from({ length: 201 }, () => ({})) }))], ["four recent turns", JSON.stringify(question({ recent: [{}, {}, {}, {}] }))]] as const) {
      const answer = await say(await ask(json("/api/ask", body)));
      assert.deepEqual([answer.status, answer.text], [400, "Enter a question of up to 320 characters."], label);
    }
    assert.equal(await requestCount(db, a, "ask"), 0, "invalid input spends no request");
    const exact = question({ text: "a".repeat(320) });
    asking = async () => { throw new InputError("reached the handler"); };
    const reached = await say(await ask(json("/api/ask", exact)));
    assert.deepEqual([reached.status, reached.text], [400, "reached the handler"], "a 320-character question reaches the agent");
    asking = null;
    ok("/api/ask: bad JSON or invalid input is 400 'Enter a question of up to 320 characters.' and spends no request; 320 characters passes");

    // the limit: 30 a minute, the 31st is 429 with Retry-After, and it is per household
    await db.delete(schema.requestBuckets).where(eq(schema.requestBuckets.householdId, a));
    let calls = 0;
    asking = async () => { calls++; return { id: "x", kind: "answer", text: "fine", choices: null, canvas: null, sources: [], links: [], pending: false, firstUse: null, memoryChanges: [], wait: false }; };
    for (let i = 0; i < 30; i++) { const answer = await ask(json("/api/ask", question())); assert.equal(answer.status, 200, `ask ${i + 1}`); }
    const limited = await ask(json("/api/ask", question()));
    assert.deepEqual([limited.status, await limited.text(), limited.headers.get("retry-after"), limited.headers.get("cache-control")], [429, "Ask again in a minute.", "60", "private, no-store"]);
    assert.equal(calls, 30, "the 31st never reached the agent");
    cookie = b;
    assert.equal((await ask(json("/api/ask", question()))).status, 200, "another household has its own count");
    cookie = a;
    const reply = await ask(json("/api/ask", question()).clone());
    assert.equal(reply.status, 429);
    await db.delete(schema.requestBuckets).where(eq(schema.requestBuckets.householdId, a));
    const fine = await ask(json("/api/ask", question()));
    assert.deepEqual([fine.status, fine.headers.get("cache-control"), (await fine.json() as { text: string }).text], [200, "private, no-store", "fine"]);
    asking = null;
    ok("/api/ask: 30 questions a minute, the 31st is 429 'Ask again in a minute.' with Retry-After 60; per household; a success is JSON, no-store");

    // ------------------------------------------------------------ /api/ask: error mapping
    await db.delete(schema.requestBuckets).where(eq(schema.requestBuckets.householdId, a));
    const FIXED = "Couldn't answer right now. Try again.";
    const failing = async (error: unknown) => { asking = async () => { throw error; }; return say(await ask(json("/api/ask", question()))); };
    const mapped = async (error: unknown, expected: [number, string]) => {
      const answer = await failing(error);
      assert.deepEqual([answer.status, answer.text], expected, String(error));
      assert.equal(answer.headers.get("cache-control"), "private, no-store");
      return answer;
    };
    await mapped(new InputError("Reload the page and ask again."), [400, "Reload the page and ask again."]);
    await mapped(new AgentError("The assistant took too long."), [503, "The assistant took too long."]);
    await mapped(new AiKeyError("That key was not accepted."), [503, "That key was not accepted."]);
    await mapped(new MissingAuthSetting("SUPABASE_URL is not set"), [503, "SUPABASE_URL is not set"]);
    for (const name of ["AI_TEXT_MODEL", "AI_PROTOCOL", "AI_BASE_URL", "AI_API_KEY", "AI_DAILY_LIMIT"]) {
      for (const Kind of [AgentError, AiKeyError, MissingAuthSetting]) await mapped(new Kind(`${name} is not set`), [503, askUnavailable(name)]);
    }
    // an unknown-named or longer message is not rewritten; only exactly `AI_X is not set` is
    await mapped(new AgentError("AI_TEXT_MODEL is not set, sorry"), [503, "AI_TEXT_MODEL is not set, sorry"]);
    await mapped(new AgentError("ai_text_model is not set"), [503, "ai_text_model is not set"]);
    // anything else, including an Error whose text names a secret or a setting, is the fixed sentence
    for (const error of [new Error("AI_TEXT_MODEL is not set"), new Error("connect ECONNREFUSED 10.0.0.1:5432 password=fictional-secret"), new TypeError("x is not a function"), "a string", null, { message: "AI_TEXT_MODEL is not set" }]) {
      const answer = await mapped(error, [503, FIXED]);
      assert.ok(!answer.text.includes("secret") && !answer.text.includes("ECONNREFUSED"), "the error's own text never reaches the person");
    }
    asking = null;
    ok("/api/ask errors: InputError 400 with its message; AgentError, AiKeyError, MissingAuthSetting 503 with theirs; 'AI_X is not set' becomes askUnavailable(X); anything else 503 with the fixed sentence only");

    // the real answerQuestion behind the route: a household that keeps its memory on the device is refused a question without it, as 400
    await db.delete(schema.requestBuckets).where(eq(schema.requestBuckets.householdId, b));
    cookie = b;
    const mismatch = await say(await ask(json("/api/ask", question({ memory: [] }))));
    assert.deepEqual([mismatch.status, mismatch.text], [400, "This household keeps its memory in our cloud. Reload the page and ask again."]);
    // and with no AI setting on this server the real agent path stops with a sentence a person can read (never the key)
    for (const key of Object.keys(process.env)) if (key.startsWith("AI_")) delete process.env[key];
    const unset = await say(await ask(json("/api/ask", question())));
    assert.equal(unset.status, 503);
    assert.deepEqual([unset.status, unset.text], [503, askUnavailable("AI_TEXT_MODEL")], "the real path names the first missing setting");
    Object.assign(process.env, savedEnv);
    ok("/api/ask, real answerQuestion: a memory/place mismatch is 400 with its sentence; no AI settings is 503 with words");

    // ------------------------------------------------------------ /api/ask/thumb
    const turn = (over: Partial<Parameters<typeof saveTurn>[2]> = {}) => ({ id: crypto.randomUUID(), conversationId: crypto.randomUUID(), question: "q", kind: "answer" as const, reply: "r", choices: null, recipe: null, sources: [], ...over });
    const mine = turn(), theirs = turn();
    await saveTurn(db, a, mine); await saveTurn(db, b, theirs);
    const thumbOf = async (id: string) => (await db.select({ thumb: schema.conversationTurns.thumb }).from(schema.conversationTurns).where(eq(schema.conversationTurns.id, id)))[0].thumb;
    const TEXT = "Choose Helpful or Not helpful.";
    cookie = a;
    await db.delete(schema.requestBuckets).where(eq(schema.requestBuckets.householdId, a));
    for (const [label, body] of [["not JSON", "{"], ["empty", ""], ["no thumb", { id: mine.id }], ["a thumb that is not one", { id: mine.id, thumb: "sideways" }], ["a number", { id: mine.id, thumb: 1 }],
      ["no id", { thumb: "up" }], ["an id that is not a uuid", { id: "7", thumb: "up" }], ["device false", { id: mine.id, thumb: "up", device: false }], ["an extra field", { id: mine.id, thumb: "up", question: "no" }]] as const) {
      const answer = await say(await thumb(json("/api/ask/thumb", body)));
      assert.deepEqual([answer.status, answer.text], [400, TEXT], label);
    }
    assert.equal(await requestCount(db, a, "thumb"), 0, "invalid input spends no request");
    infoLines.length = 0;
    assert.deepEqual((await say(await thumb(json("/api/ask/thumb", { id: mine.id, thumb: "up" })))).text, "Saved");
    assert.equal(await thumbOf(mine.id), 1);
    await thumb(json("/api/ask/thumb", { id: mine.id, thumb: "down" }));
    assert.equal(await thumbOf(mine.id), -1);
    await thumb(json("/api/ask/thumb", { id: mine.id, thumb: null }));
    assert.equal(await thumbOf(mine.id), null, "null clears it");
    const lines = infoLines.map(line => JSON.parse(line));
    assert.deepEqual(lines, [
      { at: "thumb", householdId: a, askId: mine.id, thumb: "up" }, { at: "thumb", householdId: a, askId: mine.id, thumb: "down" }, { at: "thumb", householdId: a, askId: mine.id, thumb: null }]);
    assert.ok(!infoLines.join("").includes("Am I fine") && !infoLines.join("").includes('"r"'), "the log line has ids and the thumb only");
    ok("/api/ask/thumb: strict input (uuid id, up/down/null, nothing else) else 400; up, down and null set the stored thumb and write one content-free log line each");

    // household scoping, unknown ids
    const stranger = await say(await thumb(json("/api/ask/thumb", { id: theirs.id, thumb: "up" })));
    assert.deepEqual([stranger.status, stranger.text], [404, "That answer is no longer here."]);
    assert.equal(await thumbOf(theirs.id), null, "another household's answer is untouched");
    assert.equal((await thumb(json("/api/ask/thumb", { id: crypto.randomUUID(), thumb: "up" }))).status, 404);
    assert.equal(infoLines.length, 3, "a refused thumb writes no log line");
    ok("/api/ask/thumb: another household's answer, or no such answer, is 404 and changes and logs nothing");

    // the limit is 30 a minute
    await db.delete(schema.requestBuckets).where(eq(schema.requestBuckets.householdId, a));
    for (let i = 0; i < 30; i++) assert.equal((await thumb(json("/api/ask/thumb", { id: mine.id, thumb: "up" }))).status, 200, `thumb ${i + 1}`);
    const tooMany = await thumb(json("/api/ask/thumb", { id: mine.id, thumb: "up" }));
    assert.deepEqual([tooMany.status, await tooMany.text(), tooMany.headers.get("retry-after")], [429, "Too many requests. Try again in a minute.", "60"]);
    cookie = b;
    assert.equal((await thumb(json("/api/ask/thumb", { id: theirs.id, thumb: "down" }))).status, 200, "another household has its own count");
    assert.equal(await thumbOf(theirs.id), -1);
    ok("/api/ask/thumb: 30 a minute, the 31st is 429 with Retry-After 60, per household");

    // conversations kept on the device: the browser holds the thumb, the server only logs
    await db.delete(schema.requestBuckets).where(eq(schema.requestBuckets.householdId, b));
    cookie = b;
    const deviceAsk = crypto.randomUUID();
    const early = await say(await thumb(json("/api/ask/thumb", { id: deviceAsk, thumb: "up", device: true })));
    assert.deepEqual([early.status, early.text], [409, "Reload the page and try again."], "device:true while the journal is in the cloud");
    await moveToDevice(db, b, "journal", [theirs.id], { madeBy: "form" });
    assert.deepEqual(await (async () => { const r = await thumb(json("/api/ask/thumb", { id: deviceAsk, thumb: "up" })); return [r.status, await r.text()]; })(), [409, "Reload the page and try again."], "no device flag while the journal is on the device");
    infoLines.length = 0;
    assert.deepEqual(await (async () => { const r = await thumb(json("/api/ask/thumb", { id: deviceAsk, thumb: "down", device: true })); return [r.status, await r.text()]; })(), [200, "Saved"]);
    assert.deepEqual(infoLines.map(line => JSON.parse(line)), [{ at: "thumb", householdId: b, askId: deviceAsk, thumb: "down" }], "a device thumb for an id the server does not hold still logs");
    assert.equal((await db.select().from(schema.conversationTurns).where(eq(schema.conversationTurns.householdId, b))).length, 0, "moving to the device left no server turn, and the thumb wrote none");
    ok("/api/ask/thumb: device:true must match where the household keeps its journal (409 otherwise); on the device only the log line is written");

    // ------------------------------------------------------------ /api/confirm from Ask
    cookie = a;
    await db.delete(schema.requestBuckets).where(eq(schema.requestBuckets.householdId, a));
    const readingFor = async (hid: string, name: string, over: Record<string, unknown> = {}) => {
      const [doc] = await db.insert(schema.documents).values({ householdId: hid, kind: "upload", storagePath: `fictional/${crypto.randomUUID()}`, mime: "application/pdf", status: "read" }).returning({ id: schema.documents.id });
      await proposeReadings(db, hid, doc.id, [extractSchema.parse({ kind: "bill", name, date: "2026-11-27", amountMinor: 6000, currency: "JPY", category: "other", cardId: null, ...over })]);
      const [row] = await db.select().from(schema.readings).where(and(eq(schema.readings.householdId, hid), eq(schema.readings.documentId, doc.id)));
      return row.id;
    };
    const fields = (id: string, over: Record<string, string> = {}, extra: [string, string][] = []) => {
      const form = new FormData();
      for (const [key, value] of Object.entries({ kind: "reading", id, decision: "confirm", target: "bill", name: "Kawa Gym", amount: "6000", currency: "JPY", date: "2026-11-27", category: "other", ...over })) form.set(key, value);
      for (const [key, value] of extra) form.append(key, value);
      return form;
    };
    const send = async (form: FormData, headers: Record<string, string> = {}) => { const r = await confirm(post("/api/confirm", form, headers)); return { status: r.status, text: await r.text(), location: r.headers.get("location"), redirect: r.headers.get("x-form-redirect") }; };
    const bills = async (hid: string, name: string) => (await db.select().from(schema.bills).where(and(eq(schema.bills.householdId, hid), eq(schema.bills.biller, name))));
    const statusOf = async (id: string) => (await db.select({ status: schema.readings.status }).from(schema.readings).where(eq(schema.readings.id, id)))[0].status;

    const first = await readingFor(a, "Kawa Gym");
    // the card asked 'does it come again?'; from=ask without the answer is refused, nothing is saved
    const refused = await send(fields(first, {}, [["from", "ask"], ["returnTo", "/canvas"]]));
    assert.deepEqual([refused.status, refused.text], [400, "Answer the question first: Does Kawa Gym come again?"]);
    assert.equal((await bills(a, "Kawa Gym")).length, 0);
    assert.equal(await statusOf(first), "to_check");
    // answered values that are not check kinds are dropped, so a made-up kind does not satisfy the rule
    const bogus = await send(fields(first, {}, [["from", "ask"], ["returnTo", "/canvas"], ["answered", "not_a_check"], ["answered", ""]]));
    assert.equal(bogus.status, 400);
    // 'answered' without from=ask is ignored: this is a Confirm from To check, which has no answer rule
    const toCheck = await readingFor(a, "Tama Pool");
    const plain = await send(fields(toCheck, { name: "Tama Pool" }, [["answered", "not_a_check"]]));
    assert.deepEqual([plain.status, plain.location], [303, "/to-check"], "no returnTo goes back to To check");
    assert.equal((await bills(a, "Tama Pool")).length, 1);
    // the answer given, the choice made (repeat month), returnTo /canvas, posted by ApiForm
    const answered = await send(fields(first, { repeat: "month" }, [["from", "ask"], ["returnTo", "/canvas"], ["answered", "repeat_unknown"]]), { "x-form-fetch": "1" });
    assert.deepEqual([answered.status, answered.redirect, answered.location], [204, "/canvas", null]);
    const [saved] = await bills(a, "Kawa Gym");
    assert.deepEqual([saved.repeatUnit, saved.amountMinor, saved.due, saved.status], ["month", 6000, "2026-11-27", "confirmed"]);
    assert.equal(await statusOf(first), "confirmed");
    ok("/api/confirm from Ask: unanswered question is 400 with its words and saves nothing; made-up 'answered' values do not count; with the answer it saves and returns to /canvas (204 header for ApiForm); 'answered' alone is ignored outside from=ask");

    // a native post (no x-form-fetch) gets a 303; returnTo that is not an offered page goes Home; Just this once is a one-off
    const second = await readingFor(a, "Maple Tea");
    const native = await send(fields(second, { name: "Maple Tea" }, [["from", "ask"], ["returnTo", "/canvas"], ["answered", "repeat_unknown"]]));
    assert.deepEqual([native.status, native.location], [303, "/canvas"]);
    assert.equal((await bills(a, "Maple Tea"))[0].repeatUnit, null, "just this once");
    for (const [returnTo, expected] of [["https://evil.example/", "/"], ["//evil.example", "/"], ["/api/memory", "/"], ["/memory", "/memory"], ["", "/"]] as const) {
      const reading = await readingFor(a, `Return ${expected}${returnTo.length}`);
      const result = await send(fields(reading, { name: `Return ${expected}${returnTo.length}` }, [["from", "ask"], ["returnTo", returnTo], ["answered", "repeat_unknown"]]));
      assert.deepEqual([result.status, result.location], [303, expected], `returnTo ${JSON.stringify(returnTo)}`);
    }
    ok("/api/confirm from Ask: native post is a 303 to returnTo; a returnTo that is not an offered page goes to /; 'Just this once' saves a one-off");

    // Dismiss from Ask never needs an answer; another household's reading, a missing or malformed id, a bad decision
    const dismiss = await readingFor(a, "Dismissed Gym");
    const gone = await send(fields(dismiss, { decision: "reject" }, [["from", "ask"], ["returnTo", "/canvas"]]));
    assert.deepEqual([gone.status, gone.location], [303, "/canvas"]);
    assert.equal(await statusOf(dismiss), "rejected");
    assert.equal((await bills(a, "Dismissed Gym")).length, 0);
    const foreign = await readingFor(b, "Foreign Gym");
    const stolen = await send(fields(foreign, {}, [["from", "ask"], ["returnTo", "/canvas"], ["answered", "repeat_unknown"]]));
    assert.equal(await statusOf(foreign), "to_check", "another household's reading is untouched");
    assert.equal((await bills(a, "Kawa Gym")).length, 1);
    assert.deepEqual([stolen.status, stolen.location], [303, "/canvas"], "a reading that is not this household's changes nothing (the route still redirects)");
    assert.equal((await bills(b, "Kawa Gym")).length, 0);
    assert.deepEqual((await send(fields("not-a-uuid"))).text, "Invalid item");
    assert.equal((await send(fields(crypto.randomUUID(), { decision: "maybe" }))).text, "Invalid decision");
    assert.equal((await send(fields(crypto.randomUUID(), { kind: "nonsense" }))).text, "Invalid item");
    const badAmount = await readingFor(a, "Bad Amount Gym");
    const badFields = await send(fields(badAmount, { amount: "-5" }, [["from", "ask"], ["returnTo", "/canvas"], ["answered", "repeat_unknown"]]));
    assert.equal(badFields.status, 400);
    assert.equal(await statusOf(badAmount), "to_check");
    const notForm = await confirm(json("/api/confirm", { kind: "reading" }));
    assert.equal(notForm.status, 400);
    ok("/api/confirm from Ask: Dismiss needs no answer; another household's reading changes nothing; bad id, decision, kind, amount, or a non-form body are 400");

    // ------------------------------------------------------------ email limits in extractDocument
    const connection = { protocol: "anthropic" as const, baseUrl: "https://api.anthropic.com", key: "fictional-test-value", textModel: "fixture-text", documentModel: "fixture-document", own: false };
    const context = { today: "2026-11-14", currency: "JPY", cards: [] };
    let asked: string[] = [];
    let sent: { model: string; messages: { content: string | { type: string }[] }[] }[] = [];
    const modelFetch = (async (_input: unknown, init?: RequestInit) => {
      sent.push(JSON.parse(String(init?.body)));
      return Response.json({ id: "m", type: "message", role: "assistant", model: "x", stop_reason: "tool_use", stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 },
        content: [{ type: "tool_use", id: "tu", name: "record_items", input: { items: [] } }] });
    }) as typeof fetch;
    const read = (eml: string) => {
      asked = []; sent = [];
      return extractDocument(new TextEncoder().encode(eml).buffer as ArrayBuffer, "message/rfc822", context, async need => { asked.push(need); return connection; }, modelFetch);
    };
    const attachmentPart = (n: number, type = "image/png") => `--B\r\nContent-Type: ${type}; name="a${n}.png"\r\nContent-Transfer-Encoding: base64\r\nContent-Disposition: attachment; filename="a${n}.png"\r\n\r\niVBORw0KGgo=\r\n`;
    const mail = (body: string, attachments = 0, type = "image/png") => `From: s@example.invalid\r\nSubject: s\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary="B"\r\n\r\n--B\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}\r\n${Array.from({ length: attachments }, (_, i) => attachmentPart(i, type)).join("")}--B--\r\n`;
    const readerError = (message: string) => (e: unknown) => e instanceof ReaderError && e.message === message;
    const TOO_LARGE = "Email is too large to read in one request.";
    await assert.rejects(read(mail("x", 9)), readerError(TOO_LARGE), "nine attachments");
    assert.deepEqual(asked, [], "refused before any model is chosen");
    assert.deepEqual(await read(mail("x", 8)), [], "eight attachments pass");
    assert.deepEqual(asked, ["document"], "an email with a supported attachment needs the document model");
    assert.equal(sent[0].model, "fixture-document");
    assert.equal((sent[0].messages[0].content as { type: string }[]).filter(part => part.type === "image").length, 8, "all eight go to the model");
    // text length counts the subject, a newline and the body: 100,000 characters pass, 100,001 do not
    const subjectLine = "s\n";
    const textOf = async (body: string) => { await read(mail(body)); return sent[0].messages[0].content as string; };
    const probe = await textOf("y".repeat(10));
    assert.equal(probe.startsWith(subjectLine + "y"), true);
    const slack = 100_000 - probe.length + 10; // body size that makes the joined text exactly 100,000
    assert.equal((await textOf("y".repeat(slack))).length, 100_000);
    assert.deepEqual(await read(mail("y".repeat(slack))), []);
    assert.deepEqual(asked, ["text"], "no attachment: the text model");
    assert.equal(sent[0].model, "fixture-text");
    await assert.rejects(read(mail("y".repeat(slack + 1))), readerError(TOO_LARGE), "100,001 characters");
    assert.deepEqual(asked, [], "refused before the connection is asked for");
    // the unsupported attachment types are not counted: nine zip files and a short body still read as text
    assert.deepEqual(await read(mail("hello", 9, "application/zip")), []);
    assert.deepEqual(asked, ["text"]);
    // no body and nothing supported
    await assert.rejects(read(`From: s@example.invalid\r\nMIME-Version: 1.0\r\nContent-Type: text/plain\r\n\r\n\r\n`), readerError("Email has no readable body or supported attachment."));
    assert.deepEqual(asked, []);
    ok("extractDocument email limits: more than 8 supported attachments, or more than 100,000 characters of subject, date and body, is refused before any model is chosen; unsupported types are not counted; nothing to read is refused");

    // ------------------------------------------------------------ missingAskSetting and askUnavailable
    const names = ["AI_TEXT_MODEL", "AI_PROTOCOL", "AI_BASE_URL", "AI_API_KEY", "AI_DAILY_LIMIT"];
    const set = (values: Record<string, string | undefined>) => { for (const n of names) delete process.env[n]; for (const [k, v] of Object.entries(values)) if (v !== undefined) process.env[k] = v; };
    const full = { AI_TEXT_MODEL: "m", AI_PROTOCOL: "openai", AI_BASE_URL: "https://models.example/v1", AI_API_KEY: "k", AI_DAILY_LIMIT: "50" };
    set({});
    assert.equal(missingAskSetting(true), null, "a household's own connection needs none of them");
    assert.equal(missingAskSetting(false), "AI_TEXT_MODEL", "nothing set: the model first");
    assert.equal(missingAskSetting(false), "AI_TEXT_MODEL");
    set({ ...full, AI_TEXT_MODEL: "  " }); assert.equal(missingAskSetting(false), "AI_TEXT_MODEL", "blank counts as not set");
    set({ ...full, AI_PROTOCOL: undefined }); assert.equal(missingAskSetting(false), "AI_PROTOCOL");
    set({ ...full, AI_PROTOCOL: " " }); assert.equal(missingAskSetting(false), "AI_PROTOCOL");
    set({ ...full, AI_BASE_URL: undefined }); assert.equal(missingAskSetting(false), "AI_BASE_URL", "openai needs an address");
    set({ ...full, AI_BASE_URL: "  " }); assert.equal(missingAskSetting(false), "AI_BASE_URL");
    set({ ...full, AI_PROTOCOL: "anthropic", AI_BASE_URL: undefined }); assert.equal(missingAskSetting(false), null, "anthropic needs no address");
    set({ ...full, AI_API_KEY: undefined }); assert.equal(missingAskSetting(false), "AI_API_KEY");
    set({ ...full, AI_API_KEY: "" }); assert.equal(missingAskSetting(false), "AI_API_KEY");
    set({ ...full, AI_DAILY_LIMIT: undefined }); assert.equal(missingAskSetting(false), "AI_DAILY_LIMIT");
    set({ ...full, AI_DAILY_LIMIT: " " }); assert.equal(missingAskSetting(false), "AI_DAILY_LIMIT");
    set({ ...full, AI_TEXT_MODEL: undefined, AI_PROTOCOL: undefined, AI_API_KEY: undefined }); assert.equal(missingAskSetting(false), "AI_TEXT_MODEL", "the first missing one in order");
    set({ ...full, AI_PROTOCOL: undefined, AI_BASE_URL: undefined, AI_DAILY_LIMIT: undefined }); assert.equal(missingAskSetting(false), "AI_PROTOCOL");
    set(full); assert.equal(missingAskSetting(false), null, "everything set");
    set({ ...full, AI_PROTOCOL: "anthropic" }); assert.equal(missingAskSetting(false), null);
    set({ ...full, AI_PROTOCOL: " openai ", AI_BASE_URL: undefined }); assert.equal(missingAskSetting(false), "AI_BASE_URL", "the protocol is trimmed");
    assert.equal(askUnavailable("AI_API_KEY"), "Ask isn’t available on this server yet (AI_API_KEY).");
    assert.ok(!askUnavailable("AI_API_KEY").includes("fictional"), "a name, never a value");
    set({}); assert.equal(serverDefaultHost(), null);
    set({ ...full, AI_PROTOCOL: "anthropic" }); assert.equal(serverDefaultHost(), "api.anthropic.com");
    set(full); assert.equal(serverDefaultHost(), "models.example");
    set({ ...full, AI_BASE_URL: "http://127.0.0.1:3130/v1" }); assert.equal(serverDefaultHost(), "127.0.0.1:3130");
    set({ ...full, AI_BASE_URL: "not a url" }); assert.equal(serverDefaultHost(), null);
    set({ ...full, AI_BASE_URL: undefined }); assert.equal(serverDefaultHost(), null);
    set({ ...full, AI_PROTOCOL: "other" }); assert.equal(serverDefaultHost(), null);
    ok("missingAskSetting: every branch and the order (own connection, model, protocol, openai address, key, daily limit; blanks count as unset); askUnavailable and serverDefaultHost");
  } finally {
    console.info = realInfo;
    loader._load = realLoad;
    for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
    Object.assign(process.env, savedEnv);
    await pg.close();
  }
  console.log(`\n${passed} checks passed`);
}

main().catch(error => { console.error(error); process.exit(1); });
