// Opt-in HTTP checks against a running local app. Creates fictional Try-it data only.
// node scripts/frontend-check.mjs --run http://127.0.0.1:3123
// --extra checks Home reload and reader pages, and saves/retries a fictional draft without sending.
// Timings include the complete response body; redirects are measured separately.
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";

const args = process.argv.slice(2);
if (args.length !== 2 || !["--run", "--guards", "--extra"].includes(args[0])) {
  console.error("Usage: node scripts/frontend-check.mjs --run|--guards|--extra http://127.0.0.1:3123");
  process.exit(2);
}
let base;
try {
  base = new URL(args[1]);
  if (base.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(base.hostname)
    || base.username || base.password || base.pathname !== "/" || base.search || base.hash) throw new Error();
} catch {
  console.error("FAIL configuration: provide an HTTP loopback origin only");
  process.exit(2);
}

let cookie = "";
let failures = 0;
let tryItExport = "";
function expect(condition, code) { if (!condition) throw new Error(code); }
async function request(path, { method = "GET", form, json, session = cookie, extraHeaders = {} } = {}) {
  // Every URL is selected by this script; redirects never leave the local origin.
  expect(path.startsWith("/") && !path.startsWith("//"), "invalid-local-path");
  const headers = { Origin: base.origin, "Sec-Fetch-Site": "same-origin", ...extraHeaders };
  if (session) headers.Cookie = session;
  if (json) headers["Content-Type"] = "application/json";
  const response = await fetch(new URL(path, base), {
    method, headers, redirect: "manual", signal: AbortSignal.timeout(30_000),
    body: form instanceof FormData ? form : form ? new URLSearchParams(form) : json ? JSON.stringify(json) : undefined,
  });
  const body = await response.text();
  return { response, body };
}
async function step(type, label, run) {
  const start = performance.now();
  try {
    const result = await run();
    console.log(`PASS ${type} ${label} ${Math.round(performance.now() - start)}ms`);
    return result;
  } catch (error) {
    failures++;
    // Never emit response bodies, URLs, identifiers, cookies or raw fetch errors.
    const reason = error?.name === "TimeoutError" ? "timeout" : "check-failed";
    console.log(`FAIL ${type} ${label} ${Math.round(performance.now() - start)}ms ${reason}`);
    if (process.env.CHECK_DEBUG && error instanceof Error && /^[a-z0-9-]+$/.test(error.message)) console.log(`  code ${error.message}`); // expect codes only, never a body
    return undefined;
  }
}
function markup(html) {
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
}
function text(html) {
  return markup(html).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
}
function flight(html) {
  // PPR may deliver the completed server tree only as inline Flight chunks.
  // Parse the transport's JSON argument, never evaluate script or accept its source.
  const chunks = [];
  for (const [, source] of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
    const argument = source.match(/self\.__next_f\.push\((\[[\s\S]*\])\)\s*;?\s*$/)?.[1];
    if (!argument) continue;
    try {
      const chunk = JSON.parse(argument);
      if (chunk[0] === 1 && typeof chunk[1] === "string") chunks.push(chunk[1]);
    } catch { /* Invalid/non-Flight scripts cannot satisfy a page assertion. */ }
  }
  return chunks.join("");
}
function pageContent(html) { return text(html) + " " + flight(html); }
// The page without the bell: the bell lists the newest events (their titles name bills and pins) on every page, so "not on this page" leaves it out.
function textWithoutBell(html) { const bell = /<section id="shell-notifications"[\s\S]*?<\/section>/; expect(bell.test(html), "bell-present"); return text(html.replace(bell, "")); }
// The sentence is built from several text nodes, so its words can sit apart ("rent , your"): close the gap before punctuation.
const plain = (content) => content.replace(/\s+([,.])/g, "$1");
async function page(path, content) {
  const result = await request(path);
  expect(result.response.status === 200, "page-status");
  expect(content.test(pageContent(result.body)), "page-content");
  expect(!/Something went wrong|Application error:/.test(pageContent(result.body)), "page-error");
  return result.body;
}
// A bill's page is /bills/<id>; the list links each row there.
async function billPath(name, not) {
  const html = markup((await request("/bills")).body);
  const rows = [...html.matchAll(/<a\b[^>]*href="\/bills\/([0-9a-f-]{36})"[^>]*>([\s\S]*?)<\/a>/g)].filter(([, , inner]) => text(inner).includes(name) && !(not && not.test(text(inner))));
  expect(rows.length > 0, "bill-link-" + name);
  return `/bills/${rows[0][1]}`;
}
async function events() {
  const result = await request("/api/events");
  expect(result.response.status === 200, "events-status");
  const data = JSON.parse(result.body);
  expect(Array.isArray(data.events) && Number.isInteger(data.feed?.unread), "events-shape");
  return data;
}
// The Activity page is gone: the bell and every check read the same events. Some event's title or body must match.
async function sawEvent(pattern) {
  const found = (await events()).events.find(event => pattern.test(event.title) || pattern.test(event.body ?? ""));
  expect(found, "event-seen");
  return found;
}
const SETUP_START = "/setup?step=bank"; // where "Start planning" lands: the setup steps
function adopt(result, fetchForm = false, to = "/") {
  const { status, headers } = result.response;
  expect(fetchForm ? status === 204 && headers.get("x-form-redirect") === to && !headers.has("location") && result.body === ""
    : status === 303 && headers.get("location") === to, "session-redirect");
  const next = result.response.headers.get("set-cookie")?.match(/(?:^|,\s*)household=([^;]+)/)?.[1];
  expect(next && /^[A-Za-z0-9_-]{43}$/.test(next), "session-cookie"); // a Try it token, never the household id (D34)
  cookie = "household=" + next;
}

function draftFormValues(html) {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const form = [...html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)]
    .find(([, attributes]) => /action="\/api\/invoices\/draft"/.test(attributes))?.[2];
  if (form) {
    const input = [...form.matchAll(/<input\b[^>]*>/gi)].find(([tag]) => /name="id"/.test(tag))?.[0];
    const select = [...form.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/gi)]
      .find(([, attributes]) => /name="clientId"/.test(attributes))?.[2];
    const id = input?.match(/value="([^"]+)"/)?.[1];
    const clientId = select?.match(/<option\b[^>]*value="([^"]+)"/)?.[1];
    if (uuid.test(id ?? "") && uuid.test(clientId ?? "")) return { id, clientId };
  }
  // Worker PPR can supply the form as Flight element tuples and references.
  // Decode only JSON records and walk their props; never execute transport code.
  const records = new Map();
  for (const line of flight(html).split("\n")) {
    const match = line.match(/^([0-9a-f]+):([\[{].*)$/i);
    if (match) {
      try { records.set(match[1], JSON.parse(match[2])); } catch { /* Not a JSON record. */ }
    }
  }
  function walk(value, visit, seen = new Set()) {
    if (typeof value === "string") {
      const ref = value.match(/^\$(?:L)?([0-9a-f]+)$/i)?.[1];
      if (ref && records.has(ref) && !seen.has(ref)) {
        seen.add(ref);
        walk(records.get(ref), visit, seen);
      }
    } else if (Array.isArray(value)) {
      if (value[0] === "$" && typeof value[1] === "string" && value[3]) visit(value[1], value[3]);
      for (const child of value) walk(child, visit, seen);
    } else if (value && typeof value === "object") {
      for (const child of Object.values(value)) walk(child, visit, seen);
    }
  }
  let values;
  for (const record of records.values()) walk(record, (tag, props) => {
    // The form is the shared ApiForm in a client component, so on the Worker its tag is a client reference, not "form".
    if (props.action !== "/api/invoices/draft") return;
    let id, clientId;
    walk(props.children, (field, attributes) => {
      if (field === "input" && attributes.name === "id") id = attributes.value;
      if (field === "select" && attributes.name === "clientId") {
        walk(attributes.children, (option, attributes) => {
          if (option === "option" && !clientId) clientId = attributes.value;
        });
      }
    });
    if (uuid.test(id ?? "") && uuid.test(clientId ?? "")) values = { id, clientId };
  });
  expect(values, "draft-form-fields");
  return values;
}

// These requests carry no session, send no email or invoice and follow no redirects.
if (args[0] === "--guards") {
  const checks = [
    ["sign-in-invalid-email", "/api/auth/link", { method: "POST", form: { email: "invalid" } }, 400],
    ["sign-in-json-body", "/api/auth/link", { method: "POST", json: { email: "a@example.com" } }, 400],
    ["callback-hands-off", "/api/auth/callback?code=x", {}, 303, "/signing-in?code=x"],
    ["finish-without-code", "/api/auth/finish", {}, 303, "/login?expired=1"],
    ["approve-without-household", "/api/approve", { method: "POST" }, 401],
    ["pay-as-client-without-household", "/api/try/pay-as-client", { method: "POST", session: "", form: { id: "00000000-0000-4000-8000-000000000000" } }, 401],
    ["pay-as-client-cross-origin", "/api/try/pay-as-client", { method: "POST", session: "", form: { id: "00000000-0000-4000-8000-000000000000" }, extraHeaders: { Origin: "http://cross-origin.test", "Sec-Fetch-Site": "cross-site" } }, 403],
    ["account-delete-without-login", "/api/account", { method: "POST", session: "", form: { confirmation: "delete" } }, 401],
    ["account-delete-cross-origin", "/api/account", { method: "POST", session: "", form: { confirmation: "delete" }, extraHeaders: { Origin: "http://cross-origin.test", "Sec-Fetch-Site": "cross-site" } }, 403],
    ["try-delete-without-household", "/api/try/delete", { method: "POST", session: "" }, 403],
    ["try-delete-cross-origin", "/api/try/delete", { method: "POST", session: "", extraHeaders: { Origin: "http://cross-origin.test", "Sec-Fetch-Site": "cross-site" } }, 403],
    ["invoice-offered-without-household", "/api/invoices/offered", { method: "POST", session: "", form: { id: "00000000-0000-4000-8000-000000000000" } }, 401],
    ["invoice-offered-cross-origin", "/api/invoices/offered", { method: "POST", session: "", form: { id: "00000000-0000-4000-8000-000000000000" }, extraHeaders: { Origin: "http://cross-origin.test", "Sec-Fetch-Site": "cross-site" } }, 403],
    ["invoice-end-without-household", "/api/invoices/end", { method: "POST", session: "", form: { id: "00000000-0000-4000-8000-000000000000" } }, 401],
    ["invoice-end-cross-origin", "/api/invoices/end", { method: "POST", session: "", form: { id: "00000000-0000-4000-8000-000000000000" }, extraHeaders: { Origin: "http://cross-origin.test", "Sec-Fetch-Site": "cross-site" } }, 403],
    ["invoice-match-without-household", "/api/invoices/match", { method: "POST", session: "", form: { id: "00000000-0000-4000-8000-000000000000", paymentId: "00000000-0000-4000-8000-000000000001" } }, 401],
    ["invoice-match-cross-origin", "/api/invoices/match", { method: "POST", session: "", form: { id: "00000000-0000-4000-8000-000000000000", paymentId: "00000000-0000-4000-8000-000000000001" }, extraHeaders: { Origin: "http://cross-origin.test", "Sec-Fetch-Site": "cross-site" } }, 403],
    // The client's Pay is public (no session) but only from this site's own page, and a token that is not a link opens nothing.
    ["pay-cross-origin", "/api/pay", { method: "POST", session: "", form: { token: "x" }, extraHeaders: { Origin: "http://cross-origin.test", "Sec-Fetch-Site": "cross-site" } }, 403],
    ["pay-unknown-token", "/api/pay", { method: "POST", session: "", form: { token: "not-a-payment-link" } }, 404],
    ["unsigned-webhook", "/api/paypal/webhook", { method: "POST", json: { id: "fictional-check", event_type: "PAYMENT.CAPTURE.COMPLETED" } }, 400],
    ["events-without-household", "/api/events", { session: "" }, 401],
    ["events-mark-read-without-household", "/api/events", { method: "POST", session: "", json: { ids: [] } }, 401],
    ["private-upload-without-household", "/api/upload", { method: "POST" }, 401],
    ["inbound-without-worker-origin", "/api/inbound", { method: "POST" }, 403],
    ["mcp-without-bearer", "/api/mcp", { method: "POST" }, 401],
    ["mcp-issue-without-household", "/api/mcp/tokens", { method: "POST" }, 401],
    ["ai-model-without-household", "/api/settings/ai-model", { method: "POST" }, 401],
    ["ai-model-cross-origin", "/api/settings/ai-model", { method: "POST", session: "", form: { kind: "default" }, extraHeaders: { Origin: "http://cross-origin.test", "Sec-Fetch-Site": "cross-site" } }, 403],
    ["canvases-without-household", "/api/canvases", { method: "POST", session: "", form: { kind: "unpin", id: "x", returnTo: "/" } }, 401],
    ["canvases-cross-origin", "/api/canvases", { method: "POST", session: "", form: { kind: "unpin", id: "x", returnTo: "/" }, extraHeaders: { Origin: "http://cross-origin.test", "Sec-Fetch-Site": "cross-site" } }, 403],
    ["ask-thumb-without-household", "/api/ask/thumb", { method: "POST", session: "", json: { id: "x", thumb: "up" } }, 401],
    ["ask-thumb-cross-origin", "/api/ask/thumb", { method: "POST", session: "", json: { id: "x", thumb: "up" }, extraHeaders: { Origin: "http://cross-origin.test", "Sec-Fetch-Site": "cross-site" } }, 403],
    ["ask-document-without-household", "/api/ask/document", { method: "POST", session: "" }, 401],
    ["ask-document-get-without-household", "/api/ask/document?id=00000000-0000-4000-8000-000000000000", { session: "" }, 401],
    ["ask-document-cross-origin", "/api/ask/document", { method: "POST", session: "", extraHeaders: { Origin: "http://cross-origin.test", "Sec-Fetch-Site": "cross-site" } }, 403],
    ["ask-without-household", "/api/ask", { method: "POST", session: "", json: { id: "x" } }, 401],
    ["confirm-and-remember-without-household", "/api/confirm", { method: "POST", session: "", form: { kind: "reading", id: "00000000-0000-4000-8000-000000000000", remember: "on" } }, 401],
    ["confirm-and-remember-cross-origin", "/api/confirm", { method: "POST", session: "", form: { kind: "reading", id: "00000000-0000-4000-8000-000000000000", remember: "on" }, extraHeaders: { Origin: "http://cross-origin.test", "Sec-Fetch-Site": "cross-site" } }, 403],
    ["export-without-household", "/api/export", { method: "POST" }, 401],
    ["people-without-household", "/api/people", { method: "POST" }, 401],
    ["own-categories-without-household", "/api/own-categories", { method: "POST", session: "", form: { kind: "add", category: "food", name: "Probe" } }, 401],
    ["own-categories-cross-origin", "/api/own-categories", { method: "POST", session: "", form: { kind: "add", category: "food", name: "Probe" }, extraHeaders: { Origin: "http://cross-origin.test", "Sec-Fetch-Site": "cross-site" } }, 403],
    ["bill-fill-without-household", "/api/bills", { method: "POST", session: "", form: { kind: "fill", id: "x", amount: "1000", returnTo: "/to-check" } }, 401],
    ["bill-fill-cross-origin", "/api/bills", { method: "POST", session: "", form: { kind: "fill", id: "x", amount: "1000", returnTo: "/to-check" }, extraHeaders: { Origin: "http://cross-origin.test", "Sec-Fetch-Site": "cross-site" } }, 403],
    ["bill-with-schedule-without-household", "/api/bills", { method: "POST", form: { id: "x", biller: "Fictional Cloud", amount: "12000", due: "2026-12-01", category: "subscriptions", repeat: "year", cancelBy: "2026-11-20" } }, 401],
    ["settle-without-household", "/api/settle", { method: "POST" }, 401],
    ["canvas-resolve-without-household", "/api/canvas/resolve", { method: "POST", session: "", json: { recipe: { version: 1, title: "Probe", blocks: [] } } }, 401],
    ["canvas-resolve-cross-origin", "/api/canvas/resolve", { method: "POST", session: "", json: { recipe: { version: 1, title: "Probe", blocks: [] } }, extraHeaders: { Origin: "http://cross-origin.test", "Sec-Fetch-Site": "cross-site" } }, 403],
    ["memory-without-household", "/api/memory", { method: "POST", session: "", form: { kind: "forget_all", returnTo: "/memory" } }, 401],
    ["memory-cross-origin", "/api/memory", { method: "POST", session: "", form: { kind: "forget_all", returnTo: "/memory" }, extraHeaders: { Origin: "http://cross-origin.test", "Sec-Fetch-Site": "cross-site" } }, 403],
    ["remove-without-household", "/api/remove", { method: "POST" }, 401],
    ["add-view-without-household", "/api/add/view", { session: "" }, 401],
    ["add-view-cross-origin", "/api/add/view", { session: "", extraHeaders: { Origin: "http://cross-origin.test", "Sec-Fetch-Site": "cross-site" } }, 403],
    ["data-without-household", "/api/data", { method: "POST", session: "", form: { kind: "delete_kind", what: "memory", returnTo: "/settings" } }, 401],
    ["data-cross-origin", "/api/data", { method: "POST", session: "", form: { kind: "delete_kind", what: "memory", returnTo: "/settings" }, extraHeaders: { Origin: "http://cross-origin.test", "Sec-Fetch-Site": "cross-site" } }, 403],
    ["restore-without-household", "/api/restore", { method: "POST", session: "", json: { version: 2 } }, 401],
    ["restore-cross-origin", "/api/restore", { method: "POST", session: "", json: { version: 2 }, extraHeaders: { Origin: "http://cross-origin.test", "Sec-Fetch-Site": "cross-site" } }, 403],
    ["privacy-page-without-cookie", "/privacy", { session: "" }, 200],
    ["cron-without-bearer", "/api/cron", {}, 401],
  ];
  for (const [label, path, options, status, location] of checks) {
    await step("guard", label, async () => {
      const { response, body } = await request(path, options);
      expect(response.status === status, "guard-status");
      if (label === "privacy-page-without-cookie") {
        const plain = text(body);
        for (const word of ["Supabase", "Tokyo", "seven days"]) expect(plain.includes(word), "privacy-" + word);
        // The host line streams in after a fallback; the full streamed HTML holds its final text.
        expect(plain.includes("This server has no AI model set up.") || /By default, questions and documents go to [a-z0-9-]+(?:\.[a-z0-9-]+)+(?::\d+)?\./.test(plain), "privacy-ai-host-line");
      }
      if (location) expect(response.headers.get("location") === location, "guard-redirect");
    });
  }
console.log(`${failures ? "FAIL" : "PASS"} summary ${failures} failed`);
  process.exit(failures ? 1 : 0);
}

await step("page", "landing-and-start-link-to-privacy", async () => {
  for (const path of ["/", "/start"]) {
    const result = await request(path, { session: "" });
    expect(result.response.status === 200 && /href="\/privacy"[^>]*>[^<]*Privacy/.test(result.body), "privacy-link-" + path);
  }
});
await step("action", "create-fictional-session", async () => adopt(await request("/api/try")));
if (!cookie) process.exit(1); // Never proceed against an unverified session.
if (args[0] === "--extra") {
  await step("page", "home-reload-stays-server-rendered", async () => {
    const navigation = { Accept: "text/html", "Sec-Fetch-Dest": "document" };
    expect((await request("/", { extraHeaders: navigation })).response.status === 200, "home-initial-status");
    const { response, body } = await request("/", { extraHeaders: { ...navigation, "Cache-Control": "max-age=0" } });
    expect(response.status === 200, "home-reload-status");
    const html = markup(body);
    // React defines $RX on healthy pages too. Calling it for a boundary means the server left that boundary to the client.
    expect(!/\$RX\s*\(\s*["']B:[^"']+["']/.test(body)
      && !/<template\b[^>]*\bdata-dgst(?:\s|=|>)/i.test(html) && !/<!--\$!-->/.test(html), "home-reload-client-render");
    expect(/<article\b[^>]*\bclass="money-home"/i.test(html) && /18,780/.test(text(html)), "home-reload-markup");
  });
  await step("page", "authenticated-upload", () => page("/upload", /Upload a bill or receipt/));
  for (const [label, path] of [["clients", "/api/clients"], ["remove", "/api/remove"]]) {
    await step("guard", "json-body-to-" + label, async () => {
      const result = await request(path, { method: "POST", json: { kind: "bill" } });
      expect(result.response.status === 400 && result.body === "Check the required fields and try again.", "json-body-" + label);
    });
  }
  await step("page", "to-check", () => page("/to-check", /Hikari Denki/));
  await step("page", "options", () => page("/options", /Compare total extra cost/));
  const fields = await step("page", "new-invoice-form", async () => draftFormValues(await page("/invoices/new", /New invoice/)));
  const draft = fields && { ...fields, item: "Fictional verification design", amount: "12.34", note: "Fictional local check only" };
  for (const label of ["create-fictional-draft", "retry-fictional-draft"]) {
    await step("action", label, async () => {
      expect(draft, "draft-form-required");
      const result = await request("/api/invoices/draft", { method: "POST", form: draft });
      expect(result.response.status === 303 && result.response.headers.get("location") === `/invoices/${draft.id}`, "draft-result");
    });
  }
  await step("read", "draft-single-event", async () => {
    expect(draft, "draft-form-required");
    const data = await events();
    expect(data.events.filter(event => event.kind === "invoice_drafted" && event.refType === "invoice" && event.refId === draft.id).length === 1,
      "draft-event-count");
  });
  await step("page", "own-draft-review-read-only", async () => {
    expect(draft, "draft-form-required");
    const html = await page(`/invoices/${draft.id}`, /Review invoice/);
    expect(/Fictional verification design/.test(pageContent(html)) && /12\.34/.test(pageContent(html)), "draft-review-values");
  });
  await step("action", "reset-fictional-session", async () => adopt(await request("/api/try/reset", { method: "POST" })));
  // Nov 5 walk: edit a bill from Settings, remove a person once settled, delete a cookie household (last: it drops the cookie).
  await step("action", "nov5-try-it-session", async () => adopt(await request("/api/try", { session: "" })));
  await step("page", "nov5-settings-bill-rows-have-edit-and-a-repeating-bill-asks-from-when", async () => {
    const html = await page(await billPath("Rent"), /Edit Rent/);
    const content = plain(pageContent(html));
    expect(/aria-label="Edit Rent"/.test(html) && /New amount from/.test(content) && /Choose the first due date, [A-Z][a-z]{2} \d{1,2}, to correct every one\./.test(content), "nov5-edit-form");
  });
  await step("action", "nov5-edit-a-bill-category-and-amount", async () => {
    const id = randomUUID();
    const add = await request("/api/bills", { method: "POST", form: { id, biller: "Fictional noodle stand", amount: "1,200", due: "2026-11-20", category: "other", businessShare: "personal" } });
    expect(add.response.status === 303, "nov5-add");
    const edit = { kind: "edit", id, biller: "Fictional noodle stand", amount: "980", due: "2026-11-20", category: "food", businessShare: "personal", memberId: "", paidByMemberId: "", returnTo: `/bills/${id}` };
    const saved = await request("/api/bills", { method: "POST", form: edit, extraHeaders: { "x-form-fetch": "1" } });
    expect(saved.response.status === 204 && saved.response.headers.get("x-form-redirect") === `/bills/${id}`, "nov5-edit-result");
    const again = await request("/api/bills", { method: "POST", form: edit });
    expect(again.response.status === 303 && again.response.headers.get("location") === `/bills/${id}`, "nov5-edit-native-result");
    const changed = (await events()).events.filter(event => event.kind === "bill_changed" && event.refId === id);
    expect(changed.length === 1 && changed[0].body === "Amount ¥1,200 → ¥980 · Category Other → Food" && changed[0].madeBy === "form", "nov5-one-bill-changed-event");
    expect(/Fictional noodle stand bill changed/.test(changed[0].title), "nov5-bill-changed-title");
    const removed = await request("/api/remove", { method: "POST", form: { kind: "bill", id, returnTo: "/bills" } });
    expect(removed.response.status === 303, "nov5-remove");
  });
  await step("guard", "nov5-bills-unknown-kind-and-json-refused", async () => {
    const bogus = await request("/api/bills", { method: "POST", form: { kind: "rename", id: randomUUID() } });
    const json = await request("/api/bills", { method: "POST", json: { kind: "edit" } });
    expect(bogus.response.status === 400 && json.response.status === 400 && json.body === "Check the required fields and try again.", "nov5-bills-bad-kind");
  });
  await step("action", "nov5-remove-a-person-only-once-settled", async () => {
    const added = await request("/api/people", { method: "POST", form: { kind: "add", name: "Fictional Wife" } });
    expect(added.response.status === 303 && added.response.headers.get("location") === "/", "nov5-person-added");
    const html = await page("/household/people", /Fictional Wife/);
    const ids = [...html.matchAll(/name="name:([0-9a-f-]{36})"/g)].map(match => match[1]);
    expect(ids.length === 2, "nov5-two-people");
    const wife = ids[1];
    const content = plain(pageContent(html));
    expect(content.includes("Fictional Wife’s bills become shared and paid by Ben.") && /aria-label="Remove Fictional Wife"/.test(html), "nov5-remove-note");
    const bill = await request("/api/bills", { method: "POST", form: { id: randomUUID(), biller: "Fictional groceries", amount: "30,000", due: "2026-11-14", category: "food", businessShare: "personal", paidByMemberId: wife } });
    expect(bill.response.status === 303, "nov5-shared-bill");
    const owed = await request("/api/people", { method: "POST", form: { kind: "remove", id: wife, returnTo: "/household/people" } });
    expect(owed.response.status === 400 && owed.body === "Settle up with Fictional Wife first.", "nov5-settle-first");
    const owner = await request("/api/people", { method: "POST", form: { kind: "remove", id: ids[0], returnTo: "/household/people" } });
    expect(owner.response.status === 400 && owner.body === "The household’s owner cannot be removed", "nov5-owner-stays");
    const settled = await request("/api/settle", { method: "POST", form: { returnTo: "/" } });
    expect(settled.response.status === 303, "nov5-settled");
    const removed = await request("/api/people", { method: "POST", form: { kind: "remove", id: wife, returnTo: "/household/people" }, extraHeaders: { "x-form-fetch": "1" } });
    expect(removed.response.status === 204 && removed.response.headers.get("x-form-redirect") === "/household/people", "nov5-removed");
    const last = await request("/api/people", { method: "POST", form: { kind: "remove", id: ids[0], returnTo: "/household/people" } });
    expect(last.response.status === 400 && last.body === "The last person in a household cannot be removed", "nov5-last-person-stays");
    const gone = await request("/api/people", { method: "POST", form: { kind: "remove", id: wife, returnTo: "/household/people" } });
    expect(gone.response.status === 400 && gone.body === "Choose a person of this household", "nov5-removed-twice");
    expect((await events()).events.some(event => event.kind === "person_removed" && event.title === "Fictional Wife left the household"), "nov5-person-removed-event");
    expect(!/Fictional Wife/.test(pageContent(await page("/household/people", /People/))), "nov5-settings-without-wife");
  });
  await step("action", "nov5-delete-a-cookie-household", async () => {
    const html = await page("/settings/account", /Delete this Try it household/);
    expect(plain(pageContent(html)).includes("Its sample data is removed now, and this browser goes back to the start page.") && /action="\/api\/try\/delete"/.test(html), "nov5-delete-words");
    const left = await request("/api/try/delete", { method: "POST" });
    expect(left.response.status === 303 && left.response.headers.get("location") === "/" && /household=;|household=(?:""|);/.test(left.response.headers.get("set-cookie") ?? ""), "nov5-deleted");
  });
  // Stage 17 import (D53): a statement's rows go to /api/import as JSON for one card; the same rows again are all skipped.
  {
    const statementRows = [
      { date: "2026-11-01", merchant: "Fictional Import Market", amountMinor: 2480, category: "food" },
      { date: "2026-11-02", merchant: "Fictional Import Kissa", amountMinor: 650, category: "food" },
      { date: "2026-11-03", merchant: "Fictional Import Metro", amountMinor: 1200, category: "transport" },
    ];
    let importCard;
    await step("action", "stage17-import-try-it-session", async () => adopt(await request("/api/try", { session: "" })));
    await step("page", "stage17-cards-offers-import-a-statement", async () => {
      const html = await page("/cards", /Import a statement[\s\S]*Statement file \(CSV\)/);
      importCard = /<option value="([0-9a-f-]{36})"[^>]*>Card B<\/option>/.exec(html)?.[1];
      expect(importCard !== undefined, "s17-card-option");
    });
    await step("action", "stage17-import-three-rows", async () => {
      const result = await request("/api/import", { method: "POST", json: { cardId: importCard, rows: statementRows } });
      expect(result.response.status === 200 && result.body === JSON.stringify({ added: 3, skipped: 0 }), "s17-first-import");
    });
    await step("read", "stage17-events-name-the-import", () => sawEvent(/Imported 3 charges to Card B from a statement/));
    await step("guard", "stage17-import-form-body-refused", async () => {
      const result = await request("/api/import", { method: "POST", form: { cardId: importCard } });
      expect(result.response.status === 400 && result.body === "Check the required fields and try again.", "s17-form-body");
    });
    // Stage 37 own categories (D75): add, refuse a duplicate and a category label, file a charge and every same-named one, rename, merge, remove.
    await step("action", "stage37-own-categories-add-refuse-file-rename-merge-remove", async () => {
      const own = (form) => request("/api/own-categories", { method: "POST", form });
      expect((await own({ kind: "rename" })).response.status === 400, "s37-bad-kind");
      const tea = await own({ kind: "add", category: "food", name: "Fictional tea" });
      expect(tea.response.status === 200 && tea.body === "Added Fictional tea.", "s37-add");
      const same = await own({ kind: "add", category: "food", name: "fictional  TEA" });
      expect(same.response.status === 400 && same.body === "You already have Fictional tea under Food.", "s37-duplicate");
      const label = await own({ kind: "add", category: "food", name: "Food" });
      expect(label.response.status === 400 && label.body === "Food is already a category.", "s37-label");
      const matcha = await own({ kind: "add", category: "food", name: "Fictional matcha", businessShare: "business" });
      expect(matcha.response.status === 200, "s37-add-with-default-share");
      const html = await page("/spending/categories", /Your categories/);
      const idOf = (name) => new RegExp(`id="own-([0-9a-f-]{36})"[^>]*><p>${name}`).exec(html)?.[1];
      const teaId = idOf("Fictional tea"), matchaId = idOf("Fictional matcha");
      expect(teaId !== undefined && matchaId !== undefined, "s37-categories-list-both");
      const first = randomUUID(), second = randomUUID();
      for (const [id, date] of [[first, "2026-11-02"], [second, "2026-11-03"]]) {
        const charge = await request("/api/charges", { method: "POST", form: { id, cardId: importCard, merchant: "Fictional Tea House", amount: "700", date, category: "food", businessShare: "personal", ownCategory: "" } });
        expect(charge.response.status === 303, "s37-charge");
      }
      const filed = await own({ kind: "file", item: "charge", id: first, ownCategoryId: teaId, everySame: "on" });
      expect(filed.response.status === 200 && filed.body === "Filed 2 items", "s37-file-every-same");
      const wrongKind = await own({ kind: "file", item: "charge", id: first, ownCategoryId: randomUUID() });
      expect(wrongKind.response.status === 400 && wrongKind.body === "Choose one of your categories.", "s37-file-foreign-id");
      const renamed = await own({ kind: "save", id: teaId, name: "Fictional chai" });
      expect(renamed.response.status === 200 && renamed.body === "Saved", "s37-rename");
      const taken = await own({ kind: "save", id: teaId, name: "Fictional matcha" });
      expect(taken.response.status === 400 && taken.body === "You already have Fictional matcha under Food.", "s37-rename-duplicate");
      await page("/spending/categories", /Fictional chai/);
      const merged = await own({ kind: "merge", id: teaId, into: matchaId });
      expect(merged.response.status === 200 && merged.body === "Merged. 2 items moved.", "s37-merge");
      const removed = await own({ kind: "remove", id: matchaId });
      expect(removed.response.status === 200 && removed.body === "Removed", "s37-remove");
      const again = await own({ kind: "remove", id: matchaId });
      expect(again.response.status === 400 && again.body === "Choose one of your categories.", "s37-remove-twice");
    });
  }
  // Stage 18 varies (D54): a monthly bill whose amount varies is "about" its estimate on Home until that month's real bill is in;
  // one-offs with the same name key and category link to it (the event says so) and a real bill for its month is counted once.
  {
    const gasBill = (over) => ({ id: randomUUID(), biller: "Sakura Gas", amount: "6,000", due: "2026-12-10", category: "utilities", businessShare: "personal", ...over });
    const comingUp = async () => {
      const html = await page("/", /Coming up/);
      // Count server-rendered rows once. Inline Flight repeats the same amounts.
      const section = html.indexOf('id="coming-up"');
      expect(section !== -1, "s18v-coming-up-markup");
      return plain(text(html.slice(section)));
    };
    const linkedBody = async (id) => (await events()).events.find(event => event.kind === "bill_added" && event.refId === id)?.body;
    await step("action", "stage18-varies-try-it-session", async () => adopt(await request("/api/try", { session: "" })));
    await step("action", "stage18-varies-add-a-varying-monthly-bill", async () => {
      const series = gasBill({ repeat: "month", amountVaries: "on" });
      const added = await request("/api/bills", { method: "POST", form: series });
      expect(added.response.status === 303, "s18v-add-series");
      expect(await linkedBody(series.id) === "Amount varies every month", "s18v-series-event");
      expect((await comingUp()).includes("about ¥6,000"), "s18v-about-6000");
    });
    await step("action", "stage18-varies-past-real-bills-link-and-the-estimate-is-their-average", async () => {
      const october = gasBill({ biller: "Sakura Gas 10月分", amount: "5,400", due: "2026-10-12" });
      const november = gasBill({ biller: "Sakura Gas 11月分", amount: "6,600", due: "2026-11-12" });
      for (const bill of [october, november]) {
        const added = await request("/api/bills", { method: "POST", form: bill });
        expect(added.response.status === 303, "s18v-add-real");
        expect(await linkedBody(bill.id) === "Linked to Sakura Gas: counts toward its estimate", "s18v-linked-event");
      }
      expect((await comingUp()).includes("about ¥6,000"), "s18v-average-6000");
    });
    await step("action", "stage18-varies-a-real-bill-for-its-month-replaces-the-estimate-once", async () => {
      const december = gasBill({ amount: "7,100", due: "2026-12-08" });
      const added = await request("/api/bills", { method: "POST", form: december });
      expect(added.response.status === 303, "s18v-add-december");
      expect(await linkedBody(december.id) === "Linked to Sakura Gas: replaces December’s estimate", "s18v-replaces-event");
      const content = await comingUp();
      expect(!content.includes("about ¥"), "s18v-estimate-gone");
      expect((content.match(/¥7,100/g) ?? []).length === 1, "s18v-counted-once");
    });
    await step("page", "stage18-varies-bill-page-offers-part-of-and-the-box", async () => {
      const real = await page(await billPath("Sakura Gas 10月分"), /Sakura Gas/);
      expect(/name="seriesBillId"/.test(real) && plain(pageContent(real)).includes("Sakura Gas (every month)"), "s18v-part-of");
      const series = await page(await billPath("Sakura Gas", /^(?!.*varies)/), /Sakura Gas/);
      expect(/name="amountVaries"/.test(series) && plain(pageContent(series)).includes("Amount changes every month (electricity, water, gas)"), "s18v-varies-box");
    });
  }
console.log(`${failures ? "FAIL" : "PASS"} summary ${failures} failed`);
  process.exit(failures ? 1 : 0);
}
const firstCookie = cookie;
// Cold means first Home in this fresh session, not a restarted server or cleared compiler cache.
const home = await step("page", "home-first-session", () => page("/", /18,780/));
await step("page", "home-warm", () => page("/", /18,780/));
await step("page", "phone-links-keep-their-own-home-and-canvas-destinations", async () => {
  const hrefForLink = (html, name, className) => [...markup(html).matchAll(/<a\b([^>]+)>([^<]+)<\/a>/g)]
    .filter(([, attrs, label]) => label.trim() === name && (!className || attrs.includes(`class="${className}"`)))
    .map(([, attrs]) => /href="([^"]+)"/.exec(attrs)?.[1]);
  const home = await page("/", /Coming up/);
  for (const name of ["CloudBox Plus", "Mobaile Tsushin"]) {
    expect(hrefForLink(home, name, "home-link-target").some(href => /^\/bills\/[0-9a-f-]{36}$/.test(href ?? "")), "home-bill-link");
  }
  expect(hrefForLink(home, "Card A", "home-link-target").some(href => /^\/cards\/[0-9a-f-]{36}$/.test(href ?? "")), "home-card-link");
  const ask = await page("/canvas", /This month/);
  const sentence = markup(ask).match(/<p class="canvas-sentence">([\s\S]*?)<\/p>/)?.[1] ?? "";
  const clients = ["Acme", "Northwind"].map(name => hrefForLink(sentence, name)[0]);
  expect(clients.every(href => /^\/clients\/[0-9a-f-]{36}$/.test(href ?? "")) && clients[0] !== clients[1], "canvas-client-links");
});
// D47: Try it shows its five-step Get started panel while retaining Ben’s numbers.
await step("page", "home-try-it-get-started", async () => {
  const html = await page("/", /18,780/);
  expect(/Get started/.test(pageContent(html)) && /Read the sentence and the forecast/.test(pageContent(html)) && /Hikari Denki bill in To check/.test(pageContent(html)), "try-it-get-started");
  expect(!/Add your bills and the clients/.test(pageContent(html)), "empty-sentence-shown");
  // Any demo household says so on Home and links to Start with my numbers.
  expect(/A fictional household that lives in this browser/.test(plain(pageContent(html))) && /href="\/start"/.test(html), "demo-line-missing");
  // The Add actions are links to the Add page for each kind (the dialog opens over the page; without JavaScript the page holds the form).
  for (const [kind, label] of [["bill", "A bill"], ["charge", "A card charge"], ["card", "A card"], ["client", "A client who pays you"], ["person", "A person who shares costs"]]) {
    expect(html.includes(`href="/add/${kind}?back=%2F" aria-haspopup="dialog">${label}</a>`), `add-menu-${label}`);
  }
  expect(html.includes('href="/upload">Upload a receipt or bill</a>'), "add-menu-upload");
});
// Nov 5 walk: every Coming up row up to the day the sentence names (Nov 27 on Try it) is on screen, not under "Later in the month".
await step("page", "home-coming-up-keeps-the-sentence-day-above-the-fold", async () => {
  const html = await page("/", /short on the 27th/);
  const start = html.indexOf('id="coming-up"');
  expect(start >= 0, "coming-up-panel");
  const panel = html.slice(start);
  const fold = panel.indexOf("<details");
  const before = fold >= 0 ? panel.slice(0, fold) : panel;
  expect(before.includes('dateTime="2026-11-27"'), "sentence-day-row-folded");
});
// Home and Safe to spend say what the number counts; Saving says what its "leave about" counts.
await step("page", "home-and-saving-say-what-their-numbers-count", async () => {
  const home = plain(pageContent(await page("/", /18,780|30,000/)));
  expect(home.includes("The lowest your balance gets in the next 30 days, after every bill and card statement, if clients pay late."), "safe-to-spend-line");
  const saving = plain(pageContent(await page("/saving", /leave about/)));
  expect(saving.includes("The next 30 days leave about ¥92,220 if clients pay as usual."), "saving-room-line");
  expect(saving.includes("What client payments bring in over the next 30 days, after every bill and card statement, if clients pay as usual."), "saving-room-note");
});
// The add forms say what More › will save: the guess from the name, with Change ›.
await step("page", "add-forms-show-the-guess", async () => {
  const bill = plain(pageContent(await page("/add/bill", /Add a bill/)));
  expect(/One-off · Other · Change ›/.test(bill), "bill-guess-line");
  const charge = plain(pageContent(await page("/add/charge", /Add a card charge/)));
  expect(/Other · Change ›/.test(charge.slice(charge.indexOf("What or where"))), "charge-guess-line");
});
// Forwarding: Bills never shows a raw "… is not set" or a setting's name; without the settings it says so in words.
await step("page", "bills-forwarding-in-words", async () => {
  const content = plain(pageContent(await page("/bills", /Forwarding address/)));
  expect(!/FORWARDING_DOMAIN is not set|INBOUND_ADDRESS_KEY is not set|INBOUND_WORKER_SECRET is not set/.test(content), "forwarding-raw-message");
  expect(!/FORWARDING_DOMAIN|INBOUND_ADDRESS_KEY|INBOUND_WORKER_SECRET/.test(content), "forwarding-setting-name");
  const off = content.includes("Forwarding bills by email isn’t set up on this server.") || content.includes("Forwarding bills by email isn&#x27;t set up");
  const html = await page("/", /18,780|30,000/);
  const actions = html.slice(html.indexOf('id="actions"'), html.indexOf('class="home-panels"'));
  expect(off === !actions.includes('href="/bills#forwarding"'), "home-forward-link-follows-the-setting");
});
// A page that calls notFound() after its shell started streams as 200 with the 404 marker in the markup; a plain 404 is also right.
async function isNotFound(path) {
  const { response, body } = await request(path);
  return response.status === 404 || body.includes("NEXT_HTTP_ERROR_FALLBACK;404");
}
// The restructure: Bills, Household and Settings tabs, the Add pages and dialog data, card removal, the moved addresses.
await step("page", "bills-list-and-a-bill-page", async () => {
  const list = await page("/bills", /Every bill stays in the household runway/);
  expect(/href="\/add\/bill\?back=%2Fbills"[^>]*>Add a bill/.test(list), "bills-add-link");
  const id = /href="\/bills\/([0-9a-f-]{36})"/.exec(list)?.[1];
  expect(id !== undefined, "bills-row-link");
  const html = await page(`/bills/${id}`, /Edit/);
  expect(/aria-label="Edit [^"]+"/.test(html) && /aria-label="Remove [^"]+"/.test(html), "bill-page-edit-and-remove");
  expect(html.includes('id="forwarding"'), "bills-forwarding-section");
});
await step("page", "a-bill-address-that-is-not-this-households-is-not-found", async () => {
  expect(await isNotFound(`/bills/${randomUUID()}`), "unknown-bill-opens-nothing");
});
await step("page", "household-tabs-render-with-the-current-tab-selected", async () => {
  for (const [path, label] of [["/household", "Details"], ["/household/people", "People"]]) {
    const html = await page(path, new RegExp(label));
    const tabs = [...html.matchAll(/<a\b[^>]*role="tab"[^>]*>/g)].map(match => match[0]);
    const selected = tabs.filter(tab => /aria-selected="true"/.test(tab));
    expect(tabs.length === 2 && selected.length === 1 && selected[0].includes(`href="${path}"`) && /aria-current="page"/.test(selected[0]), "household-tab-" + label);
  }
  expect(await isNotFound("/household/nothing"), "household-unknown-tab");
});
await step("page", "settings-tabs-render-with-the-current-tab-selected", async () => {
  const paths = ["/settings", "/settings/ai-model", "/settings/paypal", "/settings/data", "/settings/account"];
  for (const path of paths) {
    const html = await page(path, /Settings/);
    const tabs = [...html.matchAll(/<a\b[^>]*role="tab"[^>]*>/g)].map(match => match[0]);
    const selected = tabs.filter(tab => /aria-selected="true"/.test(tab));
    expect(tabs.length === 5 && selected.length === 1 && selected[0].includes(`href="${path}"`) && /aria-current="page"/.test(selected[0]), "settings-tab-" + path);
  }
  expect(await isNotFound("/settings/nothing"), "settings-unknown-tab");
  // Try it cannot connect PayPal: the tab says whose sandbox account it pays into and offers no Connect button.
  const paypal = plain(pageContent(await page("/settings/paypal", /Your PayPal/)));
  expect(/Try it pays into fipa(?:'|’|&#x27;|&apos;)s own PayPal sandbox account\. Sign in with your email to connect your own PayPal\./.test(paypal) && !paypal.includes("Connect your PayPal"), "settings-paypal-try-it");
  // Connect posts to fipa, which sends the owner on to PayPal: Chrome applies form-action to that redirect, so these two pages (and only form-action) allow PayPal.
  const formAction = async path => (await request(path)).response.headers.get("content-security-policy")?.match(/(?:^|; )form-action ([^;]*)/)?.[1];
  expect(await formAction("/settings/paypal") === "'self' https://*.paypal.com", "settings-paypal-form-action");
  expect(await formAction("/pay/not-a-payment-link") === "'self' https://*.paypal.com", "pay-page-form-action");
  expect(await formAction("/settings/data") === "'self'", "other-settings-form-action");
});
// Next streams a page's redirect after the shell started, so the status is 200 with the redirect in the markup; a plain 307/308 is also right.
async function redirectsTo(path, target) {
  const { response, body } = await request(path);
  if (response.status === 307 || response.status === 308) { const to = new URL(response.headers.get("location") ?? "", base); return to.pathname + to.search === target; }
  return response.status === 200 && body.includes(`NEXT_REDIRECT;replace;${target};`);
}
await step("page", "old-addresses-lead-to-their-new-places", async () => {
  expect(await redirectsTo("/account", "/settings/account"), "account-to-settings-account");
  expect(await redirectsTo("/memory?tab=rules", "/settings"), "memory-rules-to-settings");
  expect(await redirectsTo("/memory?tab=goals", "/saving"), "memory-goals-to-saving");
  expect(await redirectsTo("/plan", "/spending"), "plan-to-spending");
  expect(await redirectsTo("/plan?month=2026-10&q=food", "/spending?month=2026-10&q=food"), "plan-keeps-month-and-search");
  expect(await isNotFound("/activity"), "activity-page-is-gone");
  const html = await page("/memory", /Profile/);
  expect(/aria-selected="true"[^>]*href="\/memory"|href="\/memory"[^>]*aria-selected="true"/.test(html), "memory-profile-tab");
});
await step("page", "settings-hash-addresses-are-moved-by-the-page", async () => {
  // The #fragment never reaches the server: the page carries the client component that moves an old #people, #cards, #bill-<id>.
  const html = (await request("/settings")).body;
  expect(html.includes("MovedAnchors"), "moved-anchors-in-the-page");
});
await step("page", "add-pages-render-each-kind-form", async () => {
  const forms = [["bill", /Add a bill/, 'action="\/api\/bills"'], ["charge", /Add a card charge/, 'action="\/api\/charges"'], ["client", /Add a client/, 'action="\/api\/clients"'],
    ["card", /Add a card/, 'action="\/api\/settings"'], ["person", /Add a person/, 'action="\/api\/people"']];
  for (const [kind, title, action] of forms) {
    const html = await page(`/add/${kind}?back=%2Fbills`, title);
    expect(new RegExp(action).test(html) && /<form\b/.test(html), "add-form-" + kind);
    expect(/href="\/bills"[^>]*>Cancel/.test(html), "add-cancel-goes-back-" + kind);
  }
  expect(await isNotFound("/add/invoice"), "add-unknown-kind");
  const outside = await request("/add/bill?back=%2F%2Fevil.test");
  expect(!/(?:href|action)="[^"]*evil\.test/.test(markup(outside.body)) && /href="\/"[^>]*>Cancel/.test(outside.body), "add-back-is-never-another-host");
});
await step("page", "setup-shows-the-ask-button", async () => {
  const html = await page("/setup?step=bank", /What’s in your bank today/);
  expect(/<a id="shell-top-ask" class="ask-button" href="\/canvas#ask">/.test(html) || /id="shell-top-ask"/.test(html), "setup-ask-button");
});
await step("guard", "add-view-is-the-households-own-and-read-only", async () => {
  const mine = await request("/api/add/view");
  expect(mine.response.status === 200 && /no-store/.test(mine.response.headers.get("cache-control") ?? ""), "add-view-status");
  const view = JSON.parse(mine.body);
  expect(typeof view.today === "string" && typeof view.homeCurrency === "string" && Array.isArray(view.people) && Array.isArray(view.cards) && Array.isArray(view.own?.categories), "add-view-shape");
  expect(!/session|tokenHash|secret/i.test(mine.body), "add-view-no-secrets");
  expect((await request("/api/add/view", { method: "POST" })).response.status === 405, "add-view-post-refused");
});
await step("action", "a-card-is-removed-with-its-own-id-only", async () => {
  const label = "Fictional removable card";
  const made = await request("/api/settings", { method: "POST", form: { kind: "card", id: "", label, memberId: "", closingDay: "20", dueDay: "5", limit: "" } });
  expect(made.response.status === 200, "card-made");
  const cardIdOf = async () => new RegExp(`href="/cards/([0-9a-f-]{36})"[^>]*>(?:(?!</a>)[\\s\\S])*${label}`).exec(markup((await request("/cards")).body))?.[1];
  const id = await cardIdOf();
  expect(id !== undefined, "card-listed");
  // Another household's card id is refused the same way as an unused one.
  const mine = cookie;
  adopt(await request("/api/try", { session: "" }));
  const foreign = /href="\/cards\/([0-9a-f-]{36})"/.exec(markup((await request("/cards")).body))?.[1];
  cookie = mine;
  expect(foreign !== undefined, "foreign-card-id");
  const wrong = await request("/api/remove", { method: "POST", form: { kind: "card", id: foreign, returnTo: "/cards" } });
  expect(wrong.response.status === 400, "card-remove-foreign-id");
  const unused = await request("/api/remove", { method: "POST", form: { kind: "card", id: randomUUID(), returnTo: "/cards" } });
  expect(unused.response.status === 400, "card-remove-unused-id");
  expect(await cardIdOf() === id, "card-still-there");
  const removed = await request("/api/remove", { method: "POST", form: { kind: "card", id, returnTo: "/cards" }, extraHeaders: { "x-form-fetch": "1" } });
  expect(removed.response.status === 204 && removed.response.headers.get("x-form-redirect") === "/cards", "card-remove-fetch");
  expect(await cardIdOf() === undefined, "card-gone");
  const again = await request("/api/remove", { method: "POST", form: { kind: "card", id, returnTo: "/cards" } });
  expect(again.response.status === 400, "card-removed-twice");
  // A second card, removed by a plain post, is a 303 back to the list.
  await request("/api/settings", { method: "POST", form: { kind: "card", id: "", label, memberId: "", closingDay: "20", dueDay: "5", limit: "" } });
  const second = await cardIdOf();
  const plainPost = await request("/api/remove", { method: "POST", form: { kind: "card", id: second, returnTo: "/cards" } });
  expect(plainPost.response.status === 303 && plainPost.response.headers.get("location") === "/cards", "card-remove-plain");
});
await step("page", "cards", () => page("/cards", /Card B/));
await step("page", "clients", () => page("/clients", /Beacon/));
await step("page", "saving", () => page("/saving", /Add a pot/));
await step("page", "spending-where-the-month-goes", () => page("/spending", /Where the month goes[\s\S]*Housing 1 item ¥82,000/));
// S-A and S-B (D52): the two-person month and the public read-only family link.
{
  const prior = cookie;
  const familySession = await step("action", "family-try-it-session", async () => {
    adopt(await request("/api/try", { session: "" }));
    return true;
  });
  if (familySession) {
    const together = /Together ¥88,780 · Ben ¥63,450 · Wife ¥0 this month/;
    const familyWords = ["Ben · family view", "Where the month goes", "Shared bills coming up",
      "Who owes whom", "Nothing can be changed from here."];
    const privateWords = [...familyWords, "Acme Corp", "Northwind", "CloudBox Plus", "Wife", "¥88,780"];
    await step("action", "family-s-a-month-split", async () => {
      expect(!together.test(pageContent(await page("/spending", /Where the month goes/))), "family-single-person");
      const added = await request("/api/people", { method: "POST", form: { kind: "add", name: "Wife" } });
      expect(added.response.status === 303, "family-add-person");
      const month = plain(pageContent(await page("/spending", together)));
      expect(month.includes("Shared ¥82,000") && month.includes("Ben ¥10,700"), "family-month-shares");
    });
    const link = await step("action", "family-s-b-make-a-link", async () => {
      const created = await request("/api/family-links", { method: "POST", form: { kind: "create" } });
      expect(created.response.status === 200, "family-create-status");
      const { id, link, message, day } = JSON.parse(created.body);
      const url = new URL(link);
      expect(/^[0-9a-f-]{36}$/i.test(id) && /^\/family\/[A-Za-z0-9_-]{43}$/.test(url.pathname)
        && !url.search && !url.hash && url.origin === base.origin, "family-create-shape");
      expect(day === "Nov 21" && message.endsWith(`See our month: ${link} (until Nov 21)`), "family-line-message");
      return { id, path: url.pathname };
    });
    const privateHeaders = ({ headers }) => {
      expect(headers.get("cache-control")?.includes("no-store"), "family-cache-control");
      expect(headers.get("referrer-policy") === "no-referrer", "family-referrer");
      expect(headers.get("x-robots-tag") === "noindex, nofollow", "family-robots");
    };
    if (link) {
      await step("page", "family-s-b-open-without-a-cookie", async () => {
        const { response, body } = await request(link.path, { session: "" });
        expect(response.status === 200, "family-open-status");
        privateHeaders(response);
        const content = plain(pageContent(body));
        expect(together.test(content) && familyWords.every(word => content.includes(word)), "family-open-content");
        const view = markup(body).match(/<main\b[^>]*class="family-page"[^>]*>([\s\S]*?)<\/main>/i)?.[1];
        expect(view && !/<(?:a|button|form)\b/i.test(view), "family-read-only");
      });
      await step("action", "family-s-b-stop-sharing", async () => {
        const stopped = await request("/api/family-links", { method: "POST", form: { kind: "stop", id: link.id } });
        expect(stopped.response.status === 200 && stopped.body === "Sharing stopped. That link no longer opens.", "family-stop");
      });
    }
    await step("guard", "family-s-b-ended-and-unknown-show-ended-page", async () => {
      const unknown = randomUUID().replaceAll("-", "") + "a".repeat(11);
      const paths = ["/family/" + unknown, "/family/invalid"];
      if (link) paths.push(link.path);
      for (const path of paths) {
        const { response, body } = await request(path, { session: "" });
        expect(response.status === 200, "family-ended-status");
        privateHeaders(response);
        const content = plain(pageContent(body));
        expect(content.includes("This link has ended.") && content.includes("Ask for a new one."), "family-ended-content");
        expect(privateWords.every(word => !content.includes(word)), "family-ended-no-household-data");
      }
    });
  }
  cookie = prior;
}

// Stage 17 Spending (D53): the search box, the search results and the month links, on the Try it household (today Nov 14).
const TRY_TODAY = "2026-11-14";
const lastMonth = (() => { const [y, m] = TRY_TODAY.split("-").map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`; })();
await step("page", "stage17-spending-search-box-and-no-results-without-a-query", async () => {
  const html = await page("/spending", /Business ¥32,830 of ¥152,230 this month/);
  expect(/<form[^>]*action="\/spending"[^>]*method="get"/.test(html) && /name="q"/.test(html) && html.includes("Search spending: hotel, food, a shop name"), "search-form");
  expect(!html.includes('id="spending-results-title"'), "results-without-query");
  expect(html.includes(`href="/spending?month=${lastMonth}"`) && !/aria-label="Next month/.test(html), "month-links-on-current-month");
});
await step("page", "stage17-spending-search-food", async () => {
  const content = plain(pageContent(await page("/spending?q=food", /¥28,100 in all/)));
  expect(content.includes("Food: ¥10,700 in November (3 items), ¥11,440 in October (3 items), ¥5,960 in September (1 item); nothing in the other 9 months. ¥28,100 in all."), "food-summary-line");
  const november = content.slice(content.indexOf("November ¥10,700"), content.indexOf("October ¥11,440"));
  expect(november.includes("Food ¥10,700"), "food-november-by-category");
  for (const item of ["Minato Fresh Market Nov 13 ¥1,400", "Kissa Midori café Nov 12 · Food › Coffee ¥1,880", "Minato Fresh Market Nov 8 ¥7,420"]) expect(november.includes(item), "food-november-item");
  expect(!content.includes("August ¥0"), "zero-month-block");
  expect(content.includes("Business ¥32,830 of ¥152,230 this month"), "month-view-unchanged-by-search");
});
await step("page", "stage17-spending-search-hotel-finds-hakone", async () => {
  const content = plain(pageContent(await page("/spending?q=hotel", /Hakone/))).replaceAll("&quot;", "\"");
  expect(content.includes("\"hotel\": ¥28,600 in September (1 item); nothing in the other 11 months. ¥28,600 in all.") && content.includes("Hotel Kazemachi Hakone Sep 22 ¥28,600"), "hotel-result");
});
await step("page", "stage17-spending-search-nothing-matches", async () => {
  const content = plain(pageContent(await page("/spending?q=zzz", /Nothing matches/)));
  expect(content.includes("Nothing matches “zzz” in the last 12 months."), "nothing-matches");
});
await step("page", "stage17-spending-last-month", async () => {
  const html = await page(`/spending?month=${lastMonth}`, /Where October went/);
  const content = plain(pageContent(html));
  const month = content.slice(content.indexOf("Where October went"), content.indexOf("Ask or tell me"));
  expect(content.includes("Business ¥31,986 of ¥132,060 in October") && month.includes("Housing 1 item ¥82,000") && month.includes("Utilities 1 item ¥10,020") && !month.includes("Travel"), "october-view");
  expect(/aria-label="Next month, November"/.test(html) && /aria-label="Previous month, September"/.test(html), "october-links");
});
await step("guard", "stage17-spending-month-out-of-range-refused-in-words", async () => {
  const content = plain(pageContent(await page("/spending?month=2020-01", /Spending shows the last 12 months/)));
  expect(content.includes("Spending shows the last 12 months, December 2025 to November 2026. Here is November.") && content.includes("Where the month goes"), "month-refusal");
});
// Stage 18 regular (D54): Over time's Regular costs panel on the Try it household, before and after confirming Hikari Denki.
const regularPanel = (html) => { const content = plain(pageContent(html)); const at = content.indexOf("Regular costs"); return at < 0 ? "" : content.slice(at); };
await step("page", "stage18-regular-costs-before-confirm", async () => {
  const panel = regularPanel(await page("/spending/over-time", /Regular costs/));
  expect(panel.includes("Kissa Midori café down ¥920 so far · Minato Fresh Market up ¥180 so far"), "regular-changed-line");
  expect(/Hikari Denki Utilities not in yet Last month ¥10,020 · usually on the 25th Sep ¥8,640 · Oct ¥10,020 · Nov not in yet/.test(panel), "regular-hikari-not-yet");
  expect(panel.includes("Rent Housing ¥82,000 Last month ¥82,000 · same Sep ¥82,000 · Oct ¥82,000 · Nov ¥82,000"), "regular-rent-same");
});
await step("page", "seeded-invoice-review-read-only", async () => {
  const id = home?.match(/href="\/invoices\/([0-9a-f-]{36})"/i)?.[1]
    ?? (home && flight(home).match(/"href"\s*:\s*"\/invoices\/([0-9a-f-]{36})"/i)?.[1]);
  expect(id, "invoice-link");
  const review = plain(pageContent(await page("/invoices/" + id, /Review invoice/)));
  expect(review.includes("Beacon Studio usually pays 2 days after you send, slowest 3"), "invoice-review-client-pace");
  // The approve form names who and how much, says whose account the client pays (Try it: fipa's own sandbox account), and carries the busy line for the 5 to 10 s call.
  expect(review.includes("Approve and make payment link"), "invoice-review-approve-button");
  expect(/PayPal sandbox makes a link for \$[\d,.]+ that Beacon pays into fipa(?:’|&#x27;|')s sandbox account\. No real money moves\./.test(review), "invoice-review-send-hint");
  expect(review.includes("Asking PayPal sandbox for a payment link…"), "invoice-review-busy-line");
  // Paying another way is offered to everyone and says what it does to the bank balance.
  expect(review.includes("Paid another way (bank, cash)") && /Use this if Beacon Studio paid you another way\. It adds ¥[\d,]+ to your bank balance\./.test(review), "invoice-review-paid-another-way");
});
await step("page", "sent-invoice-shows-its-link-field", async () => {
  // D12: while an invoice is sent and unpaid the person can always see and copy the link, late or not.
  // Home links only the draft; each client page lists that client's invoices, including the sent one.
  const clientsHtml = await page("/clients", /Beacon/);
  const clientIds = [...new Set([...clientsHtml.matchAll(/\/clients\/([0-9a-f-]{36})/gi)].map(m => m[1]))];
  const sources = [home ?? "", ...(await Promise.all(clientIds.map(id => page("/clients/" + id, /Work and invoices/))))];
  const ids = [...new Set(sources.flatMap(html => [...html.matchAll(/\/invoices\/([0-9a-f-]{36})/gi), ...flight(html).matchAll(/\/invoices\/([0-9a-f-]{36})/gi)].map(m => m[1])))];
  let seen = 0;
  for (const id of ids) {
    const html = await page("/invoices/" + id, /Invoice|Review invoice/);
    if (!pageContent(html).includes("Link made")) continue;
    seen++;
    expect(/<input[^>]*class="invoice-link"[^>]*value="[^"]*\/pay\/[^"]+"/.test(html) || /<input[^>]*value="[^"]*\/pay\/[^"]+"[^>]*class="invoice-link"/.test(html), "sent-invoice-link-field");
    expect(html.includes("Copy link for"), "sent-invoice-copy-button");
    // Try it lets the judge play the client. The button is only looked for: pressing it pays through PayPal.
    expect(html.includes("Pay as the client (sandbox test card)") && html.includes("/api/try/pay-as-client"), "sent-invoice-try-it-pay-as-client");
  }
  expect(seen > 0, "sent-invoice-seen");
});
const initial = await step("read", "events-before-actions", events);
await step("action", "mark-notification-read", async () => {
  const notification = initial?.events.find(event => event.notify && !event.readAt);
  expect(notification, "seed-notification");
  const result = await request("/api/events", { method: "POST", json: { ids: [notification.id] } });
  expect(result.response.status === 200, "mark-status");
  const data = JSON.parse(result.body);
  expect(data.changed === 1 && data.feed.unread === initial.feed.unread - 1, "mark-result");
});
const bill = initial?.events.find(event => event.refType === "bill" && /Hikari Denki/.test(event.title))?.refId;
for (const label of ["confirm-hikari", "confirm-hikari-retry"]) {
  await step("action", label, async () => {
    expect(bill, "seed-bill");
    const result = await request("/api/confirm", { method: "POST", form: { kind: "bill", id: bill } });
    expect(result.response.status === 303 && result.response.headers.get("location") === "/", "confirm-result");
  });
}
await step("page", "home-after-confirm-30000", () => page("/", /30,000/));
await step("page", "spending-utilities-after-confirm", () => page("/spending", /Utilities \d+ items? ¥11,220/));
await step("page", "stage18-regular-costs-after-confirm", async () => {
  const panel = regularPanel(await page("/spending/over-time", /Regular costs/));
  expect(/Regular costs Hikari Denki up ¥1,200 · Kissa Midori café down ¥920 so far/.test(panel), "regular-changed-line-starts-with-hikari");
  expect(panel.includes("Hikari Denki Utilities ¥11,220 Last month ¥10,020 · up ¥1,200 Sep ¥8,640 · Oct ¥10,020 · Nov ¥11,220"), "regular-hikari-row");
});
// A refused form answers with its message (the page shows it inline and keeps what was typed); a native post, as here,
// gets the same status and text. The shared form posts with "x-form-fetch: 1" and is answered a redirect as 204 plus a header.
const refused = (label, fields, message) => step("guard", label, async () => {
  const result = await request("/api/bills", { method: "POST", form: { id: randomUUID(), biller: "Fictional vet", amount: "4000", due: "2026-11-20", category: "other", businessShare: "personal", ...fields } });
  expect(result.response.status === 400 && result.body === message, "refused-result");
});
await refused("bill-with-amount-0-refused-with-message", { amount: "0" }, "The amount must be more than zero");
// D48: a schedule that does not hang together is refused with its words and nothing is saved.
await refused("bill-new-amount-on-or-before-due-refused-with-message", { repeat: "year", nextAmount: "13000", nextAmountFrom: "2026-11-20" }, "The new amount must start after the due date");
// D41: a last payment that does not hang together is refused with its words.
await refused("bill-with-an-unknown-repeat-refused", { repeat: "week" }, "Check the required fields and try again.");
await step("action", "bill-with-thousands-separator-saved-and-removed", async () => {
  const id = randomUUID();
  const form = { id, biller: "Fictional separator bill", amount: "1,000", due: "2026-11-20", category: "other", businessShare: "personal" };
  const native = await request("/api/bills", { method: "POST", form });
  // Back on Home, the address carries the new bill's id (never its name or amount) for the "Added …" line, and lands on Coming up.
  expect(native.response.status === 303 && native.response.headers.get("location") === `/?added=${id}#coming-up`, "bill-native-result");
  const again = await request("/api/bills", { method: "POST", form, extraHeaders: { "x-form-fetch": "1" } });
  expect(again.response.status === 204 && again.response.headers.get("x-form-redirect") === `/?added=${id}#coming-up` && !again.response.headers.get("location"), "bill-form-result");
  const shown = plain(pageContent(await page(`/?added=${id}`, /Fictional separator bill/)));
  expect(shown.includes("Added Fictional separator bill ¥1,000, due Nov 20"), "bill-added-line");
  expect(!plain(pageContent(await page("/", /Coming up/))).includes("Added Fictional separator bill"), "bill-added-line-gone-on-next-load");
  const removed = await request("/api/remove", { method: "POST", form: { kind: "bill", id, returnTo: "/bills" }, extraHeaders: { "x-form-fetch": "1" } });
  expect(removed.response.status === 204 && removed.response.headers.get("x-form-redirect") === "/bills", "remove-form-result");
  const gone = await request("/api/remove", { method: "POST", form: { kind: "bill", id } });
  expect(gone.response.status === 400 && gone.body === "Choose a bill of this household", "remove-twice-native-result");
  const data = await events();
  expect(data.events.filter(event => event.kind === "bill_removed" && event.refId === id).length === 1, "remove-single-event");
});
await step("guard", "remove-with-bad-fields-refused", async () => {
  const result = await request("/api/remove", { method: "POST", form: { kind: "bill", id: "x" } });
  expect(result.response.status === 400 && result.body === "Check the required fields and try again.", "remove-bad-fields-result");
});
await step("read", "confirm-single-event", async () => {
  expect(bill, "seed-bill");
  const data = await events();
  expect(data.events.filter(event => event.kind === "bill_confirmed" && event.refId === bill).length === 1, "confirm-event-count");
});
// The Ask page (D60): without the owner's AI settings it shows the missing setting's name; with them, the box. Pins (D57): pin a canvas, Home draws it, unpin.
await step("page", "ask-page-opens-with-the-box-or-the-missing-setting", async () => {
  const html = await page("/canvas", /Ask a question|Ask isn(’|&#x27;|')t available on this server yet \(AI_[A-Z_]+\)/);
  expect(/New conversation|Am I OK until the end of the month/.test(pageContent(html)) || /Ask isn/.test(pageContent(html)), "ask-page-content");
  expect(/This month|Safe to spend/.test(pageContent(html)), "ask-page-starters");
});
await step("action", "pin-a-canvas-home-draws-it-and-unpin-removes-it", async () => {
  const recipe = JSON.stringify({ version: 1, title: "Fictional pin check", blocks: [{ type: "number", label: "Cash today", query: { q: "cash" } }] });
  const pinned = await request("/api/canvases", { method: "POST", form: { kind: "pin", title: "Fictional pin check", recipe, returnTo: "/" } });
  expect(pinned.response.status === 303 && pinned.response.headers.get("location") === "/", "pin-status");
  const task = await request("/api/spaces", { method: "POST", form: { kind: "create", name: "Fictional pin task" } });
  const spacePath = task.response.headers.get("location") ?? "";
  const spaceId = /^\/canvas\?space=([0-9a-f-]{36})$/.exec(spacePath)?.[1];
  expect(task.response.status === 303 && spaceId, "pin-task-created");
  const taskPin = await request("/api/canvases", { method: "POST", form: { kind: "pin", title: "Fictional task-only pin", recipe, spaceId, returnTo: spacePath } });
  expect(taskPin.response.status === 303 && taskPin.response.headers.get("location") === spacePath, "pin-task-status");
  await page(spacePath, /Fictional task-only pin/);
  const home = await page("/", /Fictional pin check/);
  expect(/Fictional pin check/.test(textWithoutBell(home)) && !/Fictional task-only pin/.test(textWithoutBell(home)), "task-pin-stays-off-home");
  expect(/Cash today/.test(pageContent(home)) && /Move up/.test(pageContent(home)) && /Unpin/.test(pageContent(home)), "pin-drawn-on-home");
  const id = /\/canvas\?pin=([0-9a-f-]{36})/.exec(home)?.[1];
  expect(id, "pin-id");
  const open = await page(`/canvas?pin=${id}`, /Save to this pin/);
  expect(/Pin to Home/.test(pageContent(open)), "pin-open");
  const gone = await request("/api/canvases", { method: "POST", form: { kind: "unpin", id, returnTo: "/" } });
  expect(gone.response.status === 303, "unpin-status");
  const after = await request("/");
  expect(!/Fictional pin check/.test(textWithoutBell(after.body)), "pin-removed");
  const removedTask = await request("/api/spaces", { method: "POST", form: { kind: "delete", id: spaceId } });
  expect(removedTask.response.status === 303, "pin-task-removed");
  const kinds = (await events()).events.map(event => event.kind);
  expect(kinds.includes("canvas_pinned") && kinds.includes("canvas_unpinned"), "pin-events");
});
await step("action", "ai-model-default-is-accepted-and-an-oversize-body-is-refused", async () => {
  const same = await request("/api/settings/ai-model", { method: "POST", form: { kind: "default" } });
  expect(same.response.status === 200, "ai-model-default-status");
  const big = await request("/api/settings/ai-model", { method: "POST", form: { kind: "save", key: "x".repeat(5000) } });
  expect(big.response.status === 413, "ai-model-oversize-status");
});
await step("page", "household-details", () => page("/household", /Household name[\s\S]*Save household/));
await step("page", "settings-account-offers-start-over-with-my-numbers", () => page("/settings/account", /Start over with my numbers/));
await step("page", "settings-ai-model-says-where-to-choose", async () => {
  const html = await page("/settings/ai-model", /Your AI model/);
  expect(pageContent(html).includes("Every household starts on the server’s default model, and you can choose another in Settings → Your AI model."), "settings-model-hint");
});
await step("action", "export-my-data", async () => {
  const result = await request("/api/export", { method: "POST" });
  const { headers } = result.response;
  expect(result.response.status === 200 && headers.get("content-type") === "application/json", "export-status");
  expect(/^attachment; filename="personal-economy-saver-\d{4}-\d{2}-\d{2}\.json"$/.test(headers.get("content-disposition") ?? ""), "export-disposition");
  expect(/no-store/.test(headers.get("cache-control") ?? ""), "export-no-store");
  const data = JSON.parse(result.body);
  expect(data.version === 4 && Array.isArray(data.ownCategories) && Array.isArray(data.spaces) && Array.isArray(data.events) && data.clients.length === 3, "export-shape");
  expect(Array.isArray(data.memory) && Array.isArray(data.canvases) && Array.isArray(data.journal), "export-stored-kinds");
  expect(!/ai_?key|tokenHash|storagePath|payload/i.test(result.body), "export-no-secrets");
  const get = await fetch(new URL("/api/export", base), { headers: { Cookie: cookie, Origin: base.origin }, redirect: "manual" });
  expect(get.status === 405, "export-get-refused");
  tryItExport = result.body;
});
// D59: Your data lists each kind with where it is kept and how many; a delete is real and the record cannot be deleted by kind.
await step("page", "settings-data-tab-rows", async () => {
  const content = plain(pageContent(await page("/settings/data", /Your data/)));
  for (const words of ["Your numbers", "What the assistant remembers", "Canvases pinned to Home", "Ask conversations", "Uploaded documents", "In our cloud, Tokyo", "Export my data", "Delete everything"]) expect(content.includes(words), "your-data-" + words);
  expect(/What the assistant remembers · 0 things/.test(content) && !/Delete all the assistant remembers/.test(content), "your-data-memory-empty");
});
await step("action", "your-data-delete-one-and-delete-all-memory", async () => {
  for (const text of ["Fictional data check one", "Fictional data check two", "Fictional data check three"]) {
    const added = await request("/api/memory", { method: "POST", form: { kind: "add", memoryKind: "fact", text, returnTo: "/memory" } });
    expect(added.response.status === 303, "data-memory-add");
  }
  const rows = JSON.parse((await request("/api/export", { method: "POST" })).body).memory;
  expect(rows.length === 3, "data-export-has-memory");
  expect(/What the assistant remembers · 3 things/.test(plain(pageContent((await request("/settings/data")).body))), "data-memory-count");
  const one = await request("/api/data", { method: "POST", form: { kind: "delete_one", what: "memory", id: rows[0].id, returnTo: "/settings/data" } });
  expect(one.response.status === 303 && one.response.headers.get("location") === "/settings/data", "data-delete-one");
  const again = await request("/api/data", { method: "POST", form: { kind: "delete_one", what: "memory", id: rows[0].id, returnTo: "/settings/data" } });
  expect(again.response.status === 404, "data-delete-one-again");
  expect(/What the assistant remembers · 2 things/.test(plain(pageContent((await request("/settings/data")).body))), "data-memory-count-after-one");
  const all = await request("/api/data", { method: "POST", form: { kind: "delete_kind", what: "memory", returnTo: "/settings/data" } });
  expect(all.response.status === 303, "data-delete-all");
  expect(JSON.parse((await request("/api/export", { method: "POST" })).body).memory.length === 0, "data-memory-gone-from-export");
  expect(!/Fictional data check/.test(pageContent((await request("/memory")).body)), "data-memory-page-empty");
  const record = await request("/api/data", { method: "POST", form: { kind: "delete_kind", what: "record", returnTo: "/settings" } });
  expect(record.response.status === 400 && /Delete everything/.test(record.body), "data-record-refused");
  const bad = await request("/api/data", { method: "POST", form: { kind: "delete_kind", what: "nothing", returnTo: "/settings" } });
  expect(bad.response.status === 400, "data-bad-kind");
});
// D59 step 2: Import reads a version 2, 3 or 4 file into an empty household only, and says why when it cannot.
await step("action", "import-refuses-a-full-household-an-old-file-and-an-oversize-body", async () => {
  const full = await request("/api/restore", { method: "POST", json: JSON.parse(tryItExport) });
  expect(full.response.status === 400 && full.body === "Import works on an empty household. Start with my numbers first.", "import-full-refused");
  const big = await request("/api/restore", { method: "POST", json: { version: 2, filler: "x".repeat(1_100_000) } });
  expect(big.response.status === 413, "import-oversize");
});
await step("action", "import-fills-an-empty-household-from-an-export", async () => {
  const start = await request("/api/try/blank", { method: "POST", form: { name: "Fictional importer", currency: "JPY", timeZone: "Asia/Tokyo" }, session: "" });
  const blank = start.response.headers.get("set-cookie")?.match(/(?:^|,\s*)household=([^;]+)/)?.[1];
  expect(start.response.status === 303 && start.response.headers.get("location") === SETUP_START && blank, "import-blank-session");
  const old = await request("/api/restore", { method: "POST", session: "household=" + blank, json: { ...JSON.parse(tryItExport), version: 1 } });
  expect(old.response.status === 400 && /version 1/.test(old.body), "import-old-version-refused");
  const done = await request("/api/restore", { method: "POST", session: "household=" + blank, json: JSON.parse(tryItExport) });
  expect(done.response.status === 200, "import-status");
  const counts = JSON.parse(done.body).imported;
  expect(counts.clients === 3 && counts.bills > 0 && counts.invoices > 0, "import-counts");
  const home = plain(pageContent((await request("/", { session: "household=" + blank })).body));
  expect(/short on the 27th|fine/i.test(home) && !/Add your bills/.test(home), "import-home-shows-the-forecast");
});
await step("action", "settings-invalid-input", async () => {
  const result = await request("/api/settings", { method: "POST", form: { kind: "household", name: "" } });
  expect(result.response.status === 400, "invalid-settings-result");
  // The bank balance goes only through its own route; a household post that carries one saves the name and leaves the balance alone.
  const bank = await request("/api/bank-balance", { method: "POST", form: { id: randomUUID(), amount: "invalid", returnTo: "/" } });
  expect(bank.response.status === 400 && bank.body === "Enter a whole number of yen, like 5000 or 5,000", "invalid-bank-result");
});
await step("action", "settings-save-fictional-name", async () => {
  const result = await request("/api/settings", { method: "POST", form: { kind: "household", name: "Fictional Check" } });
  expect(result.response.status === 200 && result.body === "Settings saved", "save-settings-result");
});
// D66: nudge rules are the standing rules on Settings → Assistant rules.
await step("page", "rules-default-nudge-and-approval-hint", async () => {
  const content = plain(pageContent(await page("/settings", /Suggest sending a client the link again 3 days after their usual pay day/)));
  expect(/suggest|approv/i.test(content), "rule-approval-hint");
});
await step("guard", "rules-nudge-out-of-range-refused", async () => {
  for (const value of ["0", "31", "2.5", "abc"]) {
    const result = await request("/api/rules", { method: "POST", form: { kind: "set", ruleKind: "nudge_after", enabled: "on", value } });
    expect(result.response.status === 400, "nudge-refused-" + value);
  }
});
await step("action", "rules-nudge-on-then-off", async () => {
  const on = await request("/api/rules", { method: "POST", form: { kind: "set", ruleKind: "nudge_after", enabled: "on", value: "5" } });
  expect(on.response.status === 303 && on.response.headers.get("location") === "/settings", "nudge-on-result");
  await page("/settings", /Suggest sending a client the link again 5 days after their usual pay day/);
  await sawEvent(/Rule changed: Suggest sending a client the link again 5 days after their usual pay day/);
  const off = await request("/api/rules", { method: "POST", form: { kind: "set", ruleKind: "nudge_after", value: "" } });
  expect(off.response.status === 303, "nudge-off-result");
  await sawEvent(/Rule changed: Suggest sending a client the link again 5 days after their usual pay day \(off\)/);
});
await step("page", "settings-reload-saved-name", async () => {
  const html = await page("/household", /Household name/);
  const htmlField = (html.match(/<input\b[^>]*>/gi) ?? []).some(input => /name="name"/.test(input) && /value="Fictional Check"/.test(input));
  const flightField = /"name"\s*:\s*"name"[^}]*"(?:defaultValue|value)"\s*:\s*"Fictional Check"/.test(flight(html));
  expect(htmlField || flightField, "saved-name-field");
});
await step("action", "reset-fetch-form-gets-one-redirect-destination", async () => {
  const old = cookie;
  adopt(await request("/api/try/reset", { method: "POST", extraHeaders: { "x-form-fetch": "1" } }), true);
  expect(cookie !== old && cookie !== firstCookie, "reset-fresh-session");
});
await step("page", "home-after-reset-18780", () => page("/", /18,780/));
await step("read", "reset-invalidates-old-session", async () => {
  const result = await request("/api/events", { session: firstCookie });
  expect(result.response.status === 401, "old-session-status");
});
// D47: Start with my numbers. A blank demo says what to add (never "You're fine"), shows three open first steps, and
// changes to the normal sentence and two open steps once a bill is added through the same door the form uses.
cookie = "";
const setup = { name: "Fictional newcomer", currency: "JPY", timeZone: "Asia/Tokyo" };
await step("guard", "start-blank-bad-form-refused", async () => {
  const result = await request("/api/try/blank", { method: "POST", form: { ...setup, timeZone: "Nowhere/Land" }, session: "" });
  expect(result.response.status === 400 && !result.response.headers.get("set-cookie"), "blank-bad-form");
});
// A blank household starts with no balance and no card; the person adds both after it, as the setup pages do.
async function addBankAndCard() {
  const bank = await request("/api/bank-balance", { method: "POST", form: { id: randomUUID(), amount: "120,000", returnTo: "/setup?step=bank" } });
  expect(bank.response.status === 303, "blank-bank-set");
  const card = await request("/api/settings", { method: "POST", form: { kind: "card", id: "", label: "Card N", memberId: "", closingDay: "25", dueDay: "10", limit: "" } });
  expect(card.response.status === 200, "blank-card-set");
}
await step("action", "start-blank-session", async () => {
  adopt(await request("/api/try/blank", { method: "POST", form: setup, session: "" }), false, SETUP_START);
  await addBankAndCard();
});
if (cookie === "") process.exit(1);
await step("page", "start-blank-home-empty-sentence", async () => {
  const content = plain(pageContent(await page("/", /Add your bills and the clients who pay you to see your next 30 days/)));
  expect(content.includes("Add your bills and the clients who pay you to see your next 30 days."), "blank-sentence");
  // The demo line is Try it's alone (Ben's fictional numbers); a blank household is the user's own.
  expect(!/A fictional household that lives in this browser/.test(content), "blank-demo-line-shown");
  expect(/Bank balance ¥120,000\./.test(content), "blank-bank-balance");
  expect(!/You(?:'|&#x27;)re fine/.test(content), "blank-fine-verdict");
  expect(/Nothing due in the next 30 days\. Add a bill ›/.test(content), "blank-coming-up-hint");
  expect(/Card N/.test(content), "blank-card-row");
  // The empty panel replaces the chart: its line and buttons show, the view switches do not.
  expect(content.includes("Nothing to forecast yet. Add a bill or a client and your next 30 days show here."), "blank-empty-panel-line");
  const html = (await request("/")).body;
  expect(!/aria-label="View"/.test(html) && !/>Forecast<\/button>/.test(html), "blank-view-switches-hidden");
});
// Start with my numbers never reuses the cookie household: a second post makes a new one and deletes the old demo.
await step("page", "start-form-says-it-replaces-the-demo", async () => {
  await page("/start", /This replaces your household in this browser and its numbers\./); // this browser holds a blank household, not Ben's Try it
  const fresh = await request("/start", { session: "" });
  expect(fresh.response.status === 200 && !/This replaces (the Try it|your) household/.test(pageContent(fresh.body)), "start-notice-without-demo");
});
await step("action", "start-blank-second-post-replaces-the-demo", async () => {
  const old = cookie;
  adopt(await request("/api/try/blank", { method: "POST", form: setup }), false, SETUP_START);
  await addBankAndCard();
  expect(cookie !== old, "blank-second-fresh-cookie");
  expect((await request("/api/events", { session: old })).response.status === 401, "blank-old-demo-gone");
  expect((await request("/api/events")).response.status === 200, "blank-new-demo-works");
});
await step("page", "start-blank-new-household-is-empty-again", () => page("/", /Add your bills and the clients who pay you to see your next 30 days/));
await step("action", "start-blank-add-rent", async () => {
  const result = await request("/api/bills", { method: "POST", form: { id: randomUUID(), biller: "Fictional rent", amount: "60,000", due: "2026-11-27", category: "housing", businessShare: "personal" } });
  expect(result.response.status === 303 && /^\/\?added=[0-9a-f-]{36}#coming-up$/.test(result.response.headers.get("location") ?? ""), "blank-bill-result");
});
await step("page", "start-blank-home-after-bill", async () => {
  const content = plain(pageContent(await page("/", /You(?:'|&#x27;)re fine for the next 30 days[\s\S]*¥60,000 on the 27th/)));
  expect(!/Add your bills and the clients/.test(content), "blank-empty-still-shown");
});
// D48 on a blank household (Try it numbers never move): a yearly bill with a new amount and a cancel-by date goes through the
// same door the form uses; Coming up says "Yearly" and has the cancel-by row, its event names what the bill carries.
await step("action", "start-blank-add-yearly-bill-with-cancel-by", async () => {
  const result = await request("/api/bills", { method: "POST", form: { id: randomUUID(), biller: "Fictional Cloud", amount: "12,000", due: "2026-12-01", category: "subscriptions", businessShare: "personal",
    repeat: "year", nextAmount: "13,000", nextAmountFrom: "2027-12-01", cancelBy: "2026-11-20", repeatUntil: "2028-06-01" } });
  expect(result.response.status === 303 && /^\/\?added=[0-9a-f-]{36}#coming-up$/.test(result.response.headers.get("location") ?? ""), "yearly-bill-result");
});
await step("page", "start-blank-coming-up-says-yearly-and-has-the-cancel-by-row", async () => {
  const content = plain(pageContent(await page("/", /Cancel Fictional Cloud by Nov 20/)));
  expect(content.includes("Cancel Fictional Cloud by Nov 20 or it renews at ¥12,000 on Dec 1"), "cancel-by-row-text");
  expect(/Subscriptions · reminder only/.test(content), "cancel-by-row-category");
  expect(/Fictional Cloud[^]*?Yearly/.test(content), "yearly-row-says-yearly");
  expect(content.includes("Yearly · last one Dec 1, 2027"), "yearly-row-says-the-last-payment");
  expect(content.indexOf("Cancel Fictional Cloud") < content.indexOf("Fictional rent"), "cancel-by-row-in-date-order");
});
await step("read", "start-blank-event-names-the-yearly-bill", async () => {
  const event = await sawEvent(/Fictional Cloud added, due Dec 1/);
  expect(event.body === "Every year · Changes to ¥13,000 from Dec 1, 2027 · Cancel by Nov 20 · Last one Dec 1, 2027", "yearly-event-line");
});
await step("action", "start-blank-fetch-form-gets-redirect-header", async () => {
  cookie = "";
  const result = await request("/api/try/blank", { method: "POST", form: setup, session: "", extraHeaders: { "x-form-fetch": "1" } });
  expect(result.response.status === 204 && result.response.headers.get("x-form-redirect") === SETUP_START, "blank-fetch-redirect");
  expect(/household=[A-Za-z0-9_-]{43};/.test(result.response.headers.get("set-cookie") ?? ""), "blank-fetch-cookie");
});
// Stage 15 A: Start asks only for a name (the bank balance is set on Home); the household lives on the real date; Home asks for one thing at a time.
await step("page", "stage15a-start-form-has-two-fields-and-folded-card-and-region", async () => {
  const html = await page("/start", /Your name/);
  const content = plain(pageContent(html));
  expect(!/in your bank today/.test(content) && !html.includes('name="bank"'), "a-no-bank-field");
  expect(/Your name/.test(content) && /· Change/.test(content), "a-start-labels");
  expect(!/Add a card now/.test(content) && !html.includes('name="card"'), "a-no-card-fields");
});
await step("action", "stage15a-start-two-fields", async () => adopt(await request("/api/try/blank", { method: "POST", form: setup, session: "" }), false, SETUP_START));
// The setup steps after "Start planning": one question per page, with a progress line, Back, Skip and Next (Finish on the last).
const SETUP_STEPS = [
  { step: "bank", question: /What(?:'|&#x27;|’)s in your bank today\?/, why: /So the forecast starts from today(?:'|&#x27;|’)s money\./, back: false, next: "Next", to: "/setup?step=income", control: 'name="amount"' },
  { step: "income", question: /Who pays you\?/, why: /So fipa knows what comes in\./, back: true, next: "Next", to: "/setup?step=bills", control: 'name="email"' },
  { step: "bills", question: /What do you pay every month\?/, why: /So the days money leaves show up\./, back: true, next: "Next", to: "/setup?step=card", control: "Rent" },
  { step: "card", question: /Do you pay with a credit card\?/, why: /So card bills land on the right day\./, back: true, next: "Finish", to: "/", control: 'name="closingDay"' },
];
for (const [index, item] of SETUP_STEPS.entries()) {
  await step("page", `setup-${item.step}-step-has-its-question-and-controls`, async () => {
    adopt(await request("/api/try/blank", { method: "POST", form: setup, session: "" }), false, SETUP_START); // a fresh blank household
    const html = await page(`/setup?step=${item.step}`, item.question);
    const content = plain(pageContent(html));
    expect(new RegExp(`Step ${index + 1} of 4`).test(content), "setup-progress");
    expect(html.includes('role="progressbar"') && html.includes(`aria-valuenow="${index + 1}"`), "setup-bar");
    expect(item.why.test(content), "setup-why");
    expect(html.includes(item.control), "setup-form-control");
    expect(/>Skip</.test(html) && new RegExp(`>${item.next}<`).test(html), "setup-skip-and-next");
    expect(html.includes(`href="${item.to.replace("?", "?")}"`), "setup-next-target");
    expect(item.back ? html.includes(`href="/setup?step=${SETUP_STEPS[index - 1]?.step}"`) && />Back</.test(html) : !/>Back</.test(html), "setup-back");
  });
}
await step("page", "setup-bills-step-offers-the-nine-chips", async () => {
  const html = await page("/setup?step=bills", /What do you pay every month\?/);
  for (const label of ["Rent", "Phone", "Internet", "Electricity", "Gas &amp; water", "Subscriptions", "Insurance", "Loan", "Other"]) expect(html.includes(`>${label}</button>`), "setup-chip");
});
await step("action", "setup-forms-save-and-stay-on-their-step", async () => {
  const bank = await request("/api/bank-balance", { method: "POST", form: { id: randomUUID(), amount: "250,000", returnTo: "/setup?step=bank" } });
  expect(bank.response.status === 303 && bank.response.headers.get("location") === "/setup?step=bank", "setup-bank-stays");
  const client = await request("/api/clients", { method: "POST", form: { id: randomUUID(), name: "Fictional Kestrel Studio", email: "accounts@kestrel.example", termsDays: "30", returnTo: "/setup?step=income" } });
  expect(client.response.status === 303 && client.response.headers.get("location") === "/setup?step=income", "setup-client-stays");
  const bill = await request("/api/bills", { method: "POST", form: { id: randomUUID(), biller: "Rent", amount: "80,000", due: "2026-12-27", category: "housing", businessShare: "personal", repeat: "month", returnTo: "/setup?step=bills" } });
  expect(bill.response.status === 303 && bill.response.headers.get("location") === "/setup?step=bills", "setup-bill-stays");
  const other = await request("/api/bank-balance", { method: "POST", form: { id: randomUUID(), amount: "1", returnTo: "/setup?step=elsewhere" } });
  expect(other.response.headers.get("location") === "/", "setup-return-target-checked");
  const bills = await page("/setup?step=bills", /Rent/);
  expect(/Bills so far/.test(bills) && /¥80,000/.test(plain(pageContent(bills))), "setup-bill-listed");
  expect(/Kestrel Studio/.test(await page("/setup?step=income", /Kestrel Studio/)), "setup-client-listed");
});
await step("guard", "setup-without-a-household-goes-to-start", async () => {
  const result = await request("/setup?step=bank", { session: "" });
  expect(result.response.status === 307 || result.response.status === 303 || /\/start/.test(result.body), "setup-needs-household");
});
await step("action", "setup-checks-leave-a-fresh-blank-session", async () => adopt(await request("/api/try/blank", { method: "POST", form: setup, session: "" }), false, SETUP_START));
await step("page", "stage15a-home-has-the-real-date-no-card", async () => {
  const html = await page("/", /Bank balance/);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  expect(html.includes(`dateTime="${today}"`), "a-real-date");
  const content = plain(pageContent(html));
  expect(/Bank balance ¥0\./.test(content), "a-bank");
  expect(/No card yet\./.test(content), "a-no-card");
});
await step("action", "stage15a-add-rent-shows-on-home", async () => {
  const result = await request("/api/bills", { method: "POST", form: { id: randomUUID(), biller: "Fictional rent", amount: "60,000", due: "2026-12-27", category: "housing", businessShare: "personal" } });
  expect(result.response.status === 303, "a-bill-result");
  await page("/", /Fictional rent/);
});
await step("action", "stage15a-try-it-keeps-nov-14-and-shows-get-started", async () => {
  adopt(await request("/api/try", { session: "" })); // a fresh session: with a cookie, /api/try keeps the current household
  const html = await page("/", /short on the 27th/);
  expect(html.includes('dateTime="2026-11-14"') && /18,780/.test(pageContent(html)) && /Get started/.test(pageContent(html)) && /Read the sentence and the forecast/.test(pageContent(html)), "a-try-it-date");
});
await step("page", "stage15a-start-notice-names-ben-for-try-it", () => page("/start", /This replaces the Try it household in this browser\. Reset in Settings brings Ben(?:'|&#x27;|’)s numbers back\./));

// Stage 15 C: every empty panel names what fills it and links there; rows lead to what they are about.
await step("action", "stage15c-blank-session", async () => {
  adopt(await request("/api/try/blank", { method: "POST", form: setup, session: "" }), false, SETUP_START);
  await addBankAndCard();
});
await step("page", "stage15c-empty-panel-hints-link-to-what-fills-them", async () => {
  const html = await page("/", /Nothing due in the next 30 days/);
  const content = plain(pageContent(html));
  expect(/Nothing due in the next 30 days\. Add a bill ›/.test(content) && html.includes('href="/add/bill?back=%2F"'), "c-coming-up-hint");
  expect(/No card charges yet\. Add a card charge ›/.test(content) && html.includes('href="/add/charge?back=%2F"'), "c-cards-hint");
  expect(html.includes('href="/cards"'), "c-cards-change-closing-day");
  expect(/Things the app read or drafted, waiting for your OK\. Nothing here now\./.test(content), "c-to-check-hint");
});
await step("page", "stage15c-to-check-page-hint", () => page("/to-check", /Things the app read or drafted, waiting for your OK\. Nothing here now\./));
await step("page", "stage15c-clients-hint-links-to-the-add-form", async () => {
  const html = await page("/clients", /No clients yet\. Add a client ›/);
  expect(html.includes('href="/add/client?back=%2Fclients"'), "c-clients-hint-link");
});
await step("action", "stage15c-add-rent", async () => {
  const result = await request("/api/bills", { method: "POST", form: { id: randomUUID(), biller: "Fictional rent", amount: "60,000", due: "2026-11-27", category: "housing", businessShare: "personal" } });
  expect(result.response.status === 303, "c-bill-result");
});
await step("page", "stage15c-coming-up-row-carries-a-link-to-its-bill", async () => {
  const html = await page("/", /Fictional rent/);
  expect(/href="\/bills\/[0-9a-f-]{36}"[^>]*>Fictional rent</.test(html), "c-coming-up-link");
  const bills = await page("/bills", /Fictional rent/);
  expect(/id="bill-[0-9a-f-]{36}"/.test(bills), "c-bills-row-anchor");
});
await step("action", "stage15c-try-it-session", async () => adopt(await request("/api/try", { session: "" })));
await step("page", "stage15c-paid-outside-event-points-at-the-invoice", async () => {
  const home = await page("/", /short on the 27th/);
  expect(/<a [^>]*href="#next-30-days"[^>]*>on the 27th</.test(home), "c-sentence-date-link");
  const id = /href="\/invoices\/([0-9a-f-]{36})"/.exec(home)?.[1];
  expect(id !== undefined, "c-invoice-id");
  const paid = await request("/api/invoices/paid", { method: "POST", form: { id } });
  expect(paid.response.status === 303, "c-paid-outside");
  const event = await sawEvent(/paid \$[\d,.]+ \(outside PayPal\)/);
  expect(event.refType === "invoice" && event.refId === id, "c-event-invoice-ref");
});
// Stage 15 B: the add forms show three fields, the rest under More ›, in the user's words
await step("action", "stage15b-try-it-session", async () => adopt(await request("/api/try", { session: "" }))); // the C block ends on a blank household
await step("page", "stage15b-bill-form-words-and-more", async () => {
  const html = pageContent(await page("/add/bill", /Add a bill/));
  const form = html.slice(html.indexOf("Add a bill"));
  expect(form.includes("Due date") && form.includes("Add bill"), "b-bill-three-fields");
  expect(form.indexOf("Add bill") < form.indexOf("More ›"), "b-add-button-before-more");
  expect(form.includes("For work?") && form.includes("Part work") && form.includes("Last day to cancel") && form.includes("Guessed from the name, change if wrong"), "b-more-words");
  expect(!/Business share|Biller|basis points|occurrence/.test(form), "b-engine-words-gone"); // case-sensitive: the field is still named "biller" in the page data
});
await step("action", "stage15b-three-field-bill-with-guessed-defaults", async () => {
  // what the browser posts for name "Fictional rent": the guessed category, repeat every month, personal
  const result = await request("/api/bills", { method: "POST", form: { id: randomUUID(), biller: "Fictional rent b", amount: "61,000", due: "2026-11-27", category: "housing", repeat: "month", businessShare: "personal" } });
  expect(result.response.status === 303, "b-bill-result");
  await page("/", /Fictional rent b/);
});
// Stage 19 gaps (D55), V-A: a bill saved with its amount not known is counted at the average of the same name's real bills,
// says so in Coming up, the "Added" line and To check → Missing, and filling the amount replaces the estimate.
{
  const unknownBill = (over) => ({ id: randomUUID(), biller: "Hikari Denki", due: "2026-11-25", category: "utilities", businessShare: "personal", amountUnknown: "on", ...over });
  const content = async (path, expected) => plain(pageContent(await page(path, expected)));
  const activityTitles = async (id) => (await events()).events.filter(event => event.refId === id).map(event => event.title);
  const ESTIMATE = "about ¥9,330 (¥8,640–¥10,020, from your last 2 bills)";
  const hikari = unknownBill();
  await step("action", "stage19-gaps-a-try-it-session", async () => adopt(await request("/api/try", { session: "" })));
  await step("action", "stage19-gaps-a-add-with-the-amount-not-known", async () => {
    const added = await request("/api/bills", { method: "POST", form: hikari });
    expect(added.response.status === 303, "s19a-add");
    const home = plain(pageContent((await request(added.response.headers.get("location"))).body));
    expect(home.includes(`Added Hikari Denki, ${ESTIMATE}, due Nov 25`), "s19a-added-line");
    expect(home.includes("¥28,800 short on the 27th") && !home.includes("Not counted:"), "s19a-late-counts-the-high-end-and-no-note");
    expect(home.slice(home.indexOf("Coming up")).includes(ESTIMATE) && home.includes("Enter it ›"), "s19a-coming-up-words");
  });
  await step("page", "stage19-gaps-a-to-check-missing-asks-for-the-amount", async () => {
    const check = await content("/to-check", /Missing/);
    expect(check.includes("Missing Hikari Denki, due Nov 25: how much?") && check.includes(`Counted at ${ESTIMATE}`), "s19a-missing-row");
    expect(/name="kind"[^>]*value="fill"|value="fill"[^>]*name="kind"/.test((await request("/to-check")).body), "s19a-fill-form");
    expect(!check.includes("Due soon") && !check.includes("Could change your forecast"), "s19a-not-urgent");
  });
  await step("action", "stage19-gaps-a-fill-the-amount-replaces-the-estimate", async () => {
    const filled = await request("/api/bills", { method: "POST", form: { kind: "fill", id: hikari.id, amount: "11,220", returnTo: "/to-check" } });
    expect(filled.response.status === 303 && filled.response.headers.get("location") === "/to-check", "s19a-fill");
    expect(!(await content("/to-check", /To check/)).includes("Hikari Denki, due Nov 25: how much?"), "s19a-row-gone");
    expect((await activityTitles(hikari.id)).includes("Hikari Denki: ¥11,220 (was about ¥9,330)"), "s19a-activity");
    expect((await content("/", /short on the 27th/)).includes("¥30,000 short on the 27th"), "s19a-sentence-after");
    const again = await request("/api/bills", { method: "POST", form: { kind: "fill", id: hikari.id, amount: "9,000", returnTo: "/to-check" } });
    expect(again.response.status === 400 && again.body === "This bill has its amount and its date already", "s19a-fill-twice");
  });
  // V-B: no history means no estimate: the bill is named, not counted, and the sentence says so.
  const gas = unknownBill({ biller: "Minato Gas", due: "2026-11-20" });
  await step("action", "stage19-gaps-b-try-it-session", async () => adopt(await request("/api/try", { session: "" })));
  await step("action", "stage19-gaps-b-add-with-no-history", async () => {
    const added = await request("/api/bills", { method: "POST", form: gas });
    expect(added.response.status === 303, "s19b-add");
    const home = plain(pageContent((await request(added.response.headers.get("location"))).body));
    expect(home.includes("Added Minato Gas, amount not known, due Nov 20"), "s19b-added-line");
    expect(home.includes("¥18,780 short on the 27th") && home.includes("Not counted: Minato Gas (amount not known)."), "s19b-sentence-note");
    expect(home.slice(home.indexOf("Coming up")).includes("amount not known"), "s19b-coming-up");
  });
  await step("page", "stage19-gaps-b-to-check-and-the-month-view", async () => {
    const check = await content("/to-check", /Missing/);
    expect(check.includes("Minato Gas, due Nov 20: how much?") && check.includes("Not counted until you enter it") && check.includes("Could change your forecast"), "s19b-missing-row");
    const month = await content("/spending", /Where the month goes/);
    expect(month.includes("1 bill not counted: Minato Gas (amount not known)") && !/Utilities\s*¥0/.test(month), "s19b-month-line");
    const search = await content("/spending?q=gas", /Minato Gas Nov 20/);
    expect(!search.includes("Nothing matches"), "s19b-search-not-empty");
    expect(search.includes("Minato Gas Nov 20 amount not known") && search.includes("1 bill not counted: Minato Gas (amount not known)"), "s19b-search-row");
    expect(search.includes("November amount not known") && !/Utilities\s*¥0/.test(search), "s19b-search-header-not-zero");
  });
  await step("action", "stage19-gaps-b-fill-removes-the-note", async () => {
    const filled = await request("/api/bills", { method: "POST", form: { kind: "fill", id: gas.id, amount: "6,800", returnTo: "/" } });
    expect(filled.response.status === 303, "s19b-fill");
    const home = await content("/", /short on the 27th/);
    expect(home.includes("¥25,580 short on the 27th") && !home.includes("Not counted:"), "s19b-sentence-after");
    expect((await activityTitles(gas.id)).includes("Minato Gas: ¥6,800"), "s19b-activity");
  });
}
await step("action", "long-uncounted-bill-appears-in-ask-and-spending-notes", async () => {
  const name = "LongBiller".repeat(6);
  const added = await request("/api/bills", { method: "POST", form: { id: randomUUID(), biller: name,
    due: "2026-11-25", category: "utilities", businessShare: "personal", amountUnknown: "on" } });
  expect(added.response.status === 303, "long-bill-saved");
  const ask = plain(pageContent(await page("/canvas", /This month/)));
  const month = plain(pageContent(await page("/spending", /Where the month goes/)));
  expect(ask.includes(`Not counted: ${name} (amount not known).`), "long-bill-ask-note");
  expect(month.includes(`1 bill not counted: ${name} (amount not known)`), "long-bill-month-note");
});

await step("action", "client-detail-accepts-the-full-120-character-name", async () => {
  const id = randomUUID();
  const name = "LongClient".repeat(12);
  const added = await request("/api/clients", { method: "POST", form: { id, name, email: "long-client@example.com", termsDays: "30" } });
  expect(added.response.status === 303 && added.response.headers.get("location") === `/clients/${id}`, "long-client-saved");
  const detail = await page(`/clients/${id}`, /Work and invoices/);
  expect(pageContent(detail).includes(name), "long-client-detail-name");
});

console.log(`${failures ? "FAIL" : "PASS"} summary ${failures} failed`);
process.exitCode = failures ? 1 : 0;
