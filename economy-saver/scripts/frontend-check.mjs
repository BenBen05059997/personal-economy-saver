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
async function request(path, { method = "GET", form, json, session = cookie, extraHeaders = {} } = {}) {
  // Every URL is selected by this script; redirects never leave the local origin.
  expect(path.startsWith("/") && !path.startsWith("//"), "invalid-local-path");
  const headers = { Origin: base.origin, "Sec-Fetch-Site": "same-origin", ...extraHeaders };
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
// The sentence is built from several text nodes, so its words can sit apart ("rent , your"): close the gap before punctuation.
const plain = (content) => content.replace(/\s+([,.])/g, "$1");
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
    ["bill-with-schedule-without-household", "/api/bills", { method: "POST", form: { id: "x", biller: "Fictional Cloud", amount: "12000", due: "2026-12-01", category: "subscriptions", repeat: "year", cancelBy: "2026-11-20" } }, 401],
    ["settle-without-household", "/api/settle", { method: "POST" }, 401],
    ["remove-without-household", "/api/remove", { method: "POST" }, 401],
    ["privacy-page-without-cookie", "/privacy", { session: "" }, 200],
    ["cron-without-bearer", "/api/cron", {}, 401],
  ];
  for (const [label, path, options, status, location] of checks) {
    await step("guard", label, async () => {
      const { response, body } = await request(path, options);
      expect(response.status === status, "guard-status");
      if (label === "privacy-page-without-cookie") for (const word of ["Supabase", "Tokyo", "Anthropic", "seven days"]) expect(text(body).includes(word), "privacy-" + word);
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
// D47: Try it arrives with every step true, so the First steps panel never shows and the demo numbers are untouched.
await step("page", "home-try-it-has-no-first-steps", async () => {
  const html = await page("/", /18,780/);
  expect(!/First steps/.test(pageContent(html)), "first-steps-shown");
  expect(!/Add your rent\s*,\s*your bills and the clients/.test(pageContent(html)), "empty-sentence-shown");
  // Any demo household says so on Home and links to Start with my numbers.
  expect(/A fictional household that lives in this browser/.test(plain(pageContent(html))) && /href="\/start"/.test(html), "demo-line-missing");
  // The + Add menu offers the two things people add most, linking to the Home anchors the entry form opens from.
  expect(/href="\/#add-bill"[^>]*>Add a bill</.test(html) && /href="\/#add-charge"[^>]*>Add a card charge</.test(html), "add-menu-bill-and-charge");
});
await step("page", "cards", () => page("/cards", /Card B/));
await step("page", "clients", () => page("/clients", /Beacon/));
await step("page", "plan", () => page("/plan", /Add a pot/));
await step("page", "plan-where-the-month-goes", () => page("/plan", /Where the month goes[\s\S]*Housing ¥82,000/));
await step("page", "activity", () => page("/activity", /Hikari Denki/));
await step("page", "seeded-invoice-review-read-only", async () => {
  const id = home?.match(/href="\/invoices\/([0-9a-f-]{36})"/i)?.[1]
    ?? (home && flight(home).match(/"href"\s*:\s*"\/invoices\/([0-9a-f-]{36})"/i)?.[1]);
  expect(id, "invoice-link");
  const review = plain(pageContent(await page("/invoices/" + id, /Review invoice/)));
  expect(review.includes("Beacon Studio usually pays 2 days after you send, slowest 3"), "invoice-review-client-pace");
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
await step("page", "plan-utilities-after-confirm", () => page("/plan", /Utilities ¥11,220/));
// A category outside the thirteen keys is refused before anything is saved (needs a session: the guards suite sends none).
await step("guard", "bill-with-unknown-category-refused", async () => {
  const result = await request("/api/bills", { method: "POST", form: { id: randomUUID(), biller: "Fictional vet", amount: "4000", due: "2026-11-20", category: "pets", businessShare: "personal" } });
  expect(result.response.status === 400 && result.body === "Choose a category from the list.", "bad-category-result");
});
// A refused form answers with its message (the page shows it inline and keeps what was typed); a native post, as here,
// gets the same status and text. The shared form posts with "x-form-fetch: 1" and is answered a redirect as 204 plus a header.
const refused = (label, fields, message) => step("guard", label, async () => {
  const result = await request("/api/bills", { method: "POST", form: { id: randomUUID(), biller: "Fictional vet", amount: "4000", due: "2026-11-20", category: "other", businessShare: "personal", ...fields } });
  expect(result.response.status === 400 && result.body === message, "refused-result");
});
await refused("bill-with-amount-0-refused-with-message", { amount: "0" }, "The amount must be more than zero");
await refused("bill-over-yen-limit-refused-with-message", { amount: "100,000,001" }, "Enter an amount up to ¥100,000,000");
await refused("bill-dated-over-two-years-refused-with-message", { due: "2029-01-01" }, "Choose a date within the next two years");
// D48: a schedule that does not hang together is refused with its words and nothing is saved.
await refused("bill-new-amount-without-date-refused-with-message", { repeat: "year", nextAmount: "13000" }, "Give the new amount together with the date it starts");
await refused("bill-new-amount-on-a-one-off-refused-with-message", { nextAmount: "13000", nextAmountFrom: "2027-12-01" }, "A new amount needs a bill that repeats: choose Every month or Every year");
await refused("bill-new-amount-on-or-before-due-refused-with-message", { repeat: "year", nextAmount: "13000", nextAmountFrom: "2026-11-20" }, "The new amount must start after the due date");
await refused("bill-cancel-by-after-the-renewal-refused-with-message", { repeat: "year", cancelBy: "2026-11-21" }, "Choose a cancel-by date before the bill is next charged on Nov 20");
await refused("bill-cancel-by-over-two-years-refused-with-message", { cancelBy: "2029-01-01" }, "Choose a date within the next two years");
await refused("bill-new-amount-over-yen-limit-refused-with-message", { repeat: "year", nextAmount: "100,000,001", nextAmountFrom: "2027-11-20" }, "Enter an amount up to ¥100,000,000");
await refused("bill-with-an-unknown-repeat-refused", { repeat: "week" }, "Check the required fields and try again.");
await step("action", "bill-with-thousands-separator-saved-and-removed", async () => {
  const id = randomUUID();
  const form = { id, biller: "Fictional separator bill", amount: "1,000", due: "2026-11-20", category: "other", businessShare: "personal" };
  const native = await request("/api/bills", { method: "POST", form });
  expect(native.response.status === 303 && native.response.headers.get("location") === "/", "bill-native-result");
  const again = await request("/api/bills", { method: "POST", form, extraHeaders: { "x-form-fetch": "1" } });
  expect(again.response.status === 204 && again.response.headers.get("x-form-redirect") === "/" && !again.response.headers.get("location"), "bill-form-result");
  const removed = await request("/api/remove", { method: "POST", form: { kind: "bill", id, returnTo: "/settings" }, extraHeaders: { "x-form-fetch": "1" } });
  expect(removed.response.status === 204 && removed.response.headers.get("x-form-redirect") === "/settings", "remove-form-result");
  const gone = await request("/api/remove", { method: "POST", form: { kind: "bill", id } });
  expect(gone.response.status === 303 && gone.response.headers.get("location") === "/", "remove-twice-native-result");
  const data = await events();
  expect(data.events.filter(event => event.kind === "bill_removed" && event.refId === id).length === 1, "remove-single-event");
});
await step("guard", "remove-with-bad-fields-refused", async () => {
  const result = await request("/api/remove", { method: "POST", form: { kind: "pot", id: "nope" } });
  expect(result.response.status === 400, "remove-bad-fields-status");
});
await step("read", "confirm-single-event", async () => {
  expect(bill, "seed-bill");
  const data = await events();
  expect(data.events.filter(event => event.kind === "bill_confirmed" && event.refId === bill).length === 1, "confirm-event-count");
});
// Ask goes to the agent (D40). Without the owner's AI settings it must stop with the missing setting's name (rule 10);
// with them it must answer from the engine's numbers.
await step("action", "typed-ask-read-only", async () => {
  const result = await request("/api/ask", { method: "POST", json: { id: randomUUID(), text: "Where do I stand?", source: "manual" } });
  if (result.response.status === 503 && /^Ask isn't set up on this server yet \(ANTHROPIC_[A-Z_]+ is not set\)\.$/.test(result.body)) {
    console.log(`NOTE typed-ask-read-only: ${result.body}; the live answer is not checked`);
    return;
  }
  expect(result.response.status === 200, "ask-status");
  const answer = JSON.parse(result.body);
  expect(answer.pending === false && typeof answer.answer === "string" && /30,000/.test(answer.answer), "ask-result");
});
await step("page", "settings", () => page("/settings", /Household &amp; bank|Household & bank/));
await step("page", "settings-offers-start-over-with-my-numbers", () => page("/settings", /Start over with my numbers/));
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
  expect(result.response.status === 400 && result.body === "Enter a whole number of yen, like 5000 or 5,000", "invalid-settings-result");
});
await step("action", "settings-save-fictional-name", async () => {
  const result = await request("/api/settings", { method: "POST", form: { kind: "household", name: "Fictional Check", bank: "67000" } });
  expect(result.response.status === 200 && result.body === "Settings saved", "save-settings-result");
});
// D50: the one standing rule. Off by default; 1 to 60 or empty; it only suggests (the page says sending still needs the tap).
await step("page", "settings-nudge-is-off-and-says-it-only-suggests", async () => {
  const content = plain(pageContent(await page("/settings", /Suggest a nudge when a client is N days past due/)));
  expect(content.includes("It only suggests. Sending a reminder still needs your tap."), "nudge-hint");
});
await step("guard", "settings-nudge-out-of-range-refused", async () => {
  for (const afterDays of ["0", "61", "2.5", "abc"]) {
    const result = await request("/api/settings", { method: "POST", form: { kind: "nudge", afterDays } });
    expect(result.response.status === 400, "nudge-refused-" + afterDays);
  }
});
await step("action", "settings-nudge-on-then-off", async () => {
  const on = await request("/api/settings", { method: "POST", form: { kind: "nudge", afterDays: "5" } });
  expect(on.response.status === 200 && on.body === "Settings saved", "nudge-on-result");
  const shown = (await request("/settings")).body;
  expect(/name="afterDays"[^>]*value="5"|value="5"[^>]*name="afterDays"/.test(shown) || /"name"\s*:\s*"afterDays"[^}]*"(?:defaultValue|value)"\s*:\s*"?5/.test(flight(shown)), "nudge-saved-value");
  await page("/activity", /Nudge suggestions on, 5 days past due/);
  const off = await request("/api/settings", { method: "POST", form: { kind: "nudge", afterDays: "" } });
  expect(off.response.status === 200, "nudge-off-result");
  await page("/activity", /Nudge suggestions turned off/);
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
// D47: Start with my numbers. A blank demo says what to add (never "You're fine"), shows three open first steps, and
// changes to the normal sentence and two open steps once a bill is added through the same door the form uses.
cookie = "";
const setup = { name: "Fictional newcomer", currency: "JPY", timeZone: "Asia/Tokyo", bank: "120,000", card: "Card N", closingDay: "25", dueDay: "10", limit: "" };
await step("guard", "start-blank-bad-form-refused", async () => {
  const result = await request("/api/try/blank", { method: "POST", form: { ...setup, closingDay: "40" }, session: "" });
  expect(result.response.status === 400 && !result.response.headers.get("set-cookie"), "blank-bad-form");
});
await step("action", "start-blank-session", async () => adopt(await request("/api/try/blank", { method: "POST", form: setup, session: "" })));
if (cookie === "") process.exit(1);
await step("page", "start-blank-home-empty-sentence", async () => {
  const content = plain(pageContent(await page("/", /Add your rent\s*,\s*your bills and the clients who pay you to see your next 30 days/)));
  expect(content.includes("Add your rent, your bills and the clients who pay you to see your next 30 days."), "blank-sentence");
  expect(/A fictional household that lives in this browser[^›]*Start with my numbers ›/.test(content), "blank-demo-line");
  expect(/Bank balance ¥120,000\./.test(content), "blank-bank-balance");
  expect(!/You(?:'|&#x27;)re fine/.test(content), "blank-fine-verdict");
  expect(/First steps · 3 to go/.test(content), "blank-three-steps-open");
  for (const label of ["Add a bill", "Add a client who pays you", "Add a card charge"]) expect(content.includes(label), "blank-step-" + label);
  expect(/Nothing due yet\. Add your rent/.test(content), "blank-coming-up-hint");
  expect(/Card N/.test(content), "blank-card-row");
});
// Start with my numbers never reuses the cookie household: a second post makes a new one and deletes the old demo.
await step("page", "start-form-says-it-replaces-the-demo", async () => {
  await page("/start", /This replaces the Try it household in this browser\. Reset in Settings brings Ben(?:'|&#x27;)s numbers back\./);
  const fresh = await request("/start", { session: "" });
  expect(fresh.response.status === 200 && !/This replaces the Try it household/.test(pageContent(fresh.body)), "start-notice-without-demo");
});
await step("action", "start-blank-second-post-replaces-the-demo", async () => {
  const old = cookie;
  adopt(await request("/api/try/blank", { method: "POST", form: setup }));
  expect(cookie !== old, "blank-second-fresh-cookie");
  expect((await request("/api/events", { session: old })).response.status === 401, "blank-old-demo-gone");
  expect((await request("/api/events")).response.status === 200, "blank-new-demo-works");
});
await step("page", "start-blank-new-household-is-empty-again", () => page("/", /Add your rent\s*,\s*your bills and the clients who pay you to see your next 30 days/));
await step("action", "start-blank-add-rent", async () => {
  const result = await request("/api/bills", { method: "POST", form: { id: randomUUID(), biller: "Fictional rent", amount: "60,000", due: "2026-11-27", category: "housing", businessShare: "personal" } });
  expect(result.response.status === 303 && result.response.headers.get("location") === "/", "blank-bill-result");
});
await step("page", "start-blank-home-after-bill", async () => {
  const content = plain(pageContent(await page("/", /You(?:'|&#x27;)re fine for the next 30 days[\s\S]*¥60,000 on the 27th/)));
  expect(!/Add your rent, your bills and the clients/.test(content), "blank-empty-still-shown");
  expect(/First steps · 2 to go/.test(content) && content.includes("Bill added"), "blank-two-steps-left");
  expect(!/Add a bill Rent/.test(content), "blank-bill-step-still-open");
});
// D48 on a blank household (Try it numbers never move): a yearly bill with a new amount and a cancel-by date goes through the
// same door the form uses; Coming up says "Yearly" and has the cancel-by row, Activity names what the bill carries.
await step("action", "start-blank-add-yearly-bill-with-cancel-by", async () => {
  const result = await request("/api/bills", { method: "POST", form: { id: randomUUID(), biller: "Fictional Cloud", amount: "12,000", due: "2026-12-01", category: "subscriptions", businessShare: "personal",
    repeat: "year", nextAmount: "13,000", nextAmountFrom: "2027-12-01", cancelBy: "2026-11-20" } });
  expect(result.response.status === 303 && result.response.headers.get("location") === "/", "yearly-bill-result");
});
await step("page", "start-blank-coming-up-says-yearly-and-has-the-cancel-by-row", async () => {
  const content = plain(pageContent(await page("/", /Cancel Fictional Cloud by Nov 20/)));
  expect(content.includes("Cancel Fictional Cloud by Nov 20 or it renews at ¥12,000 on Dec 1"), "cancel-by-row-text");
  expect(/Subscriptions · reminder only/.test(content), "cancel-by-row-category");
  expect(/Fictional Cloud[^]*?Yearly/.test(content), "yearly-row-says-yearly");
  expect(content.indexOf("Cancel Fictional Cloud") < content.indexOf("Fictional rent"), "cancel-by-row-in-date-order");
});
await step("page", "start-blank-activity-names-the-yearly-bill", async () => {
  const content = plain(pageContent(await page("/activity", /Fictional Cloud added, due Dec 1/)));
  expect(content.includes("Every year · Changes to ¥13,000 from Dec 1, 2027 · Cancel by Nov 20"), "yearly-activity-line");
});
await step("page", "start-blank-plan-month-counts-the-yearly-bill-in-its-month-only", async () => {
  const content = plain(pageContent(await page("/plan", /Where the month goes/)));
  expect(!/Fictional Cloud/.test(content), "yearly-bill-not-in-november");
});
await step("action", "start-blank-fetch-form-gets-redirect-header", async () => {
  cookie = "";
  const result = await request("/api/try/blank", { method: "POST", form: setup, session: "", extraHeaders: { "x-form-fetch": "1" } });
  expect(result.response.status === 204 && result.response.headers.get("x-form-redirect") === "/", "blank-fetch-redirect");
  expect(/household=[0-9a-f-]{36}/.test(result.response.headers.get("set-cookie") ?? ""), "blank-fetch-cookie");
});
console.log(`${failures ? "FAIL" : "PASS"} summary ${failures} failed`);
process.exitCode = failures ? 1 : 0;
