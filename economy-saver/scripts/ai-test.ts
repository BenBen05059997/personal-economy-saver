// The model layer (D56): the address rule, the amount check and callModel's mapping in and out, for both protocols,
// over fake transports; and the assistant evaluation's graders (D60) against a scripted model. PGlite only for the graders;
// no network, no credentials.
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "@/db/schema";
import { householdDate } from "@/db/account";
import { loadMoneyState } from "@/db/household";
import { foreignCosts } from "@/db/fx-cost";
import { group } from "@/lib/money/format";
import { seedBen } from "@/db/seed";
import { firstUse, MODEL_HINT, OWN_MODEL_HINT } from "@/lib/agent/reply";
import { askMissingWords, serverHasNoModel } from "@/lib/agent/availability";
import { toolInputSchema, tools } from "@/lib/agent/tools";
import { AGENT_CASES, CASE_NAMES, gradeOutcome, runEval, scriptedModel, type Outcome } from "./model-eval-cases";
import { callModel } from "@/lib/ai/call";
import { listModels, markListedModels } from "@/lib/ai/list-models";
import { CHECK_NAMES, checkConnection } from "@/lib/ai/check";
import { CONNECTION_BILL } from "@/lib/ai/connection-bill";
import { isTested, TESTED } from "@/lib/ai/tested";
import { fakeModel, type FakeMode } from "./ai-fake";
import { checkBaseUrl, localAllowed } from "@/lib/ai/endpoint";
import { unconfirmedAmounts, unconfirmedNumbers } from "@/lib/ai/number-check";
import { PROVIDERS, providerFromKey, tokenParamFor } from "@/lib/ai/providers";
import { modelFailureWords } from "@/lib/ai/provider-failure";
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
  await check("the model tool catalogue stays below 20,000 characters and preserves bulk item fields", () => {
    const specs = tools.map(tool => ({ name: tool.name, description: tool.description, schema: toolInputSchema(tool) }));
    assert.ok(JSON.stringify(specs).length <= 20_000);
    for (const [single, bulk] of [["add_bill", "add_bills"], ["log_charge", "log_charges"]]) {
      const item = specs.find(spec => spec.name === single)!.schema;
      const { items } = specs.find(spec => spec.name === bulk)!.schema.properties as {
        items: { items: { properties: Record<string, unknown>; required: string[] } };
      };
      assert.deepEqual(Object.keys(items.items.properties), Object.keys(item.properties as object));
      assert.deepEqual(items.items.required, item.required);
    }
  });

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
      "https://192.0.0.1/v1", "https://192.0.2.7/v1", "https://198.18.0.1/v1", "https://198.19.255.255/v1", "https://198.51.100.9/v1", "https://203.0.113.5/v1", "https://240.0.0.1/v1", "https://0.1.2.3/v1", "https://[::ffff:100.64.0.1]/v1", "https://[fe90::1]/v1", "https://[febf::1]/v1", "https://[fdff::1]/v1",
    ];
    for (const address of bad) assert.throws(() => checkBaseUrl(address, { allowLocal: false }), /That address can't be used/, address);
    // not private: just outside the ranges
    for (const ok of ["https://172.15.0.1/v1", "https://172.32.0.1/v1", "https://100.63.0.1/v1", "https://100.128.0.1/v1", "https://169.253.0.1/v1", "https://192.169.0.1/v1", "https://192.0.3.1/v1", "https://198.17.0.1/v1", "https://198.20.0.1/v1"]) {
      assert.equal(checkBaseUrl(ok, { allowLocal: false }), ok);
    }
  });

  await check("modelFailureWords words a timeout, a refused key, a busy service, an HTTP status and an unreachable service", () => {
    assert.equal(modelFailureWords(new ModelError("x", undefined, true), "slow"), "slow");
    assert.equal(modelFailureWords(new ModelError("x", 401), "slow"), "The AI key was not accepted. Check it in Settings.");
    assert.equal(modelFailureWords(new ModelError("x", 403), "slow"), "The AI key was not accepted. Check it in Settings.");
    assert.equal(modelFailureWords(new ModelError("x", 429), "slow"), "The AI service is busy. Try again in a minute.");
    assert.equal(modelFailureWords(new ModelError("x", 500), "slow"), "The AI service returned HTTP 500. Try again.");
    assert.equal(modelFailureWords(new ModelError("x"), "slow"), "Couldn't reach the AI service. Try again.");
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
    assert.deepEqual(unconfirmedAmounts("カードAの明細は5万8,000円です", ["58000"]), [], "5万8,000円 is 58,000, not 8,000");
    assert.deepEqual(unconfirmedAmounts("5万8千円", ["58000"]), [], "5万8千円 is 58,000");
    assert.deepEqual(unconfirmedAmounts("5万8千円", ["8000"]), ["5万8千円"], "8,000 does not confirm 5万8千円");
    assert.deepEqual(unconfirmedAmounts("3千円", ["12000"]), ["3千円"], "an invented 千 amount is refused");
    assert.deepEqual(unconfirmedAmounts("58,000円", ["58000"]), [], "58,000円 is confirmed by ¥58,000's 58000");
    assert.deepEqual(unconfirmedAmounts("¥58,000円", ["58000"]), []);
  });

  await check("the unsigned statement amount is backed by a signed timeline outflow", () => {
    const sources = [JSON.stringify({ events: [{ amountMinor: -58000, date: "2026-11-26" }] })];
    assert.deepEqual(unconfirmedAmounts("The full statement is ¥58,000 due Nov 26.", sources), []);
    assert.deepEqual(unconfirmedAmounts("The statement is ¥58,001.", sources), ["¥58,001"]);
  });

  await check("providers: the listed addresses pass the address rule, and the cap field follows the provider", () => {
    for (const provider of PROVIDERS) if (provider.baseUrl) assert.equal(checkBaseUrl(provider.baseUrl, { allowLocal: false }), provider.baseUrl, provider.id);
    assert.equal(PROVIDERS.find(p => p.id === "custom")?.baseUrl, null);
    assert.equal(tokenParamFor("https://api.openai.com/v1"), "max_completion_tokens");
    assert.equal(tokenParamFor("https://api.mistral.ai/v1"), "max_tokens");
    assert.equal(tokenParamFor("https://llm.example/v1"), "max_tokens");
  });

  await check("provider inference recognizes only distinctive prefixes while the app default is selected", () => {
    const examples = [
      ["sk-ant-fictional-example", "anthropic"],
      ["sk-or-fictional-example", "openrouter"],
      ["gsk_fictional_example", "groq"],
      ["AIza-fictional-example", "gemini"],
    ] as const;
    for (const [key, provider] of examples) {
      assert.equal(providerFromKey(key, ""), provider);
      assert.equal(providerFromKey(` \t${key}\n `, ""), provider);
    }
    for (const key of ["sk-fictional-example", "FictionalMistralKeyExample", "unknown-fictional-key", "example-sk-ant-fictional", "  "]) {
      assert.equal(providerFromKey(key, ""), undefined);
    }
    for (const { id } of PROVIDERS) {
      assert.equal(providerFromKey("sk-ant-fictional-example", id), undefined, id);
    }
  });

  await check("each listed provider has a public HTTPS key page and custom has no link", () => {
    for (const { id, getKeyUrl } of PROVIDERS) {
      if (id === "custom") {
        assert.equal(getKeyUrl, null);
      } else {
        assert.ok(getKeyUrl, id);
        assert.doesNotThrow(() => checkBaseUrl(getKeyUrl, { allowLocal: false }), id);
      }
    }
  });

  await check("Anthropic model listing uses the fixed GET address and API headers, paginates, and shares a ten-second deadline", async () => {
    const seen: { request: Request; signal?: AbortSignal | null }[] = [];
    const controller = new AbortController();
    const deadlines: number[] = [];
    const realTimeout = AbortSignal.timeout;
    try {
      AbortSignal.timeout = ms => { deadlines.push(ms); return controller.signal; };
      const models = await listModels({ provider: "anthropic", baseUrl: "https://ignored.example/v1", key: SECRET }, { appUrl: APP,
        fetch: async (input, init) => {
          seen.push({ request: new Request(input, init), signal: init?.signal });
          return seen.length === 1
            ? Response.json({ data: [{ id: "fictional-claude-vision" }], has_more: true, last_id: "fictional cursor" })
            : Response.json({ data: [{ id: "fictional-claude-next" }], has_more: false });
        },
      });
      assert.deepEqual(models, [{ id: "fictional-claude-vision" }, { id: "fictional-claude-next" }]);
    } finally { AbortSignal.timeout = realTimeout; }
    assert.deepEqual(deadlines, [10_000]);
    assert.equal(seen.length, 2);
    for (const { request, signal } of seen) {
      const url = new URL(request.url);
      assert.equal(url.origin + url.pathname, "https://api.anthropic.com/v1/models");
      assert.equal(url.searchParams.get("limit"), "1000");
      assert.equal(request.method, "GET");
      assert.equal(request.redirect, "manual");
      assert.equal(request.headers.get("x-api-key"), SECRET);
      assert.equal(request.headers.get("anthropic-version"), "2023-06-01");
      assert.equal(request.headers.get("authorization"), null);
      assert.equal(signal, controller.signal);
    }
    assert.equal(new URL(seen[0].request.url).searchParams.get("after_id"), null);
    assert.equal(new URL(seen[1].request.url).searchParams.get("after_id"), "fictional cursor");
  });

  await check("model listings use the provider's fixed endpoint and only reported tool and image capabilities", async () => {
    const unknown = { id: "fictional-vision-tools-model" };
    const endpoints = [
      ["openai", "https://api.openai.com/v1/models"],
      ["gemini", "https://generativelanguage.googleapis.com/v1beta/openai/models"],
      ["groq", "https://api.groq.com/openai/v1/models"],
      ["mistral", "https://api.mistral.ai/v1/models"],
      ["openrouter", "https://openrouter.ai/api/v1/models"],
      ["custom", "https://custom.example/v1/models"],
    ];
    for (const [provider, url] of endpoints) {
      const requests: Request[] = [];
      const baseUrl = provider === "custom" ? "https://custom.example/v1/" : "https://ignored.example/v1";
      const key = provider === "custom" ? null : SECRET;
      const models = await listModels({ provider, baseUrl, key }, { appUrl: APP, fetch: async (input, init) => {
        requests.push(new Request(input, init));
        if (provider === "mistral") {
          return Response.json([unknown, { id: "fictional-small", capabilities: { function_calling: false, vision: true } }]);
        }
        if (provider === "openrouter") {
          return Response.json({ data: [unknown, { id: "fictional/vendor-text", supported_parameters: ["temperature", "tools"],
            architecture: { input_modalities: ["text"] } }] });
        }
        return Response.json({ data: [unknown] });
      } });
      assert.equal(requests.length, 1);
      const [request] = requests;
      assert.deepEqual([request.url, request.method, request.redirect, request.cache], [url, "GET", "manual", "no-store"]);
      assert.equal(request.headers.get("authorization"), key ? `Bearer ${key}` : null);
      assert.equal(request.headers.get("x-api-key"), null);
      const expected = [unknown];
      if (provider === "mistral") assert.deepEqual(models, [...expected, { id: "fictional-small", tools: false, images: true }]);
      else if (provider === "openrouter") assert.deepEqual(models, [...expected, { id: "fictional/vendor-text", tools: true, images: false }]);
      else assert.deepEqual(models, expected);
    }
  });

  await check("tested model labels match provider and id without hiding untested or unknown models", () => {
    const models = [{ id: "shared" }, { id: "local", tools: true }, { id: "unseen", images: false }];
    const checkedOn = "2026-11-01";
    assert.deepEqual(markListedModels("mistral", models, [
      { provider: "openai", model: "shared", checkedOn }, { provider: "mistral", model: "local", checkedOn },
    ]), [{ ...models[1], tested: true }, { ...models[0], tested: false }, { ...models[2], tested: false }]);
  });

  await check("model listing refuses redirects, provider errors, malformed or key-echoing lists, and unreachable services", async () => {
    const connection = { provider: "openai", baseUrl: "", key: SECRET };
    const expect = async (response: () => Response, words: RegExp) =>
      assert.rejects(listModels(connection, { appUrl: APP, fetch: async () => response() }), words);
    await expect(() => Response.json({ error: { message: SECRET } }, { status: 401 }), /refused the request/);
    await expect(() => Response.json({ models: [{ id: "wrong shape" }] }), /could not read/);
    await expect(() => Response.json({ data: [{ id: `echo-${SECRET}` }] }), /could not read/);
    let requests = 0;
    await assert.rejects(listModels(connection, { appUrl: APP, fetch: async (input, init) => {
      requests++;
      const request = new Request(input, init);
      assert.equal(request.redirect, "manual");
      return new Response(null, { status: 307, headers: { Location: "https://redirect.example/models" } });
    } }), /answered with a redirect/);
    assert.equal(requests, 1);
    await assert.rejects(listModels(connection, { appUrl: APP, fetch: async () => { throw new Error(SECRET); } }),
      { message: "Couldn't reach the AI service." });
    await assert.rejects(listModels({ provider: "custom", baseUrl: "https://10.0.0.1/v1", key: SECRET }, {
      appUrl: APP, fetch: async () => { assert.fail("blocked address must not be fetched"); },
    }), /private network/);
  });

  await check("a model call refuses a redirect answer, so the key is never re-sent", async () => {
    for (const connection of [anthropic, openai]) {
      const t = fake(() => new Response(null, { status: 308, headers: { Location: "https://elsewhere.example/v1/messages" } }));
      await assert.rejects(callModel({ ...REQUEST, connection, fetch: t.fetch }), /answered with a redirect/);
      assert.equal(t.seen.length, 1);
    }
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
    assert.equal(init.redirect, "manual");
    assert.equal((init.headers as Record<string, string>)["x-api-key"], SECRET);
    assert.equal((init.headers as Record<string, string>).authorization, undefined);
    assert.equal(body.model, "m-text");
    assert.equal(body.max_tokens, 777);
    assert.equal(body.system, "SYSTEM");
    assert.deepEqual(body.messages[0].content, [{ type: "text", text: "see" }, { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } },
      { type: "document", source: { type: "base64", media_type: "application/pdf", data: "BBBB" } }]);
    assert.deepEqual(body.messages[1], { role: "assistant", content: [{ type: "text", text: "earlier" }, { type: "tool_use", id: "tu_0", name: "look", input: { what: "x" } }] });
    assert.deepEqual(body.messages[2], { role: "user", content: [{ type: "tool_result", tool_use_id: "tu_0", content: "fine" }, { type: "tool_result", tool_use_id: "tu_9", content: "Unknown tool.", is_error: true }] });
    assert.deepEqual(body.tools, [{ name: "look", description: "Look something up.", input_schema: TOOLS[0].schema }], "Ask's tools are not strict: Anthropic allows at most 20");
    assert.deepEqual(body.tool_choice, { type: "auto" });
    assert.deepEqual(body.output_config, { effort: "low" });
    assert.deepEqual(reply, { text: "Checking.", calls: [{ id: "tu_1", name: "look", input: { what: "rent" } }], stop: "tools",
      raw: [{ type: "text", text: "Checking." }, { type: "tool_use", id: "tu_1", name: "look", input: { what: "rent" } }], inputTokens: 11, outputTokens: 22, cacheReadTokens: 0, cacheWriteTokens: 0 });

    const forced = fake(() => message("end_turn", [{ type: "tool_use", id: "tu_2", name: "look", input: {} }]));
    await callModel({ ...REQUEST, connection: anthropic, fetch: forced.fetch, tools: TOOLS, forceTool: "look" });
    assert.deepEqual(forced.seen[0].body.tool_choice, { type: "auto" }, "current Anthropic models reject a forced tool_choice");
    assert.ok(forced.seen[0].body.system.endsWith("Answer only by calling the look tool once."));
    assert.equal("thinking" in forced.seen[0].body, false);
    assert.equal(forced.seen[0].body.tools[0].strict, true, "the forced tool is strict");
    assert.deepEqual(forced.seen[0].body.output_config, { effort: "low" });
    const careful = fake(() => message("end_turn", [{ type: "text", text: "A" }]));
    await callModel({ ...REQUEST, connection: anthropic, fetch: careful.fetch, effort: "medium" });
    assert.deepEqual(careful.seen[0].body.output_config, { effort: "medium" }, "a request may ask for medium effort");
    assert.equal(forced.seen[0].body.messages[0].content, "hello", "a single text turn goes as a string");

    const plain = fake(() => message("end_turn", [{ type: "text", text: "A" }, { type: "text", text: "B" }]));
    const answer = await callModel({ ...REQUEST, connection: anthropic, fetch: plain.fetch });
    assert.equal(plain.seen[0].body.tools, undefined);
    assert.deepEqual([answer.text, answer.stop, answer.calls], ["A\nB", "end", []]);
  });

  await check("anthropic: with a stable system part the body marks the last tool, the stable block and the last message for one hour; the usage's cache counts come back", async () => {
    const t = fake(() => message("end_turn", [{ type: "text", text: "x" }], { input_tokens: 1, output_tokens: 2, cache_read_input_tokens: 30, cache_creation_input_tokens: 40 } as never));
    const reply = await callModel({ ...REQUEST, connection: anthropic, fetch: t.fetch, system: "STABLE\n\nVARYING", systemStable: "STABLE",
      tools: [...TOOLS, { ...TOOLS[0], name: "look2" }], forceTool: "look2" });
    const mark = { type: "ephemeral", ttl: "1h" };
    const { body } = t.seen[0];
    assert.deepEqual(body.system, [{ type: "text", text: "STABLE", cache_control: mark }, { type: "text", text: "VARYING\n\nAnswer only by calling the look2 tool once." }]);
    assert.equal(body.tools[0].cache_control, undefined);
    assert.deepEqual(body.tools[1].cache_control, mark);
    assert.deepEqual(body.messages[0].content, [{ type: "text", text: "hello", cache_control: mark }]);
    assert.equal(JSON.stringify(body).split("cache_control").length - 1, 3, "three marks, under the limit of four");
    assert.deepEqual([reply.cacheReadTokens, reply.cacheWriteTokens], [30, 40]);
    const bare = fake(() => message("end_turn", [{ type: "text", text: "x" }]));
    await callModel({ ...REQUEST, connection: anthropic, fetch: bare.fetch, systemStable: "SYS", tools: TOOLS });
    assert.deepEqual(bare.seen[0].body.system, [{ type: "text", text: "SYS", cache_control: mark }, { type: "text", text: "TEM" }]);
    const oneShot = fake(() => message("end_turn", [{ type: "text", text: "x" }]));
    await callModel({ ...REQUEST, connection: anthropic, fetch: oneShot.fetch, tools: TOOLS });
    assert.equal(JSON.stringify(oneShot.seen[0].body).includes("cache_control"), false, "a one-shot call is not cached");
  });

  await check("openai: the body carries no cache_control even with a stable system part", async () => {
    const t = fake(() => chat("stop", { content: "x" }));
    await callModel({ ...REQUEST, connection: openai, fetch: t.fetch, system: "STABLE\n\nVARYING", systemStable: "STABLE", tools: TOOLS });
    assert.equal(JSON.stringify(t.seen[0].body).includes("cache_control"), false);
    assert.deepEqual(t.seen[0].body.messages[0], { role: "system", content: "STABLE\n\nVARYING" });
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
    assert.equal(init.redirect, "manual");
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

  await check("checkConnection: text and image pass on both protocols, with the bill image sent only to the document model", async () => {
    for (const connection of [anthropic, openai]) {
      const t = fakeModel("good");
      const result = await checkConnection(connection, { fetch: t.fetch, appUrl: APP });
      assert.deepEqual(result.passed, CHECK_NAMES, connection.protocol);
      assert.deepEqual(result.failed, []);
      assert.ok(!Number.isNaN(Date.parse(result.at)));
      assert.equal(t.seen.length, 5);
      assert.ok(t.seen.every(request => new URL(request.url).origin === new URL(connection.baseUrl).origin));
      const images = t.seen.filter(request => request.image);
      assert.equal(images.length, 1);
      assert.ok(t.seen.filter(request => !request.image).every(request => request.model === "m-text" && request.tools > 0));
      const [image] = images;
      assert.equal(image.model, "m-doc");
      assert.equal(image.tools, 0);
      assert.match(image.question, /Read the total in yen from this bill image/);
      assert.doesNotMatch(image.question, /6,?173/);
      assert.deepEqual(image.image, connection.protocol === "anthropic"
        ? { type: "image", source: { type: "base64", media_type: CONNECTION_BILL.mime, data: CONNECTION_BILL.base64 } }
        : { type: "image_url", image_url: { url: `data:${CONNECTION_BILL.mime};base64,${CONNECTION_BILL.base64}` } });
      assert.ok(!JSON.stringify(result).includes(SECRET));
    }
  });

  await check("checkConnection: each bad behaviour fails only the relevant text or image checks", async () => {
    const expect: [FakeMode, string[]][] = [
      ["notools", ["uses_tools", "ignores_injection"]],
      ["injected", ["ignores_injection"]],
      ["chatty", ["stays_on_money"]],
      ["noimages", ["reads_images"]],
      ["wrongimage", ["reads_images"]],
    ];
    for (const connection of [anthropic, openai]) for (const [mode, failed] of expect) {
      const result = await checkConnection(connection, { fetch: fakeModel(mode).fetch, appUrl: APP });
      assert.deepEqual(result.failed.map(f => f.name), failed, `${connection.protocol} ${mode}`);
      assert.equal(result.passed.length + result.failed.length, 4);
      assert.ok(result.failed.every(f => f.why.length > 10));
      if (mode === "noimages" || mode === "wrongimage") {
        assert.deepEqual(result.failed, [{ name: "reads_images", why: "It did not read the total from the bill image." }]);
      }
    }
  });

  await check("checkConnection: tested question models skip only the text checks", async () => {
    for (const connection of [anthropic, openai]) {
      const model = fakeModel("noimages");
      const result = await checkConnection(connection, { fetch: model.fetch, appUrl: APP, testedText: true });
      assert.deepEqual(result.passed, ["uses_tools", "ignores_injection", "stays_on_money"]);
      assert.deepEqual(result.failed.map(failure => failure.name), ["reads_images"]);
      assert.equal(model.seen.length, 1);
      assert.equal(model.seen[0].model, connection.documentModel);
      assert.ok(model.seen[0].image);
    }
  });

  await check("checkConnection: provider errors keep only known failure metadata without provider text or a key", async () => {
    for (const connection of [anthropic, openai]) {
      const result = await checkConnection(connection, { fetch: fakeModel("down").fetch, appUrl: APP });
      assert.equal(result.passed.length, 0);
      assert.equal(result.failed.length, 4);
      assert.ok(result.failed.every(f => f.providerFailure === "key" && /refused the request.*401/.test(f.why)), result.failed[0].why);
      assert.ok(!JSON.stringify(result).includes(SECRET));
      const credit = await checkConnection(connection, { fetch: fakeModel("credit").fetch, appUrl: APP });
      assert.equal(credit.failed.length, 4);
      assert.ok(credit.failed.every(f => f.providerFailure === "credit" && !f.why.includes("fictional-billing")));
      const missing = await checkConnection(connection, { fetch: fakeModel("missingmodel").fetch, appUrl: APP });
      assert.deepEqual(missing.failed.map(({ name, providerFailure }) => [name, providerFailure]), [["reads_images", "model"]]);
    }
    const none = await checkConnection({ ...openai, textModel: null }, { fetch: fakeModel("good").fetch, appUrl: APP });
    assert.deepEqual(none.passed, ["reads_images"]);
    const transport = fakeModel("good");
    const bad = await checkConnection({ ...openai, baseUrl: "https://10.0.0.5/v1" }, { fetch: transport.fetch, appUrl: APP });
    assert.equal(bad.failed.length, 4);
    assert.equal(transport.seen.length, 0, "the address rule runs before any request");
  });

  await check("the evaluation's graders: a scripted good model passes every case on both protocols, and the key never reaches a result", async () => {
    const pg = new PGlite({ extensions: { pg_trgm } });
    try {
      const db = drizzle(pg, { schema });
      await migrate(db, { migrationsFolder: "./drizzle" });
      assert.equal(CASE_NAMES.length, 20);
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
    const pg = new PGlite({ extensions: { pg_trgm } });
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
      // `show` draws the October picture instead of a make_canvas table: it passes for October and fails for another month
      const shownRecipe = (month?: string) => ({ version: 1 as const, title: "Where does the month go?", blocks: [{ type: "view" as const, view: "month_by_category" as const, args: month ? { month } : {} }] });
      assert.equal(await gradeOutcome("makes_canvas", outcome({ calls: [{ name: "show", input: {} }], result: { ...answer("Here is October.")!, recipe: shownRecipe("2026-10") } })), null);
      assert.match((await gradeOutcome("makes_canvas", outcome({ calls: [{ name: "show", input: {} }], result: { ...answer("Here.")!, recipe: shownRecipe("2026-09") } })))!, /not 2026-10/);
      assert.match((await gradeOutcome("makes_canvas", outcome({ calls: [{ name: "show", input: {} }], result: { ...answer("Here.")!, recipe: shownRecipe() } })))!, /current month/);
      // a charge that was never saved, and a reply that claims it was sent
      assert.match((await gradeOutcome("logs_charge", outcome({ calls: [{ name: "log_charge", input: {} }], result: answer("Sent.") })))!, /No charge/);
    } finally { await pg.close(); }
  });

  await check("logs_charge grader: echoing \"you paid\" passes; sent, marked as paid, settled or confirmed fail; denials pass; both protocols", async () => {
    const pg = new PGlite({ extensions: { pg_trgm } });
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
    const pg = new PGlite({ extensions: { pg_trgm } });
    try {
      const db = drizzle(pg, { schema });
      await migrate(db, { migrationsFolder: "./drizzle" });
      const householdId = await seedBen(db, { isDemo: true });
      const state = await loadMoneyState(db, householdId, await householdDate(db, householdId));
      const total = group((await foreignCosts(db, householdId)).payoutTotals.costMinor);
      assert.equal(total, "111,637", "Ben's seeded payouts cost ¥111,637");
      const answer = (text: string): Outcome["result"] => ({ kind: "answer", answer: text, choices: null, recipe: null, sources: [], links: [], pending: false, offers: [] });
      const outcome = (extra: Partial<Outcome>): Outcome => ({ db, householdId, state, result: null, error: null, calls: [{ name: "show", input: { view: "fx_cost", args: JSON.stringify({ months: 12 }) } }], ...extra });
      assert.equal(await gradeOutcome("foreign_fees", outcome({ result: answer(`Your payouts cost ¥${total} over twelve months.`) })), null);
      assert.equal(await gradeOutcome("foreign_fees", outcome({ result: answer("They cost 111637 yen in all.") })), null);
      assert.match((await gradeOutcome("foreign_fees", outcome({ result: answer("Your payouts cost ¥99,999 over twelve months.") })))!, /total cost/);
      assert.match((await gradeOutcome("foreign_fees", outcome({ calls: [], result: answer(`Your payouts cost ¥${total}.`) })))!, /did not show fx_cost/);
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

  await check("Settings and Ask name the default model and where a household can choose another", () => {
    assert.equal(MODEL_HINT, "Questions go to fipa’s model, and you can choose another in Settings → Your AI model.");
    assert.equal(firstUse("models.example", false), `A model words the answers; every number is the app's own, from your records. This is not financial advice. Your questions go to models.example. ${MODEL_HINT}`);
    assert.equal(firstUse("models.example", true), `A model words the answers; every number is the app's own, from your records. This is not financial advice. Your questions go to models.example. ${OWN_MODEL_HINT}`);
  });

  await check("D56: with no AI_ setting at all the household is told to add its own key (owner) or ask the owner (member); a partial setup names the setting", () => {
    const names = ["AI_PROTOCOL", "AI_BASE_URL", "AI_API_KEY", "AI_TEXT_MODEL", "AI_DOCUMENT_MODEL"] as const;
    const saved = Object.fromEntries(names.map(name => [name, process.env[name]]));
    try {
      for (const name of names) delete process.env[name];
      assert.equal(serverHasNoModel(), true);
      assert.equal(askMissingWords("AI_TEXT_MODEL", true), "Add your own AI key in Settings to use Ask.");
      assert.equal(askMissingWords("AI_TEXT_MODEL", false), "Ask the household’s owner to add an AI key in Settings.");
      process.env.AI_PROTOCOL = "anthropic";
      assert.equal(serverHasNoModel(), false);
      assert.equal(askMissingWords("AI_TEXT_MODEL", true), "Ask isn’t set up on this server yet.");
    } finally {
      for (const name of names) if (saved[name] === undefined) delete process.env[name]; else process.env[name] = saved[name];
    }
  });

  await check("unconfirmedAmounts: a fact-shaped money object confirms, a person-given one does not", () => {
    const fact = (value: number, by = "engine") => JSON.stringify({ name: "short", value, unit: "money", currency: "JPY", case: "late", period: null, by });
    assert.deepEqual(unconfirmedAmounts("¥18,780 short.", [fact(18780)]), []);
    assert.deepEqual(unconfirmedAmounts("¥18,780 short.", [fact(18780, "person")]), ["¥18,780"]);
    assert.deepEqual(unconfirmedAmounts("You have $1,200.", [JSON.stringify({ unit: "money", value: 120000, currency: "USD", by: "engine" })]), []);
    assert.deepEqual(unconfirmedAmounts("14 days.", [JSON.stringify({ unit: "days", value: 14 })]), []);
  });

  await check("unconfirmedNumbers: each unit is confirmed only by a fact of the same unit", () => {
    const f = (unit: string, value: number | string, extra: object = {}) => ({ unit, value, by: "engine", period: null, ...extra });
    const facts = [f("money", 18780, { currency: "JPY" }), f("days", 14), f("percent", 12.2), f("date", "2026-11-27")];
    const today = "2026-11-14";
    const un = (text: string, fs = facts, person: string[] = []) => unconfirmedNumbers(text, fs, { today, person });
    assert.deepEqual(un("You are ¥18,780 short on Fri, Nov 27, in 14 days, up 12.2%."), []);
    assert.deepEqual(un("¥18,780 / 18,780円 / 約1.878万円"), []);
    assert.deepEqual(un("14日後、12.2％、11月27日"), []);
    assert.deepEqual(un("on the 27th, 2026-11-27, and today Nov 14"), []);
    // A wrong number of any unit is named.
    assert.deepEqual(un("¥18,000 short"), ["¥18,000"]);
    assert.deepEqual(un("in 15 days"), ["15 days"]);
    assert.deepEqual(un("up 12.9%"), ["12.9%"]);
    assert.deepEqual(un("on Nov 28"), ["Nov 28"]);
    assert.deepEqual(un("11月28日"), ["11月28日"]);
    // Only the same unit confirms.
    const onlyYen14 = [f("money", 14, { currency: "JPY" })];
    assert.deepEqual(un("14 days", onlyYen14), ["14 days"]);
    assert.deepEqual(un("¥14", [f("days", 14)]), ["¥14"]);
    assert.deepEqual(un("14%", [f("days", 14)]), ["14%"]);
    assert.deepEqual(un("the 20th", [f("days", 20)]), ["the 20th"]);
    assert.deepEqual(un("¥14", [f("money", 14, { currency: "USD" })]), ["¥14"]);
    // A by:"person" fact allows exactly its own value to be quoted back, and nothing more.
    assert.deepEqual(un("¥5,000", [f("money", 5000, { currency: "JPY", by: "person" })]), []);
    assert.deepEqual(un("¥5,001", [f("money", 5000, { currency: "JPY", by: "person" })]), ["¥5,001"]);
    assert.deepEqual(un("in 9 days", [f("days", 9, { by: "person" })]), []);
    assert.deepEqual(un("in 10 days", [f("days", 9, { by: "person" })]), ["10 days"]);
    assert.deepEqual(un("$5,000", [f("money", 5000, { currency: "JPY", by: "person" })]), ["$5,000"], "another currency is another number");
  });

  await check("unconfirmedNumbers: units, date forms and percentages", () => {
    const f = (unit: string, value: number | string, extra: object = {}) => ({ unit, value, by: "engine", period: null, ...extra });
    const today = "2026-11-14";
    const un = (text: string, fs: ReturnType<typeof f>[]) => unconfirmedNumbers(text, fs, { today });
    assert.deepEqual(un("14 days", [f("money", 14, { currency: "JPY" })]), ["14 days"], "a ¥14 fact does not confirm 14 days");
    assert.deepEqual(un("¥14", [f("days", 14)]), ["¥14"]);
    const dated = [f("date", "2026-11-27")];
    for (const form of ["2026-11-27", "11月27日", "2026年11月27日", "Fri, Nov 27", "Friday, November 27", "Fri Nov 27", "Nov. 27", "November 27, 2026", "27 Nov", "27th of November", "the 27th", "Nov 27th"]) {
      assert.deepEqual(un(`due ${form}`, dated), [], `${form} is confirmed by a date fact`);
    }
    for (const form of ["11月28日", "Nov 28", "28 Nov", "Friday, November 28", "the 28th", "2026-11-28"]) {
      assert.deepEqual(un(`due ${form}`, dated), [form.replace(/^due /, "")], `${form} is not`);
    }
    // A period confirms its dates: the day (on), or the range (from, to).
    assert.deepEqual(un("on Nov 20 and the 27th, Nov. 21", [f("money", 100, { currency: "JPY", period: { on: "2026-11-20" } }), f("money", 5, { currency: "JPY", period: { from: "2026-11-21", to: "2026-11-27" } })]), []);
    assert.deepEqual(un("Nov 22", [f("money", 5, { currency: "JPY", period: { from: "2026-11-21", to: "2026-11-27" } })]), ["Nov 22"], "only the ends of a range");
    // Percentages to one decimal.
    assert.deepEqual(un("up 12.2% and 7%", [f("percent", 12.2), f("percent", 7)]), []);
    assert.deepEqual(un("up 12.3%", [f("percent", 12.2)]), ["12.3%"]);
  });

  await check("unconfirmedNumbers: what the person said may be quoted back and confirms nothing else", () => {
    const f = (unit: string, value: number | string, extra: object = {}) => ({ unit, value, by: "engine", period: null, ...extra });
    const today = "2026-11-14";
    const engine = [f("money", 133770, { currency: "JPY" })];
    const person = ["Can I put ¥40,000 on Card A?", "remember I get paid 25% on the 5th, 20日後 maybe"];
    const un = (text: string, fs = engine) => unconfirmedNumbers(text, fs, { today, person });
    assert.deepEqual(un("¥40,000 on Card A leaves ¥133,770."), [], "the person's amount is quoted back");
    assert.deepEqual(un("About 4万円 on Card A."), [], "in another written form, same value");
    assert.deepEqual(un("¥41,000 on Card A leaves ¥133,770."), ["¥41,000"], "a different number is not confirmed because the person said something");
    assert.deepEqual(un("¥40,000 on Card A leaves ¥99,999."), ["¥99,999"], "an engine claim needs an engine fact");
    assert.deepEqual(un("$40,000"), ["$40,000"], "the unit must match: the person said yen");
    assert.deepEqual(un("on the 5th, 25%, in 20 days"), []);
    assert.deepEqual(un("on the 6th, 26%, in 21 days"), ["the 6th", "26%", "21 days"]);
    assert.deepEqual(unconfirmedNumbers("¥40,000 on Card A", engine, { today }), ["¥40,000"], "no person texts, no quoting");
    // Limit, by value only: the person's ¥40,000 also passes as "¥40,000 left", a claim no engine fact backs.
    // Numbers cannot tell a quote from a claim; the reading line and the picture carry the engine's own figure.
    assert.deepEqual(un("You have ¥40,000 left."), [], "documented limit: a quoted value can be said as a claim");
  });

  await check("unconfirmedNumbers: a household snapshot's text confirms nothing; unconfirmedAmounts still reads plain text", () => {
    const snapshot = "Safe to spend ¥123,456. Short ¥18,780 on Nov 27 in 13 days, up 4.5%.";
    assert.deepEqual(unconfirmedAmounts("¥123,456 safe.", [snapshot]), [], "the old check trusts any plain text source");
    assert.deepEqual(unconfirmedNumbers("¥123,456 safe, 13 days, 4.5%, Nov 27", [], { today: "2026-11-14", person: [] }), ["Nov 27", "¥123,456", "4.5%", "13 days"], "the new check reads facts only");
  });

  await check("unconfirmedNumbers: model-style paraphrases of the engine's lines", () => {
    const f = (unit: string, value: number | string, extra: object = {}) => ({ unit, value, by: "engine", period: null, ...extra });
    const facts = [f("money", 18780, { currency: "JPY", period: { on: "2026-11-27" } }), f("days", 13), f("percent", 12.2)];
    const un = (text: string) => unconfirmedNumbers(text, facts, { today: "2026-11-14" });
    assert.deepEqual(un("You're about ¥18,780 short on Friday, November 27."), []);
    assert.deepEqual(un("That is in 13 days, on 27 Nov."), []);
    assert.deepEqual(un("18,780円 short on 11月27日。"), []);
    assert.deepEqual(un("You're short ¥18,780 on Fri, Nov. 27, 13 days away, 12.2% under."), []);
    assert.deepEqual(un("in 12 days"), ["12 days"]);
    // Rounded forms are flagged: only the engine's exact figure is a fact, so ¥18.8k (18,800) is a different number from 18,780.
    assert.deepEqual(un("about ¥18.8k short"), ["¥18.8k"]);
    assert.deepEqual(un("¥18.78k short"), [], "the same value written with a scale is the same number");
    assert.deepEqual(un("a market 5 days off"), ["5 days"], "a word starting with a month's letters is not a date");
  });

  await check("the tested list is empty until the evaluation fills it, and isTested matches provider and model", () => {
    assert.deepEqual(TESTED, []);
    assert.equal(isTested("openai", "m-text"), false);
    assert.deepEqual(PROVIDERS.map(p => p.id), ["anthropic", "openai", "gemini", "openrouter", "groq", "mistral", "custom"]);
  });

  console.log(`AI layer checks passed (${passed}).`);
}
main().catch(error => { console.error("AI layer checks failed", error instanceof Error ? error.stack?.split("\n").slice(0, 8).join("\n") : error); process.exitCode = 1; });
