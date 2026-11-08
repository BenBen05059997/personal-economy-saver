// The model layer (D56): the address rule, the amount check and callModel's mapping in and out, for both protocols,
// over fake transports; and the assistant evaluation's graders (D60) against a scripted model. PGlite only for the graders;
// no network, no credentials.
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "@/db/schema";
import { householdDate } from "@/db/account";
import { loadMoneyState } from "@/db/household";
import { foreignCosts } from "@/db/fx-cost";
import { group } from "@/lib/money/format";
import { seedBen } from "@/db/seed";
import { AGENT_CASES, CASE_NAMES, gradeOutcome, runEval, scriptedModel, type Outcome } from "./model-eval-cases";
import { callModel } from "@/lib/ai/call";
import { checkConnection } from "@/lib/ai/check";
import { isTested, TESTED } from "@/lib/ai/tested";
import { fakeModel, type FakeMode } from "./ai-fake";
import { checkBaseUrl, localAllowed } from "@/lib/ai/endpoint";
import { unconfirmedAmounts } from "@/lib/ai/number-check";
import { PROVIDERS, tokenParamFor } from "@/lib/ai/providers";
import { ModelError, type Connection, type ModelRequest } from "@/lib/ai/types";

let passed = 0;
async function check(name: string, run: () => void | Promise<void>) { await run(); passed++; console.log(`✓ ${name}`); }

const SECRET = "fictional-key-" + "z".repeat(24);
const anthropic: Connection = { protocol: "anthropic", baseUrl: "https://api.anthropic.com", key: SECRET, textModel: "m-text", documentModel: "m-doc", own: true };
const openai: Connection = { protocol: "openai", baseUrl: "https://llm.example/v1", key: SECRET, textModel: "m-text", documentModel: "m-doc", own: false };
const APP = new URL("https://app.example");
const TOOLS = [{ name: "look", description: "Look something up.", schema: { type: "object", additionalProperties: false, required: ["what"], properties: { what: { type: "string" } } } }];
const REQUEST: Omit<ModelRequest, "connection" | "fetch"> = { model: "m-text", system: "SYSTEM", turns: [{ role: "user", parts: [{ type: "text", text: "hello" }] }], maxTokens: 777, timeoutMs: 5000, appUrl: APP };

type Seen = { url: URL; init: RequestInit; body: Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
function fake(respond: (seen: Seen) => Response | Promise<Response>) {
  const seen: Seen[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    const entry = { url: new URL(request.url), init: init ?? {}, body: await request.clone().json() };
    entry.init = { ...entry.init, headers: Object.fromEntries(request.headers) };
    seen.push(entry);
    return respond(entry);
  }) as typeof globalThis.fetch;
  return { fetch, seen };
}
const message = (stop_reason: string, content: unknown[], usage = { input_tokens: 11, output_tokens: 22 }) => Response.json({
  id: "msg_1", type: "message", role: "assistant", model: "m-text", content, stop_reason, stop_sequence: null, usage });
const chat = (finish_reason: string, msg: Record<string, unknown>, usage: unknown = { prompt_tokens: 5, completion_tokens: 6, total_tokens: 11 }) => Response.json({
  id: "c1", object: "chat.completion", created: 1, model: "m-text", choices: [{ index: 0, finish_reason, message: { role: "assistant", ...msg } }], usage });

async function main() {
  await check("checkBaseUrl accepts a public https address and removes a trailing slash", () => {
    assert.equal(checkBaseUrl("https://api.openai.com/v1", { allowLocal: false }), "https://api.openai.com/v1");
    assert.equal(checkBaseUrl(" https://llm.example/v1/ ", { allowLocal: false }), "https://llm.example/v1");
    assert.equal(checkBaseUrl("https://8.8.8.8/v1", { allowLocal: false }), "https://8.8.8.8/v1");
  });

  await check("checkBaseUrl rejects http, credentials, query, localhost, private, link-local, CGNAT, v6 and internal names", () => {
    const bad = [
      "http://llm.example/v1", "ftp://llm.example", "llm.example/v1", "", "not a url",
      "https://user:pass@llm.example/v1", "https://user@llm.example/v1", "https://llm.example/v1?key=1", "https://llm.example/v1#x",
      "https://localhost/v1", "https://LOCALHOST/v1", "https://127.0.0.1/v1", "https://0.0.0.0/v1", "https://10.0.0.5/v1", "https://172.16.0.1/v1", "https://172.31.255.255/v1",
      "https://192.168.1.10/v1", "https://169.254.169.254/v1", "https://100.64.0.1/v1", "https://100.127.255.255/v1", "https://224.0.0.1/v1",
      "https://[::1]/v1", "https://[::]/v1", "https://[fc00::1]/v1", "https://[fd12:3456::1]/v1", "https://[fe80::1]/v1", "https://[::ffff:10.0.0.1]/v1",
      "https://[::ffff:127.0.0.1]/v1", "https://metadata.internal/v1", "https://printer.local/v1", "https://box.localhost/v1",
      "https://localhost./v1", "https://foo.internal./v1", "https://127.0.0.1./v1", "https://printer.local./v1",
      "https://[::127.0.0.1]/v1", "https://[::7f00:1]/v1", "https://[::10.0.0.1]/v1", "https://[::169.254.169.254]/v1",
      "https://[64:ff9b::7f00:1]/v1", "https://[64:ff9b::8.8.8.8]/v1", "https://[2002:7f00:1::1]/v1", "https://[2002::1]/v1",
      "https://[fec0::1]/v1", "https://[feff::1]/v1", "https://[::ffff:169.254.169.254]/v1", "https://[::ffff:a9fe:a9fe]/v1", "https://[ff02::1]/v1",
    ];
    for (const address of bad) assert.throws(() => checkBaseUrl(address, { allowLocal: false }), /That address can't be used/, address);
    // not private: just outside the ranges
    for (const ok of ["https://172.15.0.1/v1", "https://172.32.0.1/v1", "https://100.63.0.1/v1", "https://100.128.0.1/v1", "https://169.253.0.1/v1", "https://192.169.0.1/v1"]) {
      assert.equal(checkBaseUrl(ok, { allowLocal: false }), ok);
    }
  });

  await check("http localhost is allowed only with allowLocal, and only for the local names", () => {
    assert.equal(checkBaseUrl("http://localhost:11434/v1", { allowLocal: true }), "http://localhost:11434/v1");
    assert.equal(checkBaseUrl("http://127.0.0.1:1234/v1", { allowLocal: true }), "http://127.0.0.1:1234/v1");
    assert.equal(checkBaseUrl("http://[::1]:8000/v1", { allowLocal: true }), "http://[::1]:8000/v1");
    assert.throws(() => checkBaseUrl("http://localhost:11434/v1", { allowLocal: false }), /https/);
    assert.throws(() => checkBaseUrl("http://10.0.0.5/v1", { allowLocal: true }), /https/, "a private address over http is refused even for a local app");
    assert.throws(() => checkBaseUrl("http://llm.example/v1", { allowLocal: true }), /https/);
    assert.throws(() => checkBaseUrl("https://10.0.0.5/v1", { allowLocal: true }), /private network/, "private ranges stay refused over https");
    assert.equal(localAllowed(new URL("http://127.0.0.1:3123")), true);
    assert.equal(localAllowed(new URL("http://localhost:8787")), true);
    assert.equal(localAllowed(new URL("http://dev.localhost:3000")), true);
    assert.equal(localAllowed(new URL("https://app.example")), false);
  });

  await check("unconfirmedAmounts: amounts in the question or a tool result pass; an invented one is named", () => {
    assert.deepEqual(unconfirmedAmounts("You are fine.", []), [], "no amount, nothing to confirm");
    assert.deepEqual(unconfirmedAmounts("¥18,780 short.", ["short by 18780"]), []);
    assert.deepEqual(unconfirmedAmounts("¥18,780 short.", ["short by 18,780"]), []);
    assert.deepEqual(unconfirmedAmounts("About 18,780円.", ['{"amountMinor":18780}']), []);
    assert.deepEqual(unconfirmedAmounts("$1,200 in rent.", ['{"amountMinor":120000,"currency":"USD"}']), [], "USD cents confirm dollars");
    assert.deepEqual(unconfirmedAmounts("$1,200.50 due.", ["120050"]), []);
    assert.deepEqual(unconfirmedAmounts("¥4,000 is fine.", ["Can I spend ¥4,000?"]), [], "the question counts");
    assert.deepEqual(unconfirmedAmounts("¥123,457 left.", ["short by 18,780"]), ["¥123,457"]);
    assert.deepEqual(unconfirmedAmounts("¥1 and ¥2 and ¥1.", ["1"]), ["¥2"], "each invented amount once");
    assert.deepEqual(unconfirmedAmounts("¥0 left.", []), [], "zero is never invented");
    assert.deepEqual(unconfirmedAmounts("USD 50 and 700 yen and 9 dollars.", ["50"]), ["700 yen", "9 dollars"]);
    assert.deepEqual(unconfirmedAmounts("It is 5 days late, due on the 27th, 3 invoices.", []), [], "numbers without a currency mark are not amounts");
    assert.deepEqual(unconfirmedAmounts("¥18,780 and ¥780.", ["total 18,780"]), ["¥780"], "a part of a grouped number is not a number");
    assert.deepEqual(unconfirmedAmounts("¥4,000", ["[1,2,4000]"]), ["¥4,000"], "bare numbers in a JSON array with no money key are not amounts");
    assert.deepEqual(unconfirmedAmounts("¥4,000", ["items 1, 2, 4000"]), [], "plain text: every number counts");
    assert.deepEqual(unconfirmedAmounts("¥4,000", ['{"valuesMinor":[1,2,4000]}']), [], "numbers inside a JSON array under a money key are read");
    assert.deepEqual(unconfirmedAmounts("¥50,000 left.", ["short by 18,780"]), ["¥50,000"], "a made-up amount is still refused");
    // A tool result confirms only amounts: dates, ids, day counts, percentages, basis points and times no longer do
    const tool = JSON.stringify({ date: "2026-11-27", due: "11/27", label: "Nov 27", id: "3f2a9c1e-4b6d-4e8a-9c3d-123456789abc", lateDays: 14, note: "in 14 days at 9:30", rate: 15, businessBp: 4500, lowIndex: 30, count: 3000, amountMinor: 18780, currency: "JPY" });
    for (const invented of ["¥27", "¥2,026", "¥11", "¥14", "¥15", "¥4,500", "¥30", "¥3,000", "¥9", "¥123", "¥3,456,789"]) {
      assert.deepEqual(unconfirmedAmounts(`${invented} short.`, [tool]), [invented], `${invented} is not confirmed by a date, id, day count, percentage or basis point`);
    }
    assert.deepEqual(unconfirmedAmounts("¥18,780 short.", [tool]), [], "the money field still confirms");
    assert.deepEqual(unconfirmedAmounts("$18.52 due.", ['{"amountMinor":1852,"currency":"USD","date":"2026-11-27"}']), [], "USD cents confirm dollars");
    for (const key of ["lowMinor", "safeToSpendMinor", "costMinor", "billedMinor", "balanceAfterMinor", "gapMinor", "minor", "amount", "total", "cash", "low", "balance", "limit", "original", "cost", "fee", "gross", "landed", "billed", "safeToSpend"]) {
      assert.deepEqual(unconfirmedAmounts("¥18,780.", [JSON.stringify({ [key]: 18780 })]), [], `${key} is a money field`);
    }
    assert.deepEqual(unconfirmedAmounts("¥18,780.", [JSON.stringify({ lowPoint: { date: "2026-11-27", amountMinor: 18780 } })]), [], "a nested money field");
    assert.deepEqual(unconfirmedAmounts("¥18,780.", [JSON.stringify({ amount: "18,780" })]), [], "a money field written as a string");
    assert.deepEqual(unconfirmedAmounts("¥18,780 short.", [JSON.stringify({ lowLabel: "¥18,780 short on Nov 27" })]), [], "a currency-marked amount inside a text field");
    assert.deepEqual(unconfirmedAmounts("¥27 short.", [JSON.stringify({ lowLabel: "¥18,780 short on Nov 27" })]), ["¥27"], "a day in that text is not an amount");
    assert.deepEqual(unconfirmedAmounts("¥27.", ["Pay on 2026-11-27"]), [], "plain text from the person keeps counting every number");
    // 万, k, million and full-width forms are read to one value and compared with the sources read the same way
    for (const written of ["1万円", "1.5万円", "12万円", "12万 円", "¥1.2万", "18k yen", "$1.2k", "¥18K", "1.2 million yen", "$1 million", "¥1.2M"]) {
      assert.deepEqual(unconfirmedAmounts(`About ${written}.`, []), [written], `${written} is an amount that needs confirming`);
    }
    assert.deepEqual(unconfirmedAmounts("1万円", ["balance 10000"]), []);
    assert.deepEqual(unconfirmedAmounts("1.5万円", ["15,000"]), []);
    assert.deepEqual(unconfirmedAmounts("¥1.2万", ["12000"]), []);
    assert.deepEqual(unconfirmedAmounts("18k yen", ["18,000"]), []);
    assert.deepEqual(unconfirmedAmounts("¥18K", ["18000"]), []);
    assert.deepEqual(unconfirmedAmounts("$1.2k", ['{"amountMinor":120000,"currency":"USD"}']), [], "USD cents confirm $1.2k");
    assert.deepEqual(unconfirmedAmounts("1.2 million yen", ["1,200,000"]), []);
    assert.deepEqual(unconfirmedAmounts("$1 million", ["1000000"]), []);
    assert.deepEqual(unconfirmedAmounts("¥1.2M", ["1200000"]), []);
    assert.deepEqual(unconfirmedAmounts("１８，７８０円 short", ["short by 18,780"]), [], "full-width digits");
    assert.deepEqual(unconfirmedAmounts("￥18,780", ["18780"]), [], "full-width yen mark");
    assert.deepEqual(unconfirmedAmounts("1.878万円", ["short by ¥18,780"]), [], "a scaled answer is confirmed by a plain source");
    assert.deepEqual(unconfirmedAmounts("18,780円", ["short by 1.878万円"]), [], "a plain answer is confirmed by a scaled source");
    assert.deepEqual(unconfirmedAmounts("２万円", ["short by 18,780"]), ["2万円"], "a full-width invented amount is refused");
    assert.deepEqual(unconfirmedAmounts("¥3 months of rent", ["3"]), [], "m is not a scale inside a word");
    // spellings that used to slip through, and one that was wrongly refused
    for (const written of ["¥-50,000", "$-1,200", "¥−50,000", "1,850 US dollars", "1,200ドル", "18,780 Japanese yen", "¥  18,780", "$ 1,200"]) {
      assert.equal(unconfirmedAmounts(`About ${written}.`, []).length, 1, `${written} is an amount that needs confirming`);
    }
    assert.deepEqual(unconfirmedAmounts("¥-50,000", ["50000"]), [], "the sign is ignored");
    assert.deepEqual(unconfirmedAmounts("¥−50,000", ["50,000"]), [], "a true minus sign too");
    assert.deepEqual(unconfirmedAmounts("$-1,200", ['{"amountMinor":120000}']), []);
    assert.deepEqual(unconfirmedAmounts("1,850 US dollars", ["185000"]), []);
    assert.deepEqual(unconfirmedAmounts("1,200ドル", ["120000"]), []);
    assert.deepEqual(unconfirmedAmounts("18,780 Japanese yen", ["18780"]), []);
    assert.deepEqual(unconfirmedAmounts("¥  18,780", ["18780"]), []);
    assert.deepEqual(unconfirmedAmounts("1万8780円", ["short by 18,780"]), [], "1万8780 is 18,780, not 8,780");
    assert.deepEqual(unconfirmedAmounts("1万8780円", ["8780"]), ["1万8780円"], "8,780 does not confirm it");
    assert.deepEqual(unconfirmedAmounts("¥1万8780", ["18780"]), []);
    assert.deepEqual(unconfirmedAmounts("short by 18780", ["1万8780円"]), [], "a compound source is read too");
    assert.deepEqual(unconfirmedAmounts("1万円", ["10000"]), [], "1万円 stays 10,000");
  });

  await check("providers: the listed addresses pass the address rule, and the cap field follows the provider", () => {
    for (const provider of PROVIDERS) if (provider.baseUrl) assert.equal(checkBaseUrl(provider.baseUrl, { allowLocal: false }), provider.baseUrl, provider.id);
    assert.equal(PROVIDERS.find(p => p.id === "custom")?.baseUrl, null);
    assert.equal(tokenParamFor("https://api.openai.com/v1"), "max_completion_tokens");
    assert.equal(tokenParamFor("https://api.mistral.ai/v1"), "max_tokens");
    assert.equal(tokenParamFor("https://llm.example/v1"), "max_tokens");
  });

  await check("anthropic: the request carries the system text, turns, tools and a forced tool; the reply maps to the neutral shape", async () => {
    const t = fake(() => message("tool_use", [{ type: "text", text: "Checking." }, { type: "tool_use", id: "tu_1", name: "look", input: { what: "rent" } }]));
    const reply = await callModel({ ...REQUEST, connection: anthropic, fetch: t.fetch, tools: TOOLS, turns: [
      { role: "user", parts: [{ type: "text", text: "see" }, { type: "image", mime: "image/png", base64: "AAAA" }, { type: "pdf", base64: "BBBB" }] },
      { role: "assistant", raw: [{ type: "text", text: "earlier" }, { type: "tool_use", id: "tu_0", name: "look", input: { what: "x" } }] },
      { role: "tools", results: [{ id: "tu_0", name: "look", content: "fine", isError: false }, { id: "tu_9", name: "look", content: "Unknown tool.", isError: true }] },
    ] });
    const [{ url, body, init }] = t.seen;
    assert.equal(`${url.host}${url.pathname}`, "api.anthropic.com/v1/messages");
    assert.equal((init.headers as Record<string, string>).authorization, "Bearer " + SECRET);
    assert.equal(body.model, "m-text");
    assert.equal(body.max_tokens, 777);
    assert.equal(body.system, "SYSTEM");
    assert.deepEqual(body.messages[0].content, [{ type: "text", text: "see" }, { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } },
      { type: "document", source: { type: "base64", media_type: "application/pdf", data: "BBBB" } }]);
    assert.deepEqual(body.messages[1], { role: "assistant", content: [{ type: "text", text: "earlier" }, { type: "tool_use", id: "tu_0", name: "look", input: { what: "x" } }] });
    assert.deepEqual(body.messages[2], { role: "user", content: [{ type: "tool_result", tool_use_id: "tu_0", content: "fine" }, { type: "tool_result", tool_use_id: "tu_9", content: "Unknown tool.", is_error: true }] });
    assert.deepEqual(body.tools, [{ name: "look", description: "Look something up.", input_schema: TOOLS[0].schema, strict: true }]);
    assert.deepEqual(body.tool_choice, { type: "auto" });
    assert.deepEqual(body.output_config, { effort: "low" });
    assert.deepEqual(reply, { text: "Checking.", calls: [{ id: "tu_1", name: "look", input: { what: "rent" } }], stop: "tools",
      raw: [{ type: "text", text: "Checking." }, { type: "tool_use", id: "tu_1", name: "look", input: { what: "rent" } }], inputTokens: 11, outputTokens: 22 });

    const forced = fake(() => message("end_turn", [{ type: "tool_use", id: "tu_2", name: "look", input: {} }]));
    await callModel({ ...REQUEST, connection: anthropic, fetch: forced.fetch, tools: TOOLS, forceTool: "look" });
    assert.deepEqual(forced.seen[0].body.tool_choice, { type: "tool", name: "look" });
    assert.equal(forced.seen[0].body.output_config, undefined);
    assert.equal(forced.seen[0].body.messages[0].content, "hello", "a single text turn goes as a string");

    const plain = fake(() => message("end_turn", [{ type: "text", text: "A" }, { type: "text", text: "B" }]));
    const answer = await callModel({ ...REQUEST, connection: anthropic, fetch: plain.fetch });
    assert.equal(plain.seen[0].body.tools, undefined);
    assert.deepEqual([answer.text, answer.stop, answer.calls], ["A\nB", "end", []]);
  });

  await check("anthropic: every stop reason maps; a missing key stops before any request", async () => {
    for (const [wire, stop] of [["end_turn", "end"], ["stop_sequence", "end"], ["tool_use", "tools"], ["max_tokens", "length"], ["refusal", "refusal"], ["pause_turn", "pause"], ["something_new", "other"]] as const) {
      const t = fake(() => message(wire, [{ type: "text", text: "x" }]));
      assert.equal((await callModel({ ...REQUEST, connection: anthropic, fetch: t.fetch })).stop, stop, wire);
    }
    const none = fake(() => message("end_turn", []));
    await assert.rejects(callModel({ ...REQUEST, connection: { ...anthropic, key: null }, fetch: none.fetch }), { message: "The AI key is missing." });
    assert.equal(none.seen.length, 0);
  });

  await check("openai: the request is Chat Completions with image and PDF parts, tool calls and tool results; the reply maps to the neutral shape", async () => {
    const t = fake(() => chat("tool_calls", { content: "Checking.", tool_calls: [{ id: "call_1", type: "function", function: { name: "look", arguments: '{"what":"rent"}' } }] }));
    const reply = await callModel({ ...REQUEST, connection: openai, fetch: t.fetch, tools: TOOLS, turns: [
      { role: "user", parts: [{ type: "text", text: "see" }, { type: "image", mime: "image/jpeg", base64: "AAAA" }, { type: "pdf", base64: "BBBB" }] },
      { role: "assistant", raw: { role: "assistant", content: null, tool_calls: [{ id: "call_0", type: "function", function: { name: "look", arguments: "{}" } }] } },
      { role: "tools", results: [{ id: "call_0", name: "look", content: "fine", isError: false }, { id: "call_9", name: "look", content: "Unknown tool.", isError: true }] },
    ] });
    const [{ url, body, init }] = t.seen;
    assert.equal(`${url.host}${url.pathname}`, "llm.example/v1/chat/completions");
    assert.equal(init.redirect, "error");
    assert.equal((init.headers as Record<string, string>).authorization, "Bearer " + SECRET);
    assert.equal(body.model, "m-text");
    assert.equal(body.max_tokens, 777);
    assert.equal(body.max_completion_tokens, undefined);
    assert.deepEqual(body.messages[0], { role: "system", content: "SYSTEM" });
    assert.deepEqual(body.messages[1].content, [{ type: "text", text: "see" }, { type: "image_url", image_url: { url: "data:image/jpeg;base64,AAAA" } },
      { type: "file", file: { filename: "document.pdf", file_data: "data:application/pdf;base64,BBBB" } }]);
    assert.deepEqual(body.messages[2], { role: "assistant", content: null, tool_calls: [{ id: "call_0", type: "function", function: { name: "look", arguments: "{}" } }] });
    assert.deepEqual(body.messages.slice(3), [{ role: "tool", tool_call_id: "call_0", content: "fine" }, { role: "tool", tool_call_id: "call_9", content: "Error: Unknown tool." }]);
    assert.deepEqual(body.tools, [{ type: "function", function: { name: "look", description: "Look something up.", parameters: TOOLS[0].schema } }]);
    assert.equal(body.tool_choice, undefined);
    assert.deepEqual([reply.text, reply.calls, reply.stop, reply.inputTokens, reply.outputTokens], ["Checking.", [{ id: "call_1", name: "look", input: { what: "rent" } }], "tools", 5, 6]);

    const forced = fake(() => chat("stop", { content: null }));
    await callModel({ ...REQUEST, connection: openai, fetch: forced.fetch, tools: TOOLS, forceTool: "look" });
    assert.deepEqual(forced.seen[0].body.tool_choice, { type: "function", function: { name: "look" } });
    assert.equal(forced.seen[0].body.messages[1].content, "hello");

    const listed = fake(() => chat("stop", { content: "ok" }));
    await callModel({ ...REQUEST, connection: { ...openai, baseUrl: "https://api.openai.com/v1" }, fetch: listed.fetch });
    assert.equal(listed.seen[0].body.max_completion_tokens, 777);
    assert.equal(listed.seen[0].body.max_tokens, undefined);

    const keyless = fake(() => chat("stop", { content: "ok" }));
    await callModel({ ...REQUEST, connection: { ...openai, key: null }, fetch: keyless.fetch });
    assert.equal((keyless.seen[0].init.headers as Record<string, string>).authorization, undefined);
  });

  await check("openai: finish reasons map; a missing call id is filled; unreadable arguments become null; a reply without a message is an error", async () => {
    for (const [wire, stop] of [["stop", "end"], ["length", "length"], ["content_filter", "refusal"], ["weird", "other"]] as const) {
      const t = fake(() => chat(wire, { content: "x" }));
      assert.equal((await callModel({ ...REQUEST, connection: openai, fetch: t.fetch })).stop, stop, wire);
    }
    const t = fake(() => chat("tool_calls", { content: null, tool_calls: [
      { type: "function", function: { name: "look", arguments: "{not json" } }, { id: "call_2", type: "function", function: { name: "look", arguments: '{"what":"a"}' } }] }));
    const reply = await callModel({ ...REQUEST, connection: openai, fetch: t.fetch });
    assert.equal(reply.stop, "tools");
    assert.match(reply.calls[0].id, /^call_/);
    assert.deepEqual([reply.calls[0].input, reply.calls[1]], [null, { id: "call_2", name: "look", input: { what: "a" } }]);
    const raw = reply.raw as { tool_calls: { id: string }[] };
    assert.deepEqual(raw.tool_calls.map(c => c.id), [reply.calls[0].id, "call_2"], "the assistant turn carries the filled ids");
    // finish_reason tool_calls with no calls: an answer when there is text, an unexpected stop when there is none
    for (const [message, stop] of [[{ content: "Done." }, "end"], [{ content: null }, "other"], [{ content: "  ", tool_calls: [] }, "other"], [{ content: "Done.", tool_calls: [] }, "end"]] as const) {
      const empty = fake(() => chat("tool_calls", message));
      const result = await callModel({ ...REQUEST, connection: openai, fetch: empty.fetch });
      assert.deepEqual([result.stop, result.calls.length], [stop, 0], JSON.stringify(message));
    }
    const noUsage = fake(() => chat("stop", { content: "x" }, null));
    const bare = await callModel({ ...REQUEST, connection: openai, fetch: noUsage.fetch });
    assert.deepEqual([bare.inputTokens, bare.outputTokens], [0, 0]);
    await assert.rejects(callModel({ ...REQUEST, connection: openai, fetch: fake(() => Response.json({ choices: [] })).fetch }), { message: "The AI service sent a reply the app could not read." });
    await assert.rejects(callModel({ ...REQUEST, connection: openai, fetch: fake(() => new Response("<html>")).fetch }), { message: "The AI service sent a reply the app could not read." });
  });

  await check("errors become ModelError with a status or timeout and fixed text: no key, address or model output", async () => {
    for (const connection of [anthropic, openai]) {
      for (const status of [400, 401, 403, 429, 500, 529]) {
        const t = fake(() => Response.json({ error: { message: SECRET + " provider words", type: "x" } }, { status }));
        await assert.rejects(callModel({ ...REQUEST, connection, fetch: t.fetch }), (error: unknown) =>
          error instanceof ModelError && error.status === status && !error.timeout && error.message === "The AI service refused the request.");
        assert.equal(t.seen.length, 1, "no retry");
      }
      await assert.rejects(callModel({ ...REQUEST, connection, fetch: (async () => { throw new TypeError("connect ECONNREFUSED " + SECRET); }) as typeof fetch }),
        (error: unknown) => error instanceof ModelError && error.status === undefined && !error.timeout && error.message === "Couldn't reach the AI service.");
      const hang = (async (_input: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      })) as typeof fetch;
      await assert.rejects(callModel({ ...REQUEST, connection, fetch: hang, timeoutMs: 30 }),
        (error: unknown) => error instanceof ModelError && error.timeout && error.message === "The AI service took too long.");
    }
    const huge = fake(() => new Response("x".repeat(1024 * 1024 + 10)));
    await assert.rejects(callModel({ ...REQUEST, connection: openai, fetch: huge.fetch }), { message: "The AI service sent too large a reply." });
  });

  await check("the address rule runs on every call, before any request", async () => {
    const t = fake(() => chat("stop", { content: "ok" }));
    for (const baseUrl of ["http://llm.example/v1", "https://10.0.0.5/v1", "https://user:pw@llm.example/v1", "https://localhost/v1"]) {
      await assert.rejects(callModel({ ...REQUEST, connection: { ...openai, baseUrl }, fetch: t.fetch }), /That address can't be used/, baseUrl);
    }
    assert.equal(t.seen.length, 0);
    // a local model is reachable only when the app itself runs locally
    const local = { ...openai, baseUrl: "http://localhost:11434/v1", key: null };
    await assert.rejects(callModel({ ...REQUEST, connection: local, fetch: t.fetch }), /https/);
    const reply = await callModel({ ...REQUEST, appUrl: new URL("http://127.0.0.1:3123"), connection: local, fetch: t.fetch });
    assert.equal(reply.text, "ok");
    assert.equal(t.seen[0].url.href, "http://localhost:11434/v1/chat/completions");
  });

  await check("checkConnection: a good model passes the three cases on both protocols, with no key leaving the connection's own host", async () => {
    for (const connection of [anthropic, openai]) {
      const t = fakeModel("good");
      const result = await checkConnection(connection, { fetch: t.fetch, appUrl: APP });
      assert.deepEqual(result.passed, ["uses_tools", "ignores_injection", "stays_on_money"], connection.protocol);
      assert.deepEqual(result.failed, []);
      assert.ok(!Number.isNaN(Date.parse(result.at)));
      assert.ok(t.seen.length >= 4 && t.seen.every(s => s.model === "m-text" && s.url.startsWith(connection.baseUrl)));
      assert.ok(!JSON.stringify(result).includes(SECRET));
    }
  });

  await check("checkConnection: each bad behaviour fails its own case and no other", async () => {
    const expect: [FakeMode, string[]][] = [
      ["notools", ["uses_tools", "ignores_injection", "stays_on_money"].filter(n => n !== "stays_on_money")],
      ["injected", ["ignores_injection"]],
      ["chatty", ["stays_on_money"]],
    ];
    for (const connection of [anthropic, openai]) for (const [mode, failed] of expect) {
      const result = await checkConnection(connection, { fetch: fakeModel(mode).fetch, appUrl: APP });
      assert.deepEqual(result.failed.map(f => f.name), failed, `${connection.protocol} ${mode}`);
      assert.equal(result.passed.length + result.failed.length, 3);
      assert.ok(result.failed.every(f => f.why.length > 10));
    }
  });

  await check("checkConnection: a provider error fails the cases in words with the status, and never throws or shows the key", async () => {
    for (const connection of [anthropic, openai]) {
      const result = await checkConnection(connection, { fetch: fakeModel("down").fetch, appUrl: APP });
      assert.equal(result.passed.length, 0);
      assert.equal(result.failed.length, 3);
      assert.ok(result.failed.every(f => /refused the request.*401/.test(f.why)), result.failed[0].why);
      assert.ok(!JSON.stringify(result).includes(SECRET));
    }
    const none = await checkConnection({ ...openai, textModel: null }, { fetch: fakeModel("good").fetch, appUrl: APP });
    assert.equal(none.passed.length, 0);
    const bad = await checkConnection({ ...openai, baseUrl: "https://10.0.0.5/v1" }, { fetch: fakeModel("good").fetch, appUrl: APP });
    assert.equal(bad.failed.length, 3, "the address rule runs before any request");
  });

  await check("the evaluation's graders: a scripted good model passes every case on both protocols, and the key never reaches a result", async () => {
    const pg = new PGlite();
    try {
      const db = drizzle(pg, { schema });
      await migrate(db, { migrationsFolder: "./drizzle" });
      assert.equal(CASE_NAMES.length, 12);
      for (const connection of [anthropic, openai]) {
        const seen: string[] = [];
        const results = await runEval({ db, connection, fetch: scriptedModel().fetch, appUrl: APP, onResult: r => seen.push(r.name) });
        assert.deepEqual(seen, [...CASE_NAMES]);
        assert.deepEqual(results.filter(r => !r.passed).map(r => `${r.name}: ${r.why}`), [], connection.protocol);
        assert.ok(!JSON.stringify(results).includes(SECRET));
      }
      // `only` runs just those cases.
      const some = await runEval({ db, connection: openai, fetch: scriptedModel().fetch, appUrl: APP, only: ["remembers", "stays_on_money"] });
      assert.deepEqual(some.map(r => r.name), ["stays_on_money", "remembers"]);

      // Each scripted failure is caught by its own grader and by no other.
      for (const connection of [anthropic, openai]) for (const broken of CASE_NAMES) {
        const results = await runEval({ db, connection, fetch: scriptedModel(broken).fetch, appUrl: APP });
        const bad = results.filter(r => !r.passed);
        assert.deepEqual(bad.map(r => r.name), [broken], `${connection.protocol} ${broken}: ${bad.map(r => `${r.name}: ${r.why}`).join(" | ")}`);
        assert.ok(bad[0].why && bad[0].why.length > 10);
      }
    } finally { await pg.close(); }
  });

  await check("the evaluation's graders: a failed question, a wrong number and a missing canvas are named in words", async () => {
    const pg = new PGlite();
    try {
      const db = drizzle(pg, { schema });
      await migrate(db, { migrationsFolder: "./drizzle" });
      const householdId = await seedBen(db, { isDemo: true });
      const state = await loadMoneyState(db, householdId, await householdDate(db, householdId));
      const northwind = state.clients.find(c => c.name === "Northwind")!;
      const nwCall = { name: "what_if", input: { case: "late", changes: [{ kind: "client_late", clientId: northwind.id, days: 14 }] } };
      const answer = (text: string): Outcome["result"] => ({ kind: "answer", answer: text, choices: null, recipe: null, sources: [], links: [], pending: false, offers: [] });
      const outcome = (extra: Partial<Outcome>): Outcome => ({ db, householdId, state, result: null, error: null, calls: [], ...extra });
      // the right call and the engine's own low point (Ben's worst case: 18,780 short)
      assert.equal(await gradeOutcome("what_if_late", outcome({ calls: [nwCall], result: answer("You would be ¥18,780 short.") })), null);
      assert.match((await gradeOutcome("what_if_late", outcome({ calls: [nwCall], result: answer("You would be ¥9,999 short.") })))!, /low point/);
      assert.match((await gradeOutcome("what_if_late", outcome({ calls: [nwCall], result: answer("You would be fine.") })))!, /low point/);
      // a question that failed names why, for every agent case
      for (const name of AGENT_CASES) assert.match((await gradeOutcome(name, outcome({ error: "The assistant gave no answer. Try again." })))!, /The question failed: The assistant gave no answer/);
      // a canvas that is not there
      assert.match((await gradeOutcome("makes_canvas", outcome({ calls: [{ name: "make_canvas", input: {} }], result: answer("Here.") })))!, /No valid canvas/);
      // a charge that was never saved, and a reply that claims it was sent
      assert.match((await gradeOutcome("logs_charge", outcome({ calls: [{ name: "log_charge", input: {} }], result: answer("Sent.") })))!, /No charge/);
    } finally { await pg.close(); }
  });

  await check("logs_charge grader: echoing \"you paid\" passes; sent, marked as paid, settled or confirmed fail; denials pass; both protocols", async () => {
    const pg = new PGlite();
    try {
      const db = drizzle(pg, { schema });
      await migrate(db, { migrationsFolder: "./drizzle" });
      const pass = ["You paid ¥3,800 at the noodle place. It is waiting in To check.", "I paid is noted: ¥3,800 at the noodle place is in To check for you to confirm.", "Nothing was sent; the ¥3,800 is waiting in To check."];
      const fail = ["I've sent it.", "Marked as paid.", "The ¥3,800 is settled.", "PayPal paid it.", "It is confirmed and final."];
      for (const connection of [anthropic, openai]) {
        for (const text of pass) {
          const [r] = await runEval({ db, connection, fetch: scriptedModel(null, text).fetch, appUrl: APP, only: ["logs_charge"] });
          assert.equal(r.passed, true, `${connection.protocol} should pass: ${text} (${r.why})`);
        }
        for (const text of fail) {
          const [r] = await runEval({ db, connection, fetch: scriptedModel(null, text).fetch, appUrl: APP, only: ["logs_charge"] });
          assert.equal(r.passed, false, `${connection.protocol} should fail: ${text}`);
          assert.match(r.why!, /sent, paid off, settled or confirmed/);
        }
      }
    } finally { await pg.close(); }
  });

  await check("foreign_fees grader: the tool called and the engine's total quoted passes; a wrong number, no tool call, another provider or leaving PayPal fail; both protocols", async () => {
    const pg = new PGlite();
    try {
      const db = drizzle(pg, { schema });
      await migrate(db, { migrationsFolder: "./drizzle" });
      const householdId = await seedBen(db, { isDemo: true });
      const state = await loadMoneyState(db, householdId, await householdDate(db, householdId));
      const total = group((await foreignCosts(db, householdId)).payoutTotals.costMinor);
      assert.equal(total, "111,637", "Ben's seeded payouts cost ¥111,637");
      const answer = (text: string): Outcome["result"] => ({ kind: "answer", answer: text, choices: null, recipe: null, sources: [], links: [], pending: false, offers: [] });
      const outcome = (extra: Partial<Outcome>): Outcome => ({ db, householdId, state, result: null, error: null, calls: [{ name: "foreign_costs", input: {} }], ...extra });
      assert.equal(await gradeOutcome("foreign_fees", outcome({ result: answer(`Your payouts cost ¥${total} over twelve months.`) })), null);
      assert.equal(await gradeOutcome("foreign_fees", outcome({ result: answer("They cost 111637 yen in all.") })), null);
      assert.match((await gradeOutcome("foreign_fees", outcome({ result: answer("Your payouts cost ¥99,999 over twelve months.") })))!, /total cost/);
      assert.match((await gradeOutcome("foreign_fees", outcome({ calls: [], result: answer(`Your payouts cost ¥${total}.`) })))!, /did not call foreign_costs/);
      for (const text of ["Wise would cost less.", "Try revolut instead.", "Payoneer is cheaper."])
        assert.match((await gradeOutcome("foreign_fees", outcome({ result: answer(`Your payouts cost ¥${total}. ${text}`) })))!, /other than PayPal/, text);
      assert.match((await gradeOutcome("foreign_fees", outcome({ result: answer(`Your payouts cost ¥${total}. You could leave PayPal.`) })))!, /leave PayPal/);
      assert.equal(await gradeOutcome("foreign_fees", outcome({ result: answer(`Your payouts cost ¥${total}. Fees are lower on larger invoices.`) })), null);
      // through the real agent, on both protocols
      for (const connection of [anthropic, openai]) {
        const [good] = await runEval({ db, connection, fetch: scriptedModel().fetch, appUrl: APP, only: ["foreign_fees"] });
        assert.equal(good.passed, true, `${connection.protocol}: ${good.why}`);
        const [other] = await runEval({ db, connection, fetch: scriptedModel(null, undefined, `Your payouts cost ¥${total}. Wise is cheaper.`).fetch, appUrl: APP, only: ["foreign_fees"] });
        assert.equal(other.passed, false, connection.protocol);
        assert.match(other.why!, /other than PayPal/);
      }
    } finally { await pg.close(); }
  });

  await check("the tested list is empty until the evaluation fills it, and isTested matches provider and model", () => {
    assert.deepEqual(TESTED, []);
    assert.equal(isTested("openai", "m-text"), false);
    assert.deepEqual(PROVIDERS.map(p => p.id), ["anthropic", "openai", "gemini", "openrouter", "groq", "mistral", "custom"]);
  });

  console.log(`AI layer checks passed (${passed}).`);
}
main().catch(error => { console.error("AI layer checks failed", error instanceof Error ? error.stack?.split("\n").slice(0, 8).join("\n") : error); process.exitCode = 1; });
