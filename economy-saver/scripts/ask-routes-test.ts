// The Ask doors and their neighbours: /api/ask (body limit, input, rate limit, error mapping), /api/ask/thumb, /api/confirm as Ask's
// document card posts it (from=ask, returnTo, answered), /api/ask/view, reader email limits, and missingAskSetting.
// The route handlers are called directly with a hand-built Request: Module._load hands them the PGlite database in place of
// src/db/client and a fixed cookie jar in place of next/headers. The render check stubs router and CSS imports. `/api/ask`'s answerQuestion is
// replaced only in the cases that need a thrown error, and runs for real otherwise. Fictional data only; PGlite, no credentials.
// Run from the project root: npx tsx --tsconfig ./tsconfig.json scripts/ask-routes-test.ts
import assert from "node:assert/strict";
import Module from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { and, eq, sql } from "drizzle-orm";
import * as schema from "@/db/schema";
import { seedBen } from "@/db/seed";
import { pinCanvas } from "@/db/canvases";
import type { AskView } from "@/db/ask-view";
import { createSpace, generalSpace, listSpaces, saveBrief } from "@/db/spaces";
import { addMemory, listMemory } from "@/db/memory";
import { saveTurn, allTurns } from "@/db/conversation";
import { moveToDevice } from "@/db/place";
import { proposeReadings } from "@/db/readings";
import { requestCount } from "@/db/rate-limit";
import { AiKeyError } from "@/db/ai-key";
import { InputError } from "@/db/input-error";
import { AgentError } from "@/lib/agent/run";
import { MissingAuthSetting } from "@/lib/supabase-auth";
import { askUnavailable, missingAskSetting, NEEDS_KEY, serverDefaultHost } from "@/lib/agent/availability";
import { extractDocument, extractSchema } from "@/lib/reader/extract";
import { ReaderError } from "@/lib/reader/settings";
import { FORM_FETCH_HEADER, FORM_REDIRECT_HEADER } from "@/lib/form-fetch";
import { CLOSED_PANEL, readPanelPreferences, writePanelPreferences } from "@/components/ask/panel-preferences";

type Handler = (request: Request) => Promise<Response>;
const ORIGIN = "http://127.0.0.1:3123";

import { demoCookies } from "./demo-cookie";
async function main() {
  const pg = new PGlite({ extensions: { pg_trgm } });
  const db = drizzle(pg, { schema });
  let passed = 0;
  const ok = (name: string) => { passed++; console.log(`✓ ${name}`); };

  // ---- test stand-ins, installed before any route is imported
  let cookie: string | null = null;
  let realAnswerQuestion: typeof import("@/db/ask").answerQuestion;
  let asking: ((...args: unknown[]) => Promise<unknown>) | null = null;
  // The checks name the Try it household by id; the cookie the routes read is its token (D34).
  const tokenFor = demoCookies(db);
  const loader = Module as unknown as { _load: (request: string, parent: unknown, isMain: boolean) => unknown; _resolveFilename: (request: string, parent: unknown, isMain: boolean) => string };
  const realLoad = loader._load;
  loader._load = function (request, parent, isMain) {
    if (request === "next/headers") return { cookies: async () => {
      const value = await tokenFor(cookie);
      return { getAll: () => (value ? [{ name: "household", value }] : []), get: (name: string) => (name === "household" && value ? { name, value } : undefined) };
    } };
    if (request === "next/navigation") return { usePathname: () => "/", useRouter: () => ({}) };
    if (request.endsWith(".css")) return {};
    const resolved = (() => { try { return loader._resolveFilename(request, parent, isMain); } catch { return ""; } })();
    if (resolved.endsWith("/src/db/client.ts")) return { db: () => db, MissingDatabaseUrl: class extends Error {} };
    const real = realLoad.call(this, request, parent, isMain);
    if (resolved.endsWith("/src/db/ask.ts")) {
      realAnswerQuestion = (real as typeof import("@/db/ask")).answerQuestion;
      return { ...(real as object), answerQuestion: (...args: Parameters<typeof realAnswerQuestion>) => asking ? asking(...args) : realAnswerQuestion(...args) };
    }
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
    /** A question that got past the checks is a 200 stream of lines (27B): steps, then one reply or error line. */
    const streamed = async (response: Response) => {
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("content-type"), "application/x-ndjson");
      assert.equal(response.headers.get("cache-control"), "private, no-store");
      const lines = (await response.text()).split("\n").filter(Boolean).map(line => JSON.parse(line) as { step?: string; reply?: import("@/db/ask").AskReply; error?: string });
      const last = lines.at(-1)!;
      assert.ok(lines.slice(0, -1).every(line => typeof line.step === "string" && Object.keys(line).length === 1), "every line but the last is a step");
      assert.ok(("reply" in last) !== ("error" in last) && !("step" in last), "the last line is a reply or an error");
      return { steps: lines.slice(0, -1).map(line => line.step!), last, status: response.status, text: last.error ?? last.reply!.text, headers: response.headers };
    };

    {
      const tab = () => {
        const values = new Map<string, string>();
        return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
      };
      const firstTab = tab(), secondTab = tab();
      const spaceId = crypto.randomUUID();
      const preferred = { open: true, spaceId, draft: "Private draft", view: { question: "Private question" } };
      writePanelPreferences(firstTab, a, preferred);
      assert.deepEqual([...firstTab.values.values()].map(value => JSON.parse(value)), [{ open: true, spaceId }]);
      assert.deepEqual(readPanelPreferences(firstTab, a), { open: true, spaceId });
      assert.deepEqual(readPanelPreferences(firstTab, b), CLOSED_PANEL);
      assert.deepEqual(readPanelPreferences(secondTab, a), CLOSED_PANEL);
      writePanelPreferences(firstTab, b, { open: true, spaceId: null });
      const secondPreference = { open: true, spaceId: crypto.randomUUID() };
      writePanelPreferences(secondTab, a, secondPreference);
      writePanelPreferences(firstTab, a, { open: false, spaceId });
      assert.deepEqual(readPanelPreferences(firstTab, a), { open: false, spaceId });
      assert.deepEqual(readPanelPreferences(firstTab, b), { open: true, spaceId: null });
      assert.deepEqual(readPanelPreferences(secondTab, a), secondPreference);
      ok("Ask panel preferences store only open and space, separately by household and tab");

      for (const value of ["{broken", "null", "[]", '{"open":"yes"}']) {
        assert.deepEqual(readPanelPreferences({ getItem: () => value }, a), CLOSED_PANEL);
      }
      for (const spaceId of ["not a UUID", "-".repeat(36)]) {
        const invalidSpace = { getItem: () => JSON.stringify({ open: true, spaceId }) };
        assert.deepEqual(readPanelPreferences(invalidSpace, a), { open: true, spaceId: null });
      }
      const blocked = () => { throw new DOMException("Storage is blocked", "SecurityError"); };
      assert.deepEqual(readPanelPreferences({ getItem: blocked }, a), CLOSED_PANEL);
      assert.doesNotThrow(() => writePanelPreferences({ setItem: blocked }, a, { open: true, spaceId }));
      ok("Malformed and blocked Ask panel storage leave safe preferences");

      const realFetch = globalThis.fetch;
      let fetches = 0;
      try {
        globalThis.fetch = async () => { fetches++; throw new Error("The closed workspace must not fetch"); };
        const { AskWorkspace } = await import("@/components/shell/AskWorkspace");
        const workspace = { householdId: a, children: createElement("main", null, "Fictional Home") };
        const html = renderToStaticMarkup(createElement(AskWorkspace, workspace));
        assert.ok(html.includes('<main>Fictional Home</main>'));
        assert.doesNotMatch(html, /data-ask-open|shell-ask-panel|Opening Ask/);
        assert.equal(fetches, 0);
      } finally {
        globalThis.fetch = realFetch;
      }
      ok("AskWorkspace server-renders the closed shell without a panel or a fetch");
    }

    const { AddEntry } = await import("@/components/household/AddEntry");
    const entry = renderToStaticMarkup(createElement(AddEntry, {
      ids: { bill: crypto.randomUUID(), charge: crypto.randomUUID() },
      returnTo: "/", today: "2026-11-14", currency: "JPY",
      people: [{ id: crypto.randomUUID(), name: "Ben" }],
      cards: [{ id: crypto.randomUUID(), label: "Fictional card" }],
    }));
    const entryForms = [...entry.matchAll(/<form\b[^>]*action="\/api\/(bills|charges)"[^>]*>([\s\S]*?)<\/form>/g)];
    assert.deepEqual(entryForms.map(([, kind]) => kind), ["bills", "charges"]);
    for (const [, kind, form] of entryForms) {
      const more = /<details\b[^>]*class="add-entry-more"[^>]*>/.exec(form);
      assert.ok(more, kind);
      assert.doesNotMatch(more[0], /\sopen(?:[\s=>])/);
      const visible = form.slice(0, more.index);
      assert.match(visible, /class="add-entry-guess-words">(?:One-off · )?Other<\/span>/, kind);
      assert.match(visible, /Guessed from the name, change if wrong/, kind);
      assert.equal((form.match(/Guessed from the name, change if wrong/g) ?? []).length, 1, kind);
    }
    ok("Add bill and Add charge show one category guess hint above the closed More details");

    const resetDemo = (await import("@/app/api/try/reset/route")).POST as Handler;
    cookie = await seedBen(db, { isDemo: true });
    const resetResult = await resetDemo(post("/api/try/reset", null, { "x-form-fetch": "1" }));
    assert.equal(resetResult.status, 204);
    assert.equal(resetResult.headers.get("x-form-redirect"), "/");
    assert.equal(resetResult.headers.get("location"), null);
    assert.match(resetResult.headers.get("set-cookie") ?? "", /household=[A-Za-z0-9_-]{43};/);
    ok("Try it Reset uses the fetch form redirect header and sets a fresh demo cookie");

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

    // ------------------------------------------------------------ /api/ask/view
    {
      const view = (await import("@/app/api/ask/view/route")).GET;
      const resolveCanvas = (await import("@/app/api/canvas/resolve/route")).POST;
      const getView = (id?: string, fetchSite = "same-origin") => {
        const url = new URL("/api/ask/view", ORIGIN);
        if (id !== undefined) url.searchParams.set("space", id);
        return view(new Request(url, { headers: { "sec-fetch-site": fetchSite } }));
      };
      const checkedView = async (id?: string): Promise<AskView> => {
        const response = await getView(id);
        assert.equal(response.status, 200);
        assert.equal(response.headers.get("cache-control"), "private, no-store");
        return response.json();
      };
      const viewHid = await seedBen(db, { isDemo: true });
      const viewGeneral = await generalSpace(db, viewHid);
      const project = await createSpace(db, viewHid, "Fictional Ask view project");
      const foreign = await generalSpace(db, b);
      const recipe = {
        version: 1 as const, title: "Fictional project recipe",
        blocks: [{ type: "note" as const, text: "Fictional project canvas note", by: "you" as const }],
      };
      const askTurn = {
        id: crypto.randomUUID(), conversationId: project.id, question: "Fictional project question", kind: "answer" as const,
        reply: "Fictional project answer", choices: null, recipe, sources: [],
      };
      await saveTurn(db, viewHid, askTurn);
      await saveBrief(db, viewHid, project.id, { about: "Fictional project brief" }, "form");
      const note = await addMemory(db, viewHid, { kind: "fact", text: "Fictional project note", spaceId: project.id }, { madeBy: "form" });
      const pin = await pinCanvas(db, viewHid, { spaceId: project.id, title: "Fictional project pin", recipe }, { madeBy: "form" });

      cookie = null;
      const unauthenticated = await getView(project.id);
      assert.deepEqual([unauthenticated.status, unauthenticated.headers.get("cache-control")], [401, "private, no-store"]);
      cookie = viewHid;
      const crossOrigin = await getView(project.id, "cross-site");
      assert.deepEqual([crossOrigin.status, crossOrigin.headers.get("cache-control")], [403, "private, no-store"]);
      for (const id of [foreign.id, crypto.randomUUID(), "not-a-uuid", ""]) {
        const response = await getView(id);
        assert.equal(response.status, 404, id);
        assert.equal(response.headers.get("cache-control"), "private, no-store");
      }
      assert.equal((await checkedView()).space.id, viewGeneral.id);
      const selected = await checkedView(project.id);
      assert.equal(selected.householdId, viewHid);
      assert.equal(selected.space.id, project.id);
      assert.deepEqual(selected.spaces.map(({ id }) => id).sort(), [viewGeneral.id, project.id].sort());
      assert.deepEqual(selected.turns.map(({ id }) => id), [askTurn.id]);
      assert.deepEqual(selected.pins.map(({ id }) => id), [pin.id]);
      assert.deepEqual(selected.cloudMemory.notes.map(({ id }) => id), [note.id]);
      assert.equal(selected.cloudBrief?.brief.about, "Fictional project brief");
      ok("/api/ask/view: no session is 401; cross-origin is 403; unknown, malformed and foreign space IDs are 404; own space and General are private and no-store");

      const { AskPage } = await import("@/components/ask/AskPage");
      const full = renderToStaticMarkup(createElement(AskPage, { ...selected, variant: "full" }));
      const panel = renderToStaticMarkup(createElement(AskPage, { ...selected, variant: "panel" }));
      assert.match(full, /class="ask-page"/);
      assert.match(panel, /class="ask-page is-panel"/);
      assert.doesNotMatch(full, />Open full</);
      const openFull = `<a class="ui-button ask-open-full" href="/canvas?space=${project.id}">Open full</a>`;
      assert.ok(panel.includes(openFull), "Open full points to the current space");
      for (const part of [askTurn.question, askTurn.reply, "Helpful", "Incognito", "Attach a bill", "Show the recipe", recipe.blocks[0].text]) {
        assert.ok(full.includes(part) && panel.includes(part), part);
      }
      assert.match(full, /href="#space-notes"/);
      assert.match(panel, /href="#ask-panel-space-notes"/);
      assert.equal(panel.replace(openFull, "").replace('class="ask-page is-panel"', 'class="ask-page"')
        .replace('<h2 class="ui-title">Ask</h2>', '<h1 class="ui-title">Ask</h1>').replace('id="ask-panel-question"', 'id="ask"')
        .replace(/((?:id|href|aria-labelledby)="#?)ask-panel-(?=(?:space-notes|memory-))/g, "$1"), full);
      ok("AskPage renders the same thread, composer and canvas in both layouts; the panel adds Open full for the current space");

      // Keep rows deliberately to prove the view obeys placement rather than returning an already empty cloud.
      await db.update(schema.households).set({ memoryPlace: "device", canvasPlace: "device", journalPlace: "device" })
        .where(eq(schema.households.id, viewHid));
      const device = await checkedView(project.id);
      assert.equal(device.space.id, project.id);
      assert.deepEqual(device.places, { memory: "device", canvases: "device", journal: "device" });
      assert.deepEqual(device.turns, []);
      assert.deepEqual(device.earlier, []);
      assert.deepEqual(device.pins, []);
      assert.deepEqual(device.cloudMemory, { notes: [], profileIds: [], totalCount: 0 });
      assert.equal(device.cloudBrief, null);
      assert.ok(!JSON.stringify(device).includes("Fictional project brief"));
      ok("/api/ask/view: device placement hides stored turns, briefs, pins and memory while keeping space metadata");

      await db.insert(schema.requestBuckets).values({ householdId: viewHid, purpose: "canvas", window: sql`date_trunc('minute', now())`, count: 119 })
        .onConflictDoUpdate({ target: [schema.requestBuckets.householdId, schema.requestBuckets.purpose],
          set: { window: sql`date_trunc('minute', now())`, count: 119 } });
      await checkedView(project.id);
      const limitedView = await getView(project.id);
      assert.deepEqual([limitedView.status, limitedView.headers.get("retry-after"), limitedView.headers.get("cache-control")],
        [429, "60", "private, no-store"]);
      assert.equal((await resolveCanvas(json("/api/canvas/resolve", {}))).status, 429, "both routes share the canvas bucket");
      cookie = b;
      assert.equal((await checkedView(foreign.id)).householdId, b, "another household has its own canvas bucket");
      ok("/api/ask/view and /api/canvas/resolve share the per-household canvas bucket of 120 a minute");
    }

    // ------------------------------------------------------------ /api/ask: body, input, limit
    cookie = a;
    const MAX = 128 * 1024;
    const pad = (size: number, device = false) => JSON.stringify({ ...question(), ...(device && { memory: [] }), pad: "x".repeat(size) });
    const encoded = (text: string) => new TextEncoder().encode(text).length;
    const room = MAX - encoded(pad(0));
    const atLimit = await say(await ask(json("/api/ask", pad(room))));
    assert.equal(encoded(pad(room)), MAX);
    assert.notEqual(atLimit.text, "That is more than one question can carry. Delete some of what the assistant remembers, or ask in a new space.", "exactly 128 KiB is not too big");
    await db.delete(schema.requestBuckets).where(eq(schema.requestBuckets.householdId, a));
    const over = await say(await ask(json("/api/ask", pad(room + 1))));
    assert.deepEqual([over.status, over.text], [400, "That is more than one question can carry. Delete some of what the assistant remembers, or ask in a new space."]);
    assert.equal(over.headers.get("cache-control"), "private, no-store");
    const multibyte = "あ".repeat(Math.ceil(MAX / 3) + 1); // few characters, over the limit in bytes
    assert.ok(multibyte.length < MAX && encoded(multibyte) > MAX);
    assert.equal((await ask(json("/api/ask", multibyte))).status, 400);
    assert.equal(await requestCount(db, a, "ask"), 0, "an oversize body spends no request");
    const deviceRoom = 512 * 1024 - encoded(pad(0, true));
    const deviceAtLimit = await say(await ask(json("/api/ask", pad(deviceRoom, true))));
    assert.match(deviceAtLimit.text, /keeps its memory in our cloud/, "a 512 KiB device request reaches placement validation");
    await db.delete(schema.requestBuckets).where(eq(schema.requestBuckets.householdId, a));
    const deviceOver = await say(await ask(json("/api/ask", pad(deviceRoom + 1, true))));
    assert.deepEqual([deviceOver.status, deviceOver.text], [400, over.text]);
    assert.equal(await requestCount(db, a, "ask"), 0, "an oversize device body spends no request");
    ok("/api/ask: ordinary and device caps are 128 and 512 KiB in bytes, and an oversize request spends no request");

    for (const [label, body] of [["not JSON", "{nope"], ["empty body", ""], ["JSON null", "null"], ["an array", "[]"], ["no id", JSON.stringify({ ...question(), id: undefined })],
      ["an id that is not a uuid", JSON.stringify(question({ id: "1" }))], ["blank text", JSON.stringify(question({ text: "   " }))], ["321 characters", JSON.stringify(question({ text: "a".repeat(321) }))],
      ["a source that is neither", JSON.stringify(question({ source: "telepathy" }))], ["a canvas that is not a recipe", JSON.stringify(question({ canvas: { blocks: "no" } }))],
      ["201 memory items", JSON.stringify(question({ memory: Array.from({ length: 201 }, () => ({})) }))], ["invalid recent turns", JSON.stringify(question({ recent: [{}, {}, {}, {}] }))]] as const) {
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
    asking = async () => { calls++; return { id: "x", kind: "answer", text: "fine", choices: null, canvas: null, sources: [], links: [], pending: false, firstUse: null, memoryChanges: [], offers: [] }; };
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
    assert.deepEqual([(await streamed(fine)).text], ["fine"]);
    asking = null;
    ok("/api/ask: 30 questions a minute, the 31st is 429 'Ask again in a minute.' with Retry-After 60; per household; a success is JSON, no-store");

    // ------------------------------------------------------------ /api/ask: error mapping
    await db.delete(schema.requestBuckets).where(eq(schema.requestBuckets.householdId, a));
    const FIXED = "Couldn't answer right now. Try again.";
    const failing = async (error: unknown) => {
      asking = async () => { throw error; };
      const response = await ask(json("/api/ask", question()));
      // An InputError before any step is the plain 400; anything else is an error line in the stream (an InputError after a step is tested below).
      return response.status === 400 ? say(response) : streamed(response);
    };
    const mapped = async (error: unknown, expected: [number, string]) => {
      const answer = await failing(error);
      assert.deepEqual([answer.status, answer.text], expected, String(error));
      assert.equal(answer.headers.get("cache-control"), "private, no-store");
      return answer;
    };
    await mapped(new InputError("Reload the page and ask again."), [400, "Reload the page and ask again."]);
    await mapped(new AgentError("The assistant took too long."), [200, "The assistant took too long."]);
    await mapped(new AiKeyError("That key was not accepted."), [200, "That key was not accepted."]);
    await mapped(new MissingAuthSetting("SUPABASE_URL is not set"), [200, "SUPABASE_URL is not set"]);
    // A server with some AI_ setting names the missing one; a server with none (the deployed setup) points to the household's own key.
    const aiNames = ["AI_PROTOCOL", "AI_BASE_URL", "AI_API_KEY", "AI_TEXT_MODEL", "AI_DOCUMENT_MODEL"] as const;
    const savedAi = Object.fromEntries(aiNames.map(name => [name, process.env[name]]));
    try {
      for (const name of aiNames) delete process.env[name];
      process.env.AI_DOCUMENT_MODEL = "fixture-document";
      for (const name of ["AI_TEXT_MODEL", "AI_PROTOCOL", "AI_BASE_URL", "AI_API_KEY"]) {
        for (const Kind of [AgentError, AiKeyError, MissingAuthSetting]) await mapped(new Kind(`${name} is not set`), [200, askUnavailable(name)]);
      }
      delete process.env.AI_DOCUMENT_MODEL;
      for (const Kind of [AgentError, AiKeyError, MissingAuthSetting]) await mapped(new Kind("AI_TEXT_MODEL is not set"), [200, NEEDS_KEY]);
    } finally {
      for (const name of aiNames) if (savedAi[name] === undefined) delete process.env[name]; else process.env[name] = savedAi[name];
    }
    // an unknown-named or longer message is not rewritten; only exactly `AI_X is not set` is
    await mapped(new AgentError("AI_TEXT_MODEL is not set, sorry"), [200, "AI_TEXT_MODEL is not set, sorry"]);
    await mapped(new AgentError("ai_text_model is not set"), [200, "ai_text_model is not set"]);
    // anything else, including an Error whose text names a secret or a setting, is the fixed sentence
    for (const error of [new Error("AI_TEXT_MODEL is not set"), new Error("connect ECONNREFUSED 10.0.0.1:5432 password=fictional-secret"), new TypeError("x is not a function"), "a string", null, { message: "AI_TEXT_MODEL is not set" }]) {
      const answer = await mapped(error, [200, FIXED]);
      assert.ok(!answer.text.includes("secret") && !answer.text.includes("ECONNREFUSED"), "the error's own text never reaches the person");
    }
    asking = null;
    ok("/api/ask errors: InputError 400 with its message; AgentError, AiKeyError, MissingAuthSetting an error line with theirs; 'AI_X is not set' becomes askUnavailable(X); anything else an error line with the fixed sentence only");

    // the real answerQuestion behind the route: a household that keeps its memory on the device is refused a question without it, as 400
    await db.delete(schema.requestBuckets).where(eq(schema.requestBuckets.householdId, b));
    cookie = b;
    const mismatch = await say(await ask(json("/api/ask", question({ memory: [] }))));
    assert.deepEqual([mismatch.status, mismatch.text], [400, "This household keeps its memory in our cloud. Reload the page and ask again."]);
    // and with no AI setting on this server (the deployed setup) the real agent path points to the household's own key (never a key)
    for (const key of Object.keys(process.env)) if (key.startsWith("AI_")) delete process.env[key];
    const unset = await streamed(await ask(json("/api/ask", question())));
    assert.deepEqual([unset.status, unset.text], [200, NEEDS_KEY], "the real path points to the household's own key");
    Object.assign(process.env, savedEnv);
    ok("/api/ask, real answerQuestion: a memory/place mismatch is 400 with its sentence; no AI settings is an error line with words");

    // The guarded QA clock calls the real in-app suggestion pass in PGlite.
    {
      const advance = (await import("@/app/api/try/date/route")).POST as Handler;
      const path = "/api/try/date";
      const dateForm = (date: string) => new URLSearchParams({ date });
      const beforeFlag = process.env.NEXT_PUBLIC_QA_TOOLS;
      const fixture = await seedBen(db, { isDemo: true });
      const blank = await seedBen(db, { isDemo: true });
      await db.update(schema.households).set({ fixedToday: null }).where(eq(schema.households.id, blank));
      try {
        cookie = fixture;
        delete process.env.NEXT_PUBLIC_QA_TOOLS;
        assert.equal((await advance(post(path, dateForm("2026-11-15")))).status, 404);
        process.env.NEXT_PUBLIC_QA_TOOLS = "1";
        assert.equal((await advance(post(path, dateForm("2026-11-15"), { origin: "http://evil.example" }))).status, 403);
        cookie = null;
        assert.equal((await advance(post(path, dateForm("2026-11-15")))).status, 401);
        cookie = blank;
        assert.equal((await advance(post(path, dateForm("2026-11-15")))).status, 403);
        cookie = fixture;
        assert.equal((await advance(post(path, dateForm("2026-02-30")))).status, 400);
        const moved = await advance(post(path, dateForm("2026-11-15")));
        assert.equal(moved.status, 200);
        assert.equal(moved.headers.get("cache-control"), "private, no-store");
        assert.deepEqual(await moved.json(), { today: "2026-11-15" });
        const [household] = await db.select({ today: schema.households.fixedToday }).from(schema.households)
          .where(eq(schema.households.id, fixture));
        assert.equal(household.today, "2026-11-15");
        const findings = await db.select().from(schema.suggestions).where(eq(schema.suggestions.householdId, fixture));
        assert.ok(findings.some(row => row.title === "CloudBox Plus due Nov 18" && row.createdOn === "2026-11-15"
          && row.reason.startsWith("¥1,980,")), "a new finding uses the advanced date");
        assert.equal((await advance(post(path, dateForm("2026-11-15")))).status, 400);
        assert.equal((await advance(post(path, dateForm("2026-11-14")))).status, 400);
        await db.delete(schema.standingRules).where(and(eq(schema.standingRules.householdId, fixture),
          eq(schema.standingRules.kind, "bill_ahead")));
        const multipart = new FormData();
        multipart.set("date", "2026-11-16");
        assert.equal((await advance(post(path, multipart))).status, 503, "a failed pass refuses the date change");
        const [after] = await db.select({ today: schema.households.fixedToday }).from(schema.households)
          .where(eq(schema.households.id, fixture));
        assert.equal(after.today, "2026-11-15", "the failed pass and rejected dates leave the clock unchanged");
      } finally {
        if (beforeFlag === undefined) delete process.env.NEXT_PUBLIC_QA_TOOLS;
        else process.env.NEXT_PUBLIC_QA_TOOLS = beforeFlag;
      }
    }
    ok("the guarded QA date route advances only Try it, runs suggestions on the new date and rolls back a failed pass");

    // Stage 32D. Real route and runner, simulated Anthropic responses only.
    const privateHid = await seedBen(db, { isDemo: true });
    cookie = privateHid;
    const general = await generalSpace(db, privateHid);
    await saveBrief(db, privateHid, general.id, { about: "Fictional existing brief" }, "form");
    await addMemory(db, privateHid, { kind: "fact", text: "Fictional existing profile" }, { madeBy: "form" });
    await saveTurn(db, privateHid, { id: crypto.randomUUID(), conversationId: general.id, question: "Older fictional question", kind: "answer",
      reply: "Older fictional answer", choices: null, recipe: null, sources: [] });
    Object.assign(process.env, { AI_PROTOCOL: "anthropic", AI_API_KEY: "fictional-test-key", AI_TEXT_MODEL: "fixture" });
    delete process.env.AI_BASE_URL;
    const modelReply = (reason: string, content: unknown[]) => Response.json({ id: "fixture", type: "message", role: "assistant",
      model: "fixture", stop_reason: reason, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 }, content });
    const call = (name: string, input: unknown) => ({ type: "tool_use", id: `tool_${name}`, name, input });
    const scripted = (make: (index: number, body: { system: string; tools: { name: string }[]; messages: unknown[] }) => Response) => {
      let count = 0;
      const fetch: typeof globalThis.fetch = async (input, init) => make(count++, await new Request(input, init).json());
      asking = (...args) => {
        const [dbArg, hid, data, deps] = args as Parameters<typeof realAnswerQuestion>;
        return realAnswerQuestion(dbArg, hid, data, { ...deps, fetch });
      };
      return () => count;
    };
    const privateCalls = scripted((index, body) => {
      if (index === 0) {
        const names = body.tools.map(tool => tool.name);
        assert.ok(names.includes("where_am_i") && names.includes("search_history"));
        for (const forbidden of ["update_brief", "remember", "forget", "log_charge", "draft_invoice", "open_space", "offer_keep"]) assert.ok(!names.includes(forbidden));
        assert.ok(body.system.includes("Fictional existing brief") && body.system.includes("Fictional existing profile"));
        assert.ok(JSON.stringify(body.messages).includes("Older fictional question"));
        return modelReply("tool_use", [
          call("where_am_i", {}), call("remember", { kind: "fact", text: "Incognito note" }),
          call("update_brief", { about: "Incognito brief" }), call("open_space", { name: "Incognito space" }), call("log_charge", {}),
        ]);
      }
      const messages = JSON.stringify(body.messages);
      assert.equal((messages.match(/This tool is unavailable in Incognito/g) ?? []).length, 4);
      return modelReply("end_turn", [{ type: "text", text: "I checked the forecast." }]);
    });
    const privateQuestion = question({ conversationId: general.id, spaceId: general.id, text: "Remember that after checking.", incognito: true });
    const privateReply = (await streamed(await ask(json("/api/ask", privateQuestion)))).last.reply!;
    assert.equal(privateReply.incognito, true);
    assert.equal(privateReply.text, "I checked the forecast.");
    assert.deepEqual(privateReply.memoryChanges, []);
    assert.deepEqual(privateReply.offers, []);
    assert.equal(privateReply.brief, undefined);
    assert.equal(privateReply.openSpace, undefined);
    assert.equal((await allTurns(db, privateHid)).length, 1);
    assert.equal((await listMemory(db, privateHid)).length, 1);
    assert.equal((await listSpaces(db, privateHid)).length, 1);
    assert.equal((await generalSpace(db, privateHid)).brief.about, "Fictional existing brief");
    const [privateKey] = await db.select().from(schema.askReceipts)
      .where(and(eq(schema.askReceipts.householdId, privateHid), eq(schema.askReceipts.askId, privateQuestion.id)));
    assert.deepEqual({ askId: privateKey.askId, pending: privateKey.pending, links: privateKey.links }, { askId: privateQuestion.id, pending: false, links: [] });
    const retried = await streamed(await ask(json("/api/ask", privateQuestion)));
    assert.equal(retried.text, "This Incognito question already ran. Its reply was not saved.");
    assert.equal(privateCalls(), 2, "retry made no further model call");
    assert.equal((await ask(json("/api/ask", { ...privateQuestion, incognito: false }))).status, 400);
    ok("Incognito reads the existing context, refuses even forced writes, and stores only the retry key");

    for (const fail of ["model", "amount"]) {
      const input = { ...privateQuestion, id: crypto.randomUUID() };
      scripted(index => {
        if (fail === "model") return new Response(null, { status: 500 });
        if (index === 0) return modelReply("tool_use", [call("where_am_i", {})]);
        return modelReply("end_turn", [{ type: "text", text: "You have ¥888,888." }]);
      });
      const failure = (await streamed(await ask(json("/api/ask", input)))).last;
      assert.ok(failure.error);
      if (fail === "amount") assert.match(failure.error, /could not confirm/);
      const receipts = () => db.select().from(schema.askReceipts)
        .where(and(eq(schema.askReceipts.householdId, privateHid), eq(schema.askReceipts.askId, input.id)));
      assert.deepEqual(await receipts(), [], `${fail}: a failed run releases its claim`);
      const calls = scripted(index => index === 0
        ? modelReply("tool_use", [call("where_am_i", {})])
        : modelReply("end_turn", [{ type: "text", text: "I checked again." }]));
      const retry = (await streamed(await ask(json("/api/ask", input)))).last.reply!;
      assert.equal(retry.text, "I checked again.");
      assert.equal(retry.incognito, true);
      assert.equal(calls(), 2);
      assert.equal((await receipts()).length, 1);
      assert.equal((await allTurns(db, privateHid)).length, 1);
    }
    ok("failed Incognito runs release the receipt so the same id can run again without saving a turn");

    const localHid = await seedBen(db, { isDemo: true });
    const localGeneral = await generalSpace(db, localHid);
    await db.update(schema.households).set({ memoryPlace: "device", journalPlace: "device" }).where(eq(schema.households.id, localHid));
    cookie = localHid;
    scripted((index, body) => {
      if (index === 0) {
        assert.ok(body.system.includes("Fictional local brief"));
        return modelReply("tool_use", [call("where_am_i", {})]);
      }
      return modelReply("end_turn", [{ type: "text", text: "Your forecast is here." }]);
    });
    const localInput = question({ conversationId: localGeneral.id, spaceId: localGeneral.id,
      incognito: true, recent: [], memory: [], deviceBrief: { about: "Fictional local brief" } });
    const localPrivate = (await streamed(await ask(json("/api/ask", localInput)))).last.reply!;
    assert.equal(localPrivate.incognito, true);
    assert.equal(localPrivate.brief, undefined);
    assert.deepEqual(await allTurns(db, localHid), []);
    assert.deepEqual((await generalSpace(db, localHid)).brief, {});
    ok("Incognito can read a device brief without returning a change or saving a cloud turn");

    cookie = privateHid;
    const proposalCalls = scripted((index, body) => {
      if (index === 0) return modelReply("tool_use", [call("list_spaces", {}), call("open_space", { name: "Fictional November work" })]);
      assert.ok(JSON.stringify(body.messages).includes("General"));
      return modelReply("end_turn", [{ type: "text", text: "This can have its own space." }]);
    });
    const proposeInput = question({ conversationId: general.id, spaceId: general.id, text: "Help me plan the November work." });
    const proposal = (await streamed(await ask(json("/api/ask", proposeInput)))).last.reply!;
    assert.deepEqual(proposal.openSpace, { name: "Fictional November work" });
    assert.equal((await listSpaces(db, privateHid)).length, 1, "the proposal did not create the space");
    assert.equal((await streamed(await ask(json("/api/ask", proposeInput)))).last.reply?.openSpace, undefined, "the proposal is transient");
    assert.equal(proposalCalls(), 2);
    const spacesRoute = (await import("@/app/api/spaces/route")).POST;
    const create = new FormData();
    create.set("kind", "create");
    create.set("name", proposal.openSpace!.name);
    const opened = await spacesRoute(post("/api/spaces", create));
    assert.equal(opened.status, 303);
    assert.equal((await listSpaces(db, privateHid)).length, 2);
    assert.ok(opened.headers.get("location")?.includes("/canvas?space="));
    const other = await createSpace(db, b, "Fictional foreign space");
    assert.equal((await ask(json("/api/ask", question({ spaceId: other.id, conversationId: other.id })))).status, 400);
    ok("Ask proposes a space without creating it; only the guarded Open space form creates it");

    const openedSpaceLocation = opened.headers.get("location")!;
    const openedSpaceId = new URL(openedSpaceLocation, ORIGIN).searchParams.get("space")!;
    const briefForm = new FormData();
    briefForm.set("kind", "brief");
    briefForm.set("id", openedSpaceId);
    briefForm.set("about", "  Check the March paperwork  ");
    briefForm.set("state", "timeline | Check the next statement");
    const briefRequest = post("/api/spaces", briefForm);
    briefRequest.headers.set(FORM_FETCH_HEADER, "1");
    const confirmedBrief = await spacesRoute(briefRequest);
    assert.equal(confirmedBrief.status, 200);
    assert.equal(confirmedBrief.headers.get(FORM_REDIRECT_HEADER), openedSpaceLocation);
    assert.equal(confirmedBrief.headers.get("cache-control"), "private, no-store");
    const savedBriefRecord = await confirmedBrief.json();
    const savedBriefRow = (await listSpaces(db, privateHid)).find(row => row.id === openedSpaceId)!;
    assert.equal(savedBriefRecord.brief.about, "Check the March paperwork");
    assert.deepEqual(savedBriefRecord, { brief: savedBriefRow.brief, updatedAt: savedBriefRow.briefUpdatedAt?.toISOString(), updatedBy: "form" });
    briefForm.set("state", "A line with no source");
    const refusedBrief = post("/api/spaces", briefForm);
    refusedBrief.headers.set(FORM_FETCH_HEADER, "1");
    assert.equal((await spacesRoute(refusedBrief)).status, 400);
    assert.deepEqual((await listSpaces(db, privateHid)).find(row => row.id === openedSpaceId)?.brief, savedBriefRow.brief);
    ok("a brief save returns the committed fields and timestamp to the editor; a refused edit keeps the saved brief");

    asking = null;
    for (const key of ["AI_PROTOCOL", "AI_API_KEY", "AI_TEXT_MODEL", "AI_BASE_URL"]) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }

    // the stream: steps in order, then the reply; a failure after steps is an error line; an InputError after a step is an error line, before one a plain 400
    await db.delete(schema.requestBuckets).where(eq(schema.requestBuckets.householdId, a));
    cookie = a;
    const replyObject = { id: "x", kind: "answer", text: "fine", choices: null, canvas: null, sources: [], links: [], pending: false, firstUse: null, memoryChanges: [], offers: [] };
    type Deps = { onStep?: (step: string) => void };
    asking = async (...args: unknown[]) => { const deps = args[3] as Deps; deps.onStep!("Thinking about your question"); await new Promise(resolve => setTimeout(resolve, 5)); deps.onStep!("Reading what's due"); return replyObject; };
    const ok1 = await streamed(await ask(json("/api/ask", question())));
    assert.deepEqual(ok1.steps, ["Thinking about your question", "Reading what's due"]);
    assert.deepEqual(ok1.last, { reply: replyObject }, "the last line is exactly the reply object");
    asking = async (...args: unknown[]) => { (args[3] as Deps).onStep!("Thinking about your question"); throw new AgentError("That took too long. Try a simpler question."); };
    const bad = await streamed(await ask(json("/api/ask", question())));
    assert.deepEqual([bad.steps, bad.last], [["Thinking about your question"], { error: "That took too long. Try a simpler question." }]);
    asking = async (...args: unknown[]) => { (args[3] as Deps).onStep!("Thinking about your question"); throw new InputError("Reload the page and ask again."); };
    const late = await streamed(await ask(json("/api/ask", question())));
    assert.deepEqual(late.last, { error: "Reload the page and ask again." }, "an InputError after the stream started is an error line");
    asking = async () => replyObject; // a reply with no model call (a kept turn) is still a stream
    assert.deepEqual((await streamed(await ask(json("/api/ask", question())))).steps, []);
    asking = null;
    ok("/api/ask stream: step lines then the exact reply; an error line after steps; InputError after a step is an error line; no steps still streams the reply");

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
    const names = ["AI_TEXT_MODEL", "AI_PROTOCOL", "AI_BASE_URL", "AI_API_KEY"];
    const set = (values: Record<string, string | undefined>) => { for (const n of names) delete process.env[n]; for (const [k, v] of Object.entries(values)) if (v !== undefined) process.env[k] = v; };
    const full = { AI_TEXT_MODEL: "m", AI_PROTOCOL: "openai", AI_BASE_URL: "https://models.example/v1", AI_API_KEY: "k" };
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
    set({ ...full, AI_TEXT_MODEL: undefined, AI_PROTOCOL: undefined, AI_API_KEY: undefined }); assert.equal(missingAskSetting(false), "AI_TEXT_MODEL", "the first missing one in order");
    set({ ...full, AI_PROTOCOL: undefined, AI_BASE_URL: undefined }); assert.equal(missingAskSetting(false), "AI_PROTOCOL");
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

    const { UploadLines } = await import("@/components/reader/UploadForm");
    const uploadLines = renderToStaticMarkup(createElement(UploadLines, { lines: [
      { name: "Fictional receipt.png", result: "sent" },
      { name: "Fictional note.txt", result: "Select a PDF, JPEG, PNG or WebP file.", refused: true },
      { name: "Fictional invoice.pdf", result: "waiting" },
    ] }));
    const announcements = [...uploadLines.matchAll(/<li\b[^>]*><span role="(alert|status)">([^<]+)<\/span><\/li>/g)];
    assert.deepEqual(announcements.map(([, role, content]) => [role, content]), [
      ["status", "Fictional receipt.png — sent"],
      ["alert", "Fictional note.txt — Select a PDF, JPEG, PNG or WebP file."],
      ["status", "Fictional invoice.pdf — waiting"],
    ]);
    assert.doesNotMatch(uploadLines, /\baria-live=/, "the list does not announce the per-file messages again");
    ok("Upload announces refused files as alerts and other files as individual statuses");

    // ------------------------------------------------------------ status codes: the person's file is 400, the server's side is 502 or 503
    const upload = (await import("@/app/api/upload/route")).POST as Handler;
    const attach = (await import("@/app/api/ask/document/route")).POST as Handler;
    const inbound = (await import("@/app/api/inbound/route")).POST as Handler;
    const docs = async () => (await db.select().from(schema.documents)).length;
    const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
    const file = (data: BlobPart, name: string, type: string) => { const fd = new FormData(); fd.set("document", new File([data], name, { type })); fd.set("id", crypto.randomUUID()); fd.set("conversationId", crypto.randomUUID()); return fd; };
    const reset = async () => { await db.delete(schema.requestBuckets); };
    const errors: string[] = [];
    const realError = console.error;
    console.error = (...args: unknown[]) => { errors.push(args.map(String).join(" ")); };
    const envNames = ["AI_TEXT_MODEL", "AI_PROTOCOL", "AI_BASE_URL", "AI_API_KEY", "SUPABASE_URL", "INBOUND_WORKER_SECRET", "FORWARDING_DOMAIN", "INBOUND_ADDRESS_KEY"];
    const env = (values: Record<string, string | undefined>) => { for (const n of envNames) delete process.env[n]; for (const [k, v] of Object.entries(values)) if (v !== undefined) process.env[k] = v; };
    try {
      cookie = a;
      const modelSet = { AI_TEXT_MODEL: "m", AI_PROTOCOL: "openai", AI_BASE_URL: "https://models.example/v1", AI_API_KEY: "fictional-test-value" };
      for (const [name, route, path] of [["upload", upload, "/api/upload"], ["ask attach", attach, "/api/ask/document"]] as const) {
        env({}); await reset();
        const noFile = await say(await route(post(path, new URLSearchParams())));
        assert.deepEqual([noFile.status, noFile.text], [400, "Select a file to upload."], `${name}: a non-multipart request is 400 even without a model`);
        const bad = await say(await route(post(path, file("hello", "a.txt", "text/plain"))));
        assert.deepEqual([bad.status, bad.text], [400, "Select a PDF, JPEG, PNG or WebP file."], `${name}: a wrong file type is 400`);
        await reset();
        const mismatch = await say(await route(post(path, file("hello", "a.png", "image/png"))));
        assert.deepEqual([mismatch.status, mismatch.text], [400, "File contents do not match the selected file type."], `${name}: contents that do not match are 400`);
        await reset();
        const big = await say(await route(post(path, file(new Uint8Array(6 * 1024 * 1024 + 9000), "big.png", "image/png"))));
        assert.deepEqual([big.status, big.text], [400, "Document exceeds the 6 MiB limit."], `${name}: too big is 400`);
        env({}); await reset();
        const noModel = await say(await route(post(path, file(PNG, "a.png", "image/png"))));
        assert.deepEqual([noModel.status, noModel.text], [503, "Reading documents needs an AI key in Settings → Your AI model."], `${name}: with no model on this server, 503 points to the household's own key`);
        env(modelSet);
        const badWithModel = await say(await route(post(path, file("hello", "a.txt", "text/plain"))));
        assert.deepEqual([badWithModel.status, badWithModel.text], [400, bad.text], `${name}: bad-file refusal is the same when a model is configured`);
        env({ ...modelSet, AI_API_KEY: undefined }); await reset();
        assert.match((await say(await route(post(path, file(PNG, "a.png", "image/png"))))).text, /\(AI_API_KEY\)/, `${name}: a missing key is named`);
        env(modelSet); await reset();
        const noStorage = await say(await route(post(path, file(PNG, "a.png", "image/png"))));
        assert.deepEqual([noStorage.status, noStorage.text], [503, "SUPABASE_URL is not set"], `${name}: a setting the reader needs is 503 naming it`);
      }
      const failing = (code: number) => (async () => new Response("{}", { status: code })) as typeof fetch;
      const statusOf = async (fetchImpl: typeof fetch | undefined, over: Record<string, unknown> = {}) => {
        try { await extractDocument(PNG.buffer as ArrayBuffer, "image/png", context, async () => ({ ...connection, ...over }), fetchImpl); return null; }
        catch (e) { return e instanceof ReaderError ? [e.status, e.message] : String(e); }
      };
      assert.deepEqual(await statusOf(failing(500)), [502, "AI reader returned HTTP 500."]);
      assert.deepEqual(await statusOf((async () => { throw new TypeError("network"); }) as typeof fetch), [502, "AI reader could not be reached."]);
      assert.deepEqual(await statusOf(undefined, { documentModel: null }), [503, "AI_DOCUMENT_MODEL is not set"]);
      await reset();
      ok("/api/upload and /api/ask/document: a bad, mismatched or oversize file is 400; no model is 503 naming the setting; a missing reader setting is 503; the model failing or unreachable is 502 (extractDocument)");

      // /api/inbound: a caller without the origin or the secret is 403 and never learns more; a server without its settings is 503 with no body and one log line
      const mail = (headers: Record<string, string>) => new Request(`${ORIGIN}/api/inbound`, { method: "POST", body: "From: s@example.invalid\r\n\r\nhi", headers });
      const empty = async (response: Response) => [response.status, await response.text()];
      const docsBefore = await docs();
      env({ INBOUND_WORKER_SECRET: "fictional-secret" }); errors.length = 0;
      assert.deepEqual(await empty(await inbound(mail({}))), [403, ""], "no origin");
      assert.deepEqual(await empty(await inbound(mail({ origin: "https://elsewhere.example", authorization: "Bearer fictional-secret" }))), [403, ""], "another origin");
      assert.deepEqual(await empty(await inbound(mail({ origin: "https://worker.internal" }))), [403, ""], "no secret");
      assert.deepEqual(await empty(await inbound(mail({ origin: "https://worker.internal", authorization: "Bearer wrong-secret" }))), [403, ""], "a wrong secret of another length");
      assert.deepEqual(await empty(await inbound(mail({ origin: "https://worker.internal", authorization: "Bearer fictional-secreT" }))), [403, ""], "a wrong secret of the same length");
      assert.deepEqual(errors, [], "a refused caller leaves nothing in the log");
      env({}); errors.length = 0;
      assert.deepEqual(await empty(await inbound(mail({ origin: "https://worker.internal", authorization: "Bearer anything" }))), [503, ""], "no secret set: 503, no body");
      assert.deepEqual(errors, ["/api/inbound: INBOUND_WORKER_SECRET is not set"], "one line naming the variable, never a value");
      assert.deepEqual(await empty(await inbound(mail({}))), [403, ""], "no origin is still 403 when the setting is missing");
      env({ INBOUND_WORKER_SECRET: "fictional-secret" }); errors.length = 0;
      const noDomain = await inbound(mail({ origin: "https://worker.internal", authorization: "Bearer fictional-secret", "x-envelope-to": "x@example.invalid" }));
      assert.equal(noDomain.status, 503, "a later setting missing is 503 too");
      assert.equal(errors.length, 1);
      assert.match(errors[0], /^\/api\/inbound: [A-Z_]+ is not set$/, "the log line names a variable");
      assert.equal(await docs(), docsBefore, "nothing stored in any case");
      assert.equal((await db.select().from(schema.requestBuckets)).length, 0, "no limit counted for a refused or failed call");
      ok("/api/inbound: no origin or a wrong secret is 403 with no body (even when the server lacks the setting); a missing setting is 503 with no body and one log line naming the variable; nothing is stored");
    } finally {
      console.error = realError;
    }
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
