// Opt-in HTTP checks against a running local app. Creates fictional Try-it data only.
// node scripts/frontend-check.mjs --run http://127.0.0.1:3123
// --extra checks reader pages and saves/retries a fictional draft without sending.
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
function expect(condition, code) { if (!condition) throw new Error(code); }
async function request(path, { method = "GET", form, json, session = cookie } = {}) {
  // Every URL is selected by this script; redirects never leave the local origin.
  expect(path.startsWith("/") && !path.startsWith("//"), "invalid-local-path");
  const headers = { Origin: base.origin, "Sec-Fetch-Site": "same-origin" };
  if (session) headers.Cookie = session;
  if (json) headers["Content-Type"] = "application/json";
  const response = await fetch(new URL(path, base), {
    method, headers, redirect: "manual", signal: AbortSignal.timeout(30_000),
    body: form ? new URLSearchParams(form) : json ? JSON.stringify(json) : undefined,
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
    return undefined;
  }
}
function text(html) {
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
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
async function page(path, content) {
  const result = await request(path);
  expect(result.response.status === 200, "page-status");
  expect(content.test(pageContent(result.body)), "page-content");
  expect(!/Something went wrong|Application error:/.test(pageContent(result.body)), "page-error");
  return result.body;
}
async function events() {
  const result = await request("/api/events");
  expect(result.response.status === 200, "events-status");
  const data = JSON.parse(result.body);
  expect(Array.isArray(data.events) && Number.isInteger(data.feed?.unread), "events-shape");
  return data;
}
function adopt(result) {
  expect(result.response.status === 303 && result.response.headers.get("location") === "/", "session-redirect");
  const next = result.response.headers.get("set-cookie")?.match(/(?:^|,\s*)household=([^;]+)/)?.[1];
  expect(next && /^[0-9a-f-]{36}$/i.test(next), "session-cookie");
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
    if (tag !== "form" || props.action !== "/api/invoices/draft") return;
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
    ["callback-without-code", "/api/auth/callback", {}, 303, "/login?expired=1"],
    ["approve-without-household", "/api/approve", { method: "POST" }, 401],
    ["unsigned-webhook", "/api/paypal/webhook", { method: "POST", json: { id: "fictional-check", event_type: "INVOICING.INVOICE.PAID" } }, 400],
    ["private-upload-without-household", "/api/upload", { method: "POST" }, 401],
    ["inbound-without-worker-origin", "/api/inbound", { method: "POST" }, 403],
    ["mcp-without-bearer", "/api/mcp", { method: "POST" }, 401],
    ["mcp-issue-without-household", "/api/mcp/tokens", { method: "POST" }, 401],
    ["ai-key-without-household", "/api/settings/ai-key", { method: "POST" }, 401],
    ["export-without-household", "/api/export", { method: "POST" }, 401],
    ["people-without-household", "/api/people", { method: "POST" }, 401],
    ["settle-without-household", "/api/settle", { method: "POST" }, 401],
    ["cron-without-bearer", "/api/cron", {}, 401],
  ];
  for (const [label, path, options, status, location] of checks) {
    await step("guard", label, async () => {
      const { response } = await request(path, options);
      expect(response.status === status, "guard-status");
      if (location) expect(response.headers.get("location") === location, "guard-redirect");
    });
  }
  console.log(`${failures ? "FAIL" : "PASS"} summary ${failures} failed`);
  process.exit(failures ? 1 : 0);
}

await step("action", "create-fictional-session", async () => adopt(await request("/api/try")));
if (!cookie) process.exit(1); // Never proceed against an unverified session.
if (args[0] === "--extra") {
  await step("page", "authenticated-upload", () => page("/upload", /Upload a bill or receipt/));
  await step("guard", "authenticated-invalid-upload", async () => {
    const result = await request("/api/upload", { method: "POST", form: {} });
    expect(result.response.status === 400 && result.body === "Select a file to upload.", "invalid-upload-result");
  });
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
  console.log(`${failures ? "FAIL" : "PASS"} summary ${failures} failed`);
  process.exit(failures ? 1 : 0);
}
const firstCookie = cookie;
// Cold means first Home in this fresh session, not a restarted server or cleared compiler cache.
const home = await step("page", "home-first-session", () => page("/", /18,780/));
await step("page", "home-warm", () => page("/", /18,780/));
await step("page", "cards", () => page("/cards", /Card B/));
await step("page", "clients", () => page("/clients", /Beacon/));
await step("page", "plan", () => page("/plan", /Add a pot/));
await step("page", "activity", () => page("/activity", /Hikari Denki/));
await step("page", "seeded-invoice-review-read-only", async () => {
  const id = home?.match(/href="\/invoices\/([0-9a-f-]{36})"/i)?.[1]
    ?? (home && flight(home).match(/"href"\s*:\s*"\/invoices\/([0-9a-f-]{36})"/i)?.[1]);
  expect(id, "invoice-link");
  await page("/invoices/" + id, /Review invoice/);
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
await step("read", "confirm-single-event", async () => {
  expect(bill, "seed-bill");
  const data = await events();
  expect(data.events.filter(event => event.kind === "bill_confirmed" && event.refId === bill).length === 1, "confirm-event-count");
});
// Ask goes to the agent (D40). Without the owner's AI settings it must stop with the missing setting's name (rule 10);
// with them it must answer from the engine's numbers.
await step("action", "typed-ask-read-only", async () => {
  const result = await request("/api/ask", { method: "POST", json: { id: randomUUID(), text: "Where do I stand?", source: "manual" } });
  if (result.response.status === 503 && /^ANTHROPIC_[A-Z_]+ is not set$/.test(result.body)) {
    console.log(`NOTE typed-ask-read-only: ${result.body}; the live answer is not checked`);
    return;
  }
  expect(result.response.status === 200, "ask-status");
  const answer = JSON.parse(result.body);
  expect(answer.pending === false && typeof answer.answer === "string" && /30,000/.test(answer.answer), "ask-result");
});
await step("page", "settings", () => page("/settings", /Household &amp; bank|Household & bank/));
await step("action", "export-my-data", async () => {
  const result = await request("/api/export", { method: "POST" });
  const { headers } = result.response;
  expect(result.response.status === 200 && headers.get("content-type") === "application/json", "export-status");
  expect(/^attachment; filename="personal-economy-saver-\d{4}-\d{2}-\d{2}\.json"$/.test(headers.get("content-disposition") ?? ""), "export-disposition");
  expect(/no-store/.test(headers.get("cache-control") ?? ""), "export-no-store");
  const data = JSON.parse(result.body);
  expect(data.version === 1 && Array.isArray(data.events) && data.clients.length === 3, "export-shape");
  expect(!/ai_?key|tokenHash|storagePath|payload/i.test(result.body), "export-no-secrets");
  const get = await fetch(new URL("/api/export", base), { headers: { Cookie: cookie, Origin: base.origin }, redirect: "manual" });
  expect(get.status === 405, "export-get-refused");
});
await step("action", "settings-invalid-input", async () => {
  const result = await request("/api/settings", { method: "POST", form: { kind: "household", name: "Fictional Check", bank: "invalid" } });
  expect(result.response.status === 400 && /required fields and amounts/.test(result.body), "invalid-settings-result");
});
await step("action", "settings-save-fictional-name", async () => {
  const result = await request("/api/settings", { method: "POST", form: { kind: "household", name: "Fictional Check", bank: "67000" } });
  expect(result.response.status === 200 && result.body === "Settings saved", "save-settings-result");
});
await step("page", "settings-reload-saved-name", async () => {
  const html = await page("/settings", /Settings/);
  const htmlField = (html.match(/<input\b[^>]*>/gi) ?? []).some(input => /name="name"/.test(input) && /value="Fictional Check"/.test(input));
  const flightField = /"name"\s*:\s*"name"[^}]*"(?:defaultValue|value)"\s*:\s*"Fictional Check"/.test(flight(html));
  expect(htmlField || flightField, "saved-name-field");
});
await step("action", "reset-fictional-session", async () => {
  const old = cookie;
  adopt(await request("/api/try/reset", { method: "POST" }));
  expect(cookie !== old && cookie !== firstCookie, "reset-fresh-session");
});
await step("page", "home-after-reset-18780", () => page("/", /18,780/));
await step("read", "reset-invalidates-old-session", async () => {
  const result = await request("/api/events", { session: firstCookie });
  expect(result.response.status === 401, "old-session-status");
});
console.log(`${failures ? "FAIL" : "PASS"} summary ${failures} failed`);
process.exitCode = failures ? 1 : 0;
