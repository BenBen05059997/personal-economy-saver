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
    if (process.env.CHECK_DEBUG && error instanceof Error && /^[a-z0-9-]+$/.test(error.message)) console.log(`  code ${error.message}`); // expect codes only, never a body
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
    ["sign-in-json-body", "/api/auth/link", { method: "POST", json: { email: "a@example.com" } }, 400],
    ["callback-without-code", "/api/auth/callback", {}, 303, "/login?expired=1"],
    ["approve-without-household", "/api/approve", { method: "POST" }, 401],
    ["unsigned-webhook", "/api/paypal/webhook", { method: "POST", json: { id: "fictional-check", event_type: "INVOICING.INVOICE.PAID" } }, 400],
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
    ["ask-without-household", "/api/ask", { method: "POST", session: "", json: { id: "x" } }, 401],
    ["confirm-and-remember-without-household", "/api/confirm", { method: "POST", session: "", form: { kind: "reading", id: "00000000-0000-4000-8000-000000000000", remember: "on" } }, 401],
    ["confirm-and-remember-cross-origin", "/api/confirm", { method: "POST", session: "", form: { kind: "reading", id: "00000000-0000-4000-8000-000000000000", remember: "on" }, extraHeaders: { Origin: "http://cross-origin.test", "Sec-Fetch-Site": "cross-site" } }, 403],
    ["export-without-household", "/api/export", { method: "POST" }, 401],
    ["people-without-household", "/api/people", { method: "POST" }, 401],
    ["bill-fill-without-household", "/api/bills", { method: "POST", session: "", form: { kind: "fill", id: "x", amount: "1000", returnTo: "/to-check" } }, 401],
    ["bill-fill-cross-origin", "/api/bills", { method: "POST", session: "", form: { kind: "fill", id: "x", amount: "1000", returnTo: "/to-check" }, extraHeaders: { Origin: "http://cross-origin.test", "Sec-Fetch-Site": "cross-site" } }, 403],
    ["bill-with-schedule-without-household", "/api/bills", { method: "POST", form: { id: "x", biller: "Fictional Cloud", amount: "12000", due: "2026-12-01", category: "subscriptions", repeat: "year", cancelBy: "2026-11-20" } }, 401],
    ["settle-without-household", "/api/settle", { method: "POST" }, 401],
    ["canvas-resolve-without-household", "/api/canvas/resolve", { method: "POST", session: "", json: { recipe: { version: 1, title: "Probe", blocks: [] } } }, 401],
    ["canvas-resolve-cross-origin", "/api/canvas/resolve", { method: "POST", session: "", json: { recipe: { version: 1, title: "Probe", blocks: [] } }, extraHeaders: { Origin: "http://cross-origin.test", "Sec-Fetch-Site": "cross-site" } }, 403],
    ["memory-without-household", "/api/memory", { method: "POST", session: "", form: { kind: "forget_all", returnTo: "/memory" } }, 401],
    ["memory-cross-origin", "/api/memory", { method: "POST", session: "", form: { kind: "forget_all", returnTo: "/memory" }, extraHeaders: { Origin: "http://cross-origin.test", "Sec-Fetch-Site": "cross-site" } }, 403],
    ["remove-without-household", "/api/remove", { method: "POST" }, 401],
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
        expect(plain.includes("This server has no AI model set up.") || /By default, questions and documents go to [a-z0-9.-]+\.[a-z]+\./.test(plain), "privacy-ai-host-line");
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
  await step("page", "authenticated-upload", () => page("/upload", /Upload a bill or receipt/));
  await step("guard", "authenticated-invalid-upload", async () => {
    const result = await request("/api/upload", { method: "POST", form: {} });
    expect(result.response.status === 400 && result.body === "Select a file to upload.", "invalid-upload-result");
  });
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
  // Nov 5 walk: edit a bill from Settings, remove a person once settled, leave a cookie household (last: it drops the cookie).
  await step("action", "nov5-try-it-session", async () => adopt(await request("/api/try", { session: "" })));
  await step("page", "nov5-settings-bill-rows-have-edit-and-a-repeating-bill-asks-from-when", async () => {
    const html = await page("/settings", /Fictional|Rent/);
    const content = plain(pageContent(html));
    expect(/aria-label="Edit Rent"/.test(html) && /New amount from/.test(content) && /Choose the first due date, [A-Z][a-z]{2} \d{1,2}, to correct every one\./.test(content), "nov5-edit-form");
  });
  await step("action", "nov5-edit-a-bill-category-and-amount", async () => {
    const id = randomUUID();
    const add = await request("/api/bills", { method: "POST", form: { id, biller: "Fictional noodle stand", amount: "1,200", due: "2026-11-20", category: "other", businessShare: "personal" } });
    expect(add.response.status === 303, "nov5-add");
    const edit = { kind: "edit", id, biller: "Fictional noodle stand", amount: "980", due: "2026-11-20", category: "food", businessShare: "personal", memberId: "", paidByMemberId: "", returnTo: "/settings" };
    const saved = await request("/api/bills", { method: "POST", form: edit, extraHeaders: { "x-form-fetch": "1" } });
    expect(saved.response.status === 204 && saved.response.headers.get("x-form-redirect") === "/settings", "nov5-edit-result");
    const again = await request("/api/bills", { method: "POST", form: edit });
    expect(again.response.status === 303 && again.response.headers.get("location") === "/settings", "nov5-edit-native-result");
    const changed = (await events()).events.filter(event => event.kind === "bill_changed" && event.refId === id);
    expect(changed.length === 1 && changed[0].body === "Amount ¥1,200 → ¥980 · Category Other → Food" && changed[0].madeBy === "form", "nov5-one-bill-changed-event");
    await page("/activity", /Fictional noodle stand bill changed/);
    const removed = await request("/api/remove", { method: "POST", form: { kind: "bill", id, returnTo: "/settings" } });
    expect(removed.response.status === 303, "nov5-remove");
  });
  await step("guard", "nov5-edit-of-an-unknown-bill-refused", async () => {
    const result = await request("/api/bills", { method: "POST", form: { kind: "edit", id: randomUUID(), biller: "Fictional probe", amount: "1", due: "2026-11-20", category: "other", businessShare: "personal" } });
    expect(result.response.status === 400 && result.body === "Choose a bill of this household", "nov5-unknown-bill");
  });
  await step("guard", "nov5-bills-unknown-kind-and-json-refused", async () => {
    const bogus = await request("/api/bills", { method: "POST", form: { kind: "rename", id: randomUUID() } });
    const json = await request("/api/bills", { method: "POST", json: { kind: "edit" } });
    expect(bogus.response.status === 400 && json.response.status === 400 && json.body === "Check the required fields and try again.", "nov5-bills-bad-kind");
  });
  await step("action", "nov5-remove-a-person-only-once-settled", async () => {
    const added = await request("/api/people", { method: "POST", form: { kind: "add", name: "Fictional Wife" } });
    expect(added.response.status === 200, "nov5-person-added");
    const html = await page("/settings", /Fictional Wife/);
    const ids = [...html.matchAll(/name="name:([0-9a-f-]{36})"/g)].map(match => match[1]);
    expect(ids.length === 2, "nov5-two-people");
    const wife = ids[1];
    const content = plain(pageContent(html));
    expect(content.includes("Fictional Wife’s bills become shared and paid by Ben.") && /aria-label="Remove Fictional Wife"/.test(html), "nov5-remove-note");
    const bill = await request("/api/bills", { method: "POST", form: { id: randomUUID(), biller: "Fictional groceries", amount: "30,000", due: "2026-11-14", category: "food", businessShare: "personal", paidByMemberId: wife } });
    expect(bill.response.status === 303, "nov5-shared-bill");
    const owed = await request("/api/people", { method: "POST", form: { kind: "remove", id: wife, returnTo: "/settings" } });
    expect(owed.response.status === 400 && owed.body === "Settle up with Fictional Wife first.", "nov5-settle-first");
    const owner = await request("/api/people", { method: "POST", form: { kind: "remove", id: ids[0], returnTo: "/settings" } });
    expect(owner.response.status === 400 && owner.body === "The household’s owner cannot be removed", "nov5-owner-stays");
    const settled = await request("/api/settle", { method: "POST", form: { returnTo: "/" } });
    expect(settled.response.status === 303, "nov5-settled");
    const removed = await request("/api/people", { method: "POST", form: { kind: "remove", id: wife, returnTo: "/settings" }, extraHeaders: { "x-form-fetch": "1" } });
    expect(removed.response.status === 204 && removed.response.headers.get("x-form-redirect") === "/settings", "nov5-removed");
    const gone = await request("/api/people", { method: "POST", form: { kind: "remove", id: wife, returnTo: "/settings" } });
    expect(gone.response.status === 400 && gone.body === "Choose a person of this household", "nov5-removed-twice");
    expect((await events()).events.some(event => event.kind === "person_removed" && event.title === "Fictional Wife left the household"), "nov5-person-removed-event");
    expect(!/Fictional Wife/.test(pageContent(await page("/settings", /People/))), "nov5-settings-without-wife");
  });
  await step("action", "nov5-leave-a-cookie-household", async () => {
    const html = await page("/account", /Leave this household/);
    expect(plain(pageContent(html)).includes("Leave this household. It stays on this device for seven days, then it is swept.") && /action="\/api\/auth\/logout"/.test(html), "nov5-leave-words");
    const left = await request("/api/auth/logout", { method: "POST" });
    expect(left.response.status === 303 && left.response.headers.get("location") === "/" && /household=;|household=(?:""|);/.test(left.response.headers.get("set-cookie") ?? ""), "nov5-left");
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
    await step("page", "stage17-settings-offers-import-a-statement", async () => {
      const html = await page("/settings", /Import a statement[\s\S]*Statement file \(CSV\)/);
      importCard = /<option value="([0-9a-f-]{36})"[^>]*>Card B<\/option>/.exec(html)?.[1];
      expect(importCard !== undefined, "s17-card-option");
    });
    await step("action", "stage17-import-three-rows", async () => {
      const result = await request("/api/import", { method: "POST", json: { cardId: importCard, rows: statementRows } });
      expect(result.response.status === 200 && result.body === JSON.stringify({ added: 3, skipped: 0 }), "s17-first-import");
    });
    await step("action", "stage17-import-again-skips-all-three", async () => {
      const result = await request("/api/import", { method: "POST", json: { cardId: importCard, rows: statementRows } });
      expect(result.response.status === 200 && result.body === JSON.stringify({ added: 0, skipped: 3 }), "s17-second-import");
    });
    await step("page", "stage17-activity-names-the-import", () => page("/activity", /Imported 3 charges to Card B from a statement/));
    await step("guard", "stage17-import-to-a-card-of-no-household-refused", async () => {
      const result = await request("/api/import", { method: "POST", json: { cardId: randomUUID(), rows: statementRows } });
      expect(result.response.status === 400 && result.body === "Choose a card of this household", "s17-foreign-card");
    });
    await step("guard", "stage17-import-form-body-refused", async () => {
      const result = await request("/api/import", { method: "POST", form: { cardId: importCard } });
      expect(result.response.status === 400 && result.body === "Check the required fields and try again.", "s17-form-body");
    });
  }
  // Stage 18 varies (D54): a monthly bill whose amount varies is "about" its estimate on Home until that month's real bill is in;
  // one-offs with the same name key and category link to it (Activity says so) and a real bill for its month is counted once.
  {
    const gasBill = (over) => ({ id: randomUUID(), biller: "Sakura Gas", amount: "6,000", due: "2026-12-10", category: "utilities", businessShare: "personal", ...over });
    const comingUp = async () => {
      const html = await page("/", /Coming up/);
      return plain(pageContent(html.slice(html.indexOf('id="coming-up"'))));
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
      await page("/activity", /Linked to Sakura Gas: counts toward its estimate/);
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
    await step("page", "stage18-varies-settings-offers-part-of-and-the-box", async () => {
      const html = await page("/settings", /Sakura Gas/);
      const content = plain(pageContent(html));
      expect(/name="seriesBillId"/.test(html) && content.includes("Sakura Gas (every month)"), "s18v-part-of");
      expect(/name="amountVaries"/.test(html) && content.includes("Amount changes every month (electricity, water, gas)"), "s18v-varies-box");
    });
  }
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
// Home and Safe to spend say what the number counts; Plan says what its "leave about" counts.
await step("page", "home-and-plan-say-what-their-numbers-count", async () => {
  const home = plain(pageContent(await page("/", /18,780|30,000/)));
  expect(home.includes("The lowest your balance gets in the next 30 days, after every bill and card statement, if clients pay late."), "safe-to-spend-line");
  const plan = plain(pageContent(await page("/plan", /leave about/)));
  expect(plan.includes("What client payments bring in over the next 30 days, after every bill and card statement, if clients pay as usual."), "plan-room-line");
});
// The add forms say what More › will save: the guess from the name, with Change ›.
await step("page", "home-add-forms-show-the-guess", async () => {
  const content = plain(pageContent(await page("/", /Add a bill or charge/)));
  expect(/One-off · Other · Change ›/.test(content), "bill-guess-line");
  expect(/Other · Change ›/.test(content.slice(content.indexOf("What or where"))), "charge-guess-line");
});
// Forwarding: Settings never shows a raw "… is not set"; without the settings it says so in words (and names the setting).
await step("page", "settings-forwarding-in-words", async () => {
  const content = plain(pageContent(await page("/settings", /Forwarding address/)));
  expect(!/FORWARDING_DOMAIN is not set|INBOUND_ADDRESS_KEY is not set|INBOUND_WORKER_SECRET is not set/.test(content), "forwarding-raw-message");
  const off = content.includes("Email forwarding isn’t available on this server yet") || content.includes("Email forwarding isn&#x27;t available");
  const html = await page("/", /18,780|30,000/);
  const actions = html.slice(html.indexOf('id="actions"'), html.indexOf('class="home-panels"'));
  expect(off === !actions.includes('href="/settings#forwarding"'), "home-forward-link-follows-the-setting");
});
await step("page", "cards", () => page("/cards", /Card B/));
await step("page", "clients", () => page("/clients", /Beacon/));
await step("page", "plan", () => page("/plan", /Add a pot/));
await step("page", "plan-where-the-month-goes", () => page("/plan", /Where the month goes[\s\S]*Housing ¥82,000/));
// Stage 17 plan (D53): the search box, the Spending panel and the month links, on the Try it household (today Nov 14).
const TRY_TODAY = "2026-11-14";
const lastMonth = (() => { const [y, m] = TRY_TODAY.split("-").map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`; })();
await step("page", "stage17-plan-search-box-and-no-panel-without-a-query", async () => {
  const html = await page("/plan", /Business ¥32,830 of ¥152,230 this month/);
  expect(/<form[^>]*action="\/plan"[^>]*method="get"/.test(html) && /name="q"/.test(html) && html.includes("Search spending: hotel, food, a shop name"), "search-form");
  expect(!html.includes('id="plan-spending-title"'), "panel-without-query");
  expect(html.includes(`href="/plan?month=${lastMonth}"`) && !/aria-label="Next month/.test(html), "month-links-on-current-month");
});
await step("page", "stage17-plan-search-food", async () => {
  const content = plain(pageContent(await page("/plan?q=food", /Spending/)));
  expect(content.includes("Food: ¥10,700 in November (3 items), ¥11,440 in October (3 items), ¥5,960 in September (1 item); nothing in the other 9 months. ¥28,100 in all."), "food-summary-line");
  const november = content.slice(content.indexOf("November ¥10,700"), content.indexOf("October ¥11,440"));
  expect(november.includes("Food ¥10,700"), "food-november-by-category");
  for (const item of ["Minato Fresh Market Nov 13 ¥1,400", "Kissa Midori café Nov 12 ¥1,880", "Minato Fresh Market Nov 8 ¥7,420"]) expect(november.includes(item), "food-november-item");
  expect(!content.includes("August ¥0"), "zero-month-block");
  expect(content.includes("Business ¥32,830 of ¥152,230 this month"), "month-view-unchanged-by-search");
});
await step("page", "stage17-plan-search-hotel-finds-hakone", async () => {
  const content = plain(pageContent(await page("/plan?q=hotel", /Spending/))).replaceAll("&quot;", "\"");
  expect(content.includes("\"hotel\": ¥28,600 in September (1 item); nothing in the other 11 months. ¥28,600 in all.") && content.includes("Hotel Kazemachi Hakone Sep 22 ¥28,600"), "hotel-result");
});
await step("page", "stage17-plan-search-nothing-matches", async () => {
  const content = plain(pageContent(await page("/plan?q=zzz", /Spending/)));
  expect(content.includes("Nothing matches “zzz” in the last 12 months."), "nothing-matches");
});
await step("page", "stage17-plan-last-month", async () => {
  const html = await page(`/plan?month=${lastMonth}`, /Where October went/);
  const content = plain(pageContent(html));
  expect(content.includes("Business ¥31,986 of ¥132,060 in October") && content.includes("Housing ¥82,000") && content.includes("Utilities ¥10,020") && content.includes("Travel") === false, "october-view");
  expect(/aria-label="Next month, November"/.test(html) && /aria-label="Previous month, September"/.test(html), "october-links");
});
await step("guard", "stage17-plan-month-out-of-range-refused-in-words", async () => {
  const content = plain(pageContent(await page("/plan?month=2020-01", /Plan shows the last 12 months/)));
  expect(content.includes("Plan shows the last 12 months, December 2025 to November 2026. Here is November.") && content.includes("Where the month goes"), "month-refusal");
});
// Stage 18 regular (D54): Plan's Regular costs panel on the Try it household, before and after confirming Hikari Denki.
const regularPanel = (html) => { const content = plain(pageContent(html)); const at = content.indexOf("Regular costs"); return at < 0 ? "" : content.slice(at); };
await step("page", "stage18-regular-costs-before-confirm", async () => {
  const panel = regularPanel(await page("/plan", /Regular costs/));
  expect(panel.includes("Kissa Midori café down ¥920 so far · Minato Fresh Market up ¥180 so far"), "regular-changed-line");
  expect(/Hikari Denki Utilities not in yet Last month ¥10,020 · usually on the 25th Sep ¥8,640 · Oct ¥10,020 · Nov not in yet/.test(panel), "regular-hikari-not-yet");
  expect(panel.includes("Rent Housing ¥82,000 Last month ¥82,000 · same Sep ¥82,000 · Oct ¥82,000 · Nov ¥82,000"), "regular-rent-same");
});
await step("page", "activity", () => page("/activity", /Hikari Denki/));
await step("page", "seeded-invoice-review-read-only", async () => {
  const id = home?.match(/href="\/invoices\/([0-9a-f-]{36})"/i)?.[1]
    ?? (home && flight(home).match(/"href"\s*:\s*"\/invoices\/([0-9a-f-]{36})"/i)?.[1]);
  expect(id, "invoice-link");
  const review = plain(pageContent(await page("/invoices/" + id, /Review invoice/)));
  expect(review.includes("Beacon Studio usually pays 2 days after you send, slowest 3"), "invoice-review-client-pace");
  // The approve form names who and how much, says it is the sandbox, and carries the busy line for the 5 to 10 s send.
  expect(/PayPal sandbox sends this invoice for \$[\d,.]+ to Beacon(?:’|&#x27;|')s test address\. No real money moves\./.test(review), "invoice-review-send-hint");
  expect(review.includes("Sending through PayPal sandbox…") && !review.includes("configured test client"), "invoice-review-busy-line");
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
await step("page", "stage18-regular-costs-after-confirm", async () => {
  const panel = regularPanel(await page("/plan", /Regular costs/));
  expect(/Regular costs Hikari Denki up ¥1,200 · Kissa Midori café down ¥920 so far/.test(panel), "regular-changed-line-starts-with-hikari");
  expect(panel.includes("Hikari Denki Utilities ¥11,220 Last month ¥10,020 · up ¥1,200 Sep ¥8,640 · Oct ¥10,020 · Nov ¥11,220"), "regular-hikari-row");
});
// A category outside the fourteen keys is refused before anything is saved (needs a session: the guards suite sends none).
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
  // Back on Home, the address carries the new bill's id (never its name or amount) for the "Added …" line, and lands on Coming up.
  expect(native.response.status === 303 && native.response.headers.get("location") === `/?added=${id}#coming-up`, "bill-native-result");
  const again = await request("/api/bills", { method: "POST", form, extraHeaders: { "x-form-fetch": "1" } });
  expect(again.response.status === 204 && again.response.headers.get("x-form-redirect") === `/?added=${id}#coming-up` && !again.response.headers.get("location"), "bill-form-result");
  const shown = plain(pageContent(await page(`/?added=${id}`, /Fictional separator bill/)));
  expect(shown.includes("Added Fictional separator bill ¥1,000, due Nov 20"), "bill-added-line");
  expect(!plain(pageContent(await page("/", /Coming up/))).includes("Added Fictional separator bill"), "bill-added-line-gone-on-next-load");
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
  const result = await request("/api/ask", { method: "POST", json: { id: randomUUID(), conversationId: randomUUID(), text: "Where do I stand?", source: "manual", canvas: null } });
  if (result.response.status === 503 && /^Ask isn’t available on this server yet \(AI_[A-Z_]+\)\.$/.test(result.body)) {
    console.log(`NOTE typed-ask-read-only: ${result.body}; the live answer is not checked`);
    return;
  }
  expect(result.response.status === 200, "ask-status");
  const answer = JSON.parse(result.body);
  expect(answer.pending === false && typeof answer.text === "string" && ["answer", "clarify", "declined"].includes(answer.kind) && Array.isArray(answer.sources), "ask-result");
});
// The Ask page (D60): without the owner's AI settings it shows the missing setting's name; with them, the box. Pins (D57): pin a canvas, Home draws it, unpin.
await step("page", "ask-page-opens-with-the-box-or-the-missing-setting", async () => {
  const html = await page("/canvas", /Your question|Ask isn(’|&#x27;|')t available on this server yet \(AI_[A-Z_]+\)/);
  expect(/New conversation|Am I OK until the end of the month/.test(pageContent(html)) || /Ask isn/.test(pageContent(html)), "ask-page-content");
  expect(/This month|Safe to spend/.test(pageContent(html)), "ask-page-starters");
});
await step("action", "pin-a-canvas-home-draws-it-and-unpin-removes-it", async () => {
  const recipe = JSON.stringify({ version: 1, title: "Fictional pin check", blocks: [{ type: "number", label: "Cash today", query: { q: "cash" } }] });
  const pinned = await request("/api/canvases", { method: "POST", form: { kind: "pin", title: "Fictional pin check", recipe, returnTo: "/" } });
  expect(pinned.response.status === 303 && pinned.response.headers.get("location") === "/", "pin-status");
  const home = await page("/", /Fictional pin check/);
  expect(/Cash today/.test(pageContent(home)) && /Move up/.test(pageContent(home)) && /Unpin/.test(pageContent(home)), "pin-drawn-on-home");
  const id = /\/canvas\?pin=([0-9a-f-]{36})/.exec(home)?.[1];
  expect(id, "pin-id");
  const open = await page(`/canvas?pin=${id}`, /Save to this pin/);
  expect(/Pin to Home/.test(pageContent(open)), "pin-open");
  const gone = await request("/api/canvases", { method: "POST", form: { kind: "unpin", id, returnTo: "/" } });
  expect(gone.response.status === 303, "unpin-status");
  const after = await request("/");
  expect(!/Fictional pin check/.test(pageContent(after.body)), "pin-removed");
  const kinds = (await events()).events.map(event => event.kind);
  expect(kinds.includes("canvas_pinned") && kinds.includes("canvas_unpinned"), "pin-events");
});
await step("action", "ai-model-default-is-accepted-and-an-oversize-body-is-refused", async () => {
  const same = await request("/api/settings/ai-model", { method: "POST", form: { kind: "default" } });
  expect(same.response.status === 200, "ai-model-default-status");
  const big = await request("/api/settings/ai-model", { method: "POST", form: { kind: "save", key: "x".repeat(5000) } });
  expect(big.response.status === 413, "ai-model-oversize-status");
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
  expect(data.version === 2 && Array.isArray(data.events) && data.clients.length === 3, "export-shape");
  expect(Array.isArray(data.memory) && Array.isArray(data.canvases) && Array.isArray(data.journal), "export-stored-kinds");
  expect(!/ai_?key|tokenHash|storagePath|payload/i.test(result.body), "export-no-secrets");
  const get = await fetch(new URL("/api/export", base), { headers: { Cookie: cookie, Origin: base.origin }, redirect: "manual" });
  expect(get.status === 405, "export-get-refused");
  tryItExport = result.body;
});
// D59: Your data lists each kind with where it is kept and how many; a delete is real and the record cannot be deleted by kind.
await step("page", "settings-your-data-rows", async () => {
  const content = plain(pageContent(await page("/settings", /Your data/)));
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
  expect(/What the assistant remembers · 3 things/.test(plain(pageContent((await request("/settings")).body))), "data-memory-count");
  const one = await request("/api/data", { method: "POST", form: { kind: "delete_one", what: "memory", id: rows[0].id, returnTo: "/settings" } });
  expect(one.response.status === 303 && one.response.headers.get("location") === "/settings", "data-delete-one");
  const again = await request("/api/data", { method: "POST", form: { kind: "delete_one", what: "memory", id: rows[0].id, returnTo: "/settings" } });
  expect(again.response.status === 404, "data-delete-one-again");
  expect(/What the assistant remembers · 2 things/.test(plain(pageContent((await request("/settings")).body))), "data-memory-count-after-one");
  const all = await request("/api/data", { method: "POST", form: { kind: "delete_kind", what: "memory", returnTo: "/settings" } });
  expect(all.response.status === 303, "data-delete-all");
  expect(JSON.parse((await request("/api/export", { method: "POST" })).body).memory.length === 0, "data-memory-gone-from-export");
  expect(!/Fictional data check/.test(pageContent((await request("/memory")).body)), "data-memory-page-empty");
  const record = await request("/api/data", { method: "POST", form: { kind: "delete_kind", what: "record", returnTo: "/settings" } });
  expect(record.response.status === 400 && /Delete everything/.test(record.body), "data-record-refused");
  const bad = await request("/api/data", { method: "POST", form: { kind: "delete_kind", what: "nothing", returnTo: "/settings" } });
  expect(bad.response.status === 400, "data-bad-kind");
});
// D59 step 2: Import reads a version 2 file into an empty household only, and says why when it cannot.
await step("action", "import-refuses-a-full-household-an-old-file-and-an-oversize-body", async () => {
  const full = await request("/api/restore", { method: "POST", json: JSON.parse(tryItExport) });
  expect(full.response.status === 400 && full.body === "Import works on an empty household. Start with my numbers first.", "import-full-refused");
  const big = await request("/api/restore", { method: "POST", json: { version: 2, filler: "x".repeat(1_100_000) } });
  expect(big.response.status === 413, "import-oversize");
});
await step("action", "import-fills-an-empty-household-from-an-export", async () => {
  const start = await request("/api/try/blank", { method: "POST", form: { name: "Fictional importer", currency: "JPY", timeZone: "Asia/Tokyo", bank: "1", card: "Card I", closingDay: "25", dueDay: "10", limit: "" }, session: "" });
  const blank = start.response.headers.get("set-cookie")?.match(/(?:^|,\s*)household=([^;]+)/)?.[1];
  expect(start.response.status === 303 && blank, "import-blank-session");
  const old = await request("/api/restore", { method: "POST", session: "household=" + blank, json: { ...JSON.parse(tryItExport), version: 1 } });
  expect(old.response.status === 400 && /version 1/.test(old.body), "import-old-version-refused");
  const done = await request("/api/restore", { method: "POST", session: "household=" + blank, json: JSON.parse(tryItExport) });
  expect(done.response.status === 200, "import-status");
  const counts = JSON.parse(done.body).imported;
  expect(counts.clients === 3 && counts.bills > 0 && counts.invoices > 0, "import-counts");
  const home = plain(pageContent((await request("/", { session: "household=" + blank })).body));
  expect(/short on the 27th|fine/i.test(home) && !/Add your rent, your bills/.test(home), "import-home-shows-the-forecast");
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
  // The demo line is Try it's alone (Ben's fictional numbers); a blank household is the user's own.
  expect(!/A fictional household that lives in this browser/.test(content), "blank-demo-line-shown");
  expect(/Bank balance ¥120,000\./.test(content), "blank-bank-balance");
  expect(!/You(?:'|&#x27;)re fine/.test(content), "blank-fine-verdict");
  expect(/First steps · 4 to go/.test(content), "blank-four-steps-open");
  expect(content.includes("Add your rent, so the day it leaves shows up") && !content.includes("Add a client who pays you, so"), "blank-only-the-first-step-is-open");
  expect(/Nothing due in the next 30 days\. Add a bill ›/.test(content), "blank-coming-up-hint");
  expect(/Card N/.test(content), "blank-card-row");
});
// Start with my numbers never reuses the cookie household: a second post makes a new one and deletes the old demo.
await step("page", "start-form-says-it-replaces-the-demo", async () => {
  await page("/start", /This replaces your household in this browser and its numbers\./); // this browser holds a blank household, not Ben's Try it
  const fresh = await request("/start", { session: "" });
  expect(fresh.response.status === 200 && !/This replaces (the Try it|your) household/.test(pageContent(fresh.body)), "start-notice-without-demo");
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
  expect(result.response.status === 303 && /^\/\?added=[0-9a-f-]{36}#coming-up$/.test(result.response.headers.get("location") ?? ""), "blank-bill-result");
});
await step("page", "start-blank-home-after-bill", async () => {
  const content = plain(pageContent(await page("/", /You(?:'|&#x27;)re fine for the next 30 days[\s\S]*¥60,000 on the 27th/)));
  expect(!/Add your rent, your bills and the clients/.test(content), "blank-empty-still-shown");
  expect(/First steps · 3 to go/.test(content) && content.includes("Bill added"), "blank-three-steps-left");
  expect(!content.includes("Add your rent, so the day"), "blank-bill-step-still-open");
});
// D48 on a blank household (Try it numbers never move): a yearly bill with a new amount and a cancel-by date goes through the
// same door the form uses; Coming up says "Yearly" and has the cancel-by row, Activity names what the bill carries.
await step("action", "start-blank-add-yearly-bill-with-cancel-by", async () => {
  const result = await request("/api/bills", { method: "POST", form: { id: randomUUID(), biller: "Fictional Cloud", amount: "12,000", due: "2026-12-01", category: "subscriptions", businessShare: "personal",
    repeat: "year", nextAmount: "13,000", nextAmountFrom: "2027-12-01", cancelBy: "2026-11-20" } });
  expect(result.response.status === 303 && /^\/\?added=[0-9a-f-]{36}#coming-up$/.test(result.response.headers.get("location") ?? ""), "yearly-bill-result");
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
// Stage 15 A: Start asks for a name and a bank balance (D51); the household lives on the real date; Home asks for one thing at a time.
const twoFields = { name: "Fictional newcomer", currency: "JPY", timeZone: "Asia/Tokyo", bank: "250,000" };
await step("page", "stage15a-start-form-has-two-fields-and-folded-card-and-region", async () => {
  const html = await page("/start", /What’s in your bank today\?|What&#x27;s in your bank today\?|What’s in your bank today/);
  const content = plain(pageContent(html));
  expect(/Your name/.test(content) && /Add a card now ›/.test(content) && /· Change/.test(content), "a-start-labels");
  expect(!/Card bill is paid on the[^]*required/.test(html) && !/name="closingDay"[^>]*required/.test(html), "a-card-fields-not-required");
});
await step("action", "stage15a-start-two-fields", async () => adopt(await request("/api/try/blank", { method: "POST", form: twoFields, session: "" })));
await step("page", "stage15a-home-has-the-real-date-no-card-and-the-card-step", async () => {
  const html = await page("/", /First steps/);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  expect(html.includes(`dateTime="${today}"`), "a-real-date");
  const content = plain(pageContent(html));
  expect(/Add your rent, so the day it leaves shows up/.test(content) && html.includes('href="/#add-bill"'), "a-first-step-is-rent");
  expect(/Bank balance ¥250,000\./.test(content), "a-bank");
  expect(/No card yet\./.test(content), "a-no-card");
});
await step("action", "stage15a-add-rent-collapses-step-and-asks-for-a-client", async () => {
  const result = await request("/api/bills", { method: "POST", form: { id: randomUUID(), biller: "Fictional rent", amount: "60,000", due: "2026-12-27", category: "housing", businessShare: "personal" } });
  expect(result.response.status === 303, "a-bill-result");
  const html = await page("/", /Bill added/);
  const content = plain(pageContent(html));
  // No card yet, so the card step still counts: client, card, charge and share remain.
  expect(/First steps · 4 to go/.test(content) && /Add a client who pays you, so late payments show in the sentence/.test(content), "a-client-step-next");
  expect(html.includes('href="/clients"') && !/Add your rent, so the day/.test(content), "a-rent-step-collapsed");
});
await step("action", "stage15a-start-with-card-block", async () => {
  adopt(await request("/api/try/blank", { method: "POST", form: { ...twoFields, card: "Card Q", closingDay: "25", dueDay: "10", limit: "" }, session: "" }));
  await page("/", /Card Q/);
  const html = await page("/", /First steps/);
  expect(!/Add a card, so card bills count/.test(pageContent(html)), "a-card-step-hidden-with-a-card");
});
await step("guard", "stage15a-half-a-card-refused", async () => {
  const result = await request("/api/try/blank", { method: "POST", form: { ...twoFields, card: "Card Q" }, session: "" });
  expect(result.response.status === 400 && !result.response.headers.get("set-cookie"), "a-half-card");
});
await step("action", "stage15a-try-it-keeps-nov-14-and-has-no-first-steps", async () => {
  adopt(await request("/api/try", { session: "" })); // a fresh session: with a cookie, /api/try keeps the current household
  const html = await page("/", /short on the 27th/);
  expect(html.includes('dateTime="2026-11-14"') && /18,780/.test(pageContent(html)) && !/First steps/.test(pageContent(html)), "a-try-it-date");
});
await step("page", "stage15a-start-notice-names-ben-for-try-it", () => page("/start", /This replaces the Try it household in this browser\. Reset in Settings brings Ben(?:'|&#x27;|’)s numbers back\./));

// Stage 15 C: every empty panel names what fills it and links there; rows lead to what they are about.
await step("action", "stage15c-blank-session", async () => adopt(await request("/api/try/blank", { method: "POST", form: setup, session: "" })));
await step("page", "stage15c-empty-panel-hints-link-to-what-fills-them", async () => {
  const html = await page("/", /Nothing due in the next 30 days/);
  const content = plain(pageContent(html));
  expect(/Nothing due in the next 30 days\. Add a bill ›/.test(content) && html.includes('href="/#add-bill"'), "c-coming-up-hint");
  expect(/No card charges yet\. Add a card charge ›/.test(content) && html.includes('href="/#add-charge"'), "c-cards-hint");
  expect(html.includes('href="/settings#cards"'), "c-cards-change-closing-day");
  expect(/Things the app read or drafted, waiting for your OK\. Nothing here now\./.test(content), "c-to-check-hint");
});
await step("page", "stage15c-to-check-page-hint", () => page("/to-check", /Things the app read or drafted, waiting for your OK\. Nothing here now\./));
await step("page", "stage15c-clients-hint-links-to-the-add-form", async () => {
  const html = await page("/clients", /No clients yet\. Add a client ›/);
  expect(html.includes('href="#add-client"') && html.includes('id="add-client"'), "c-clients-hint-link");
});
await step("action", "stage15c-add-rent", async () => {
  const result = await request("/api/bills", { method: "POST", form: { id: randomUUID(), biller: "Fictional rent", amount: "60,000", due: "2026-11-27", category: "housing", businessShare: "personal" } });
  expect(result.response.status === 303, "c-bill-result");
});
await step("page", "stage15c-coming-up-row-carries-a-link-to-its-bill", async () => {
  const html = await page("/", /Fictional rent/);
  expect(/href="\/settings#bill-[0-9a-f-]{36}"[^>]*>Fictional rent</.test(html), "c-coming-up-link");
  const settings = await page("/settings", /Fictional rent/);
  expect(/id="bill-[0-9a-f-]{36}"/.test(settings), "c-settings-bill-anchor");
});
await step("action", "stage15c-try-it-session", async () => adopt(await request("/api/try", { session: "" })));
await step("page", "stage15c-activity-invoice-row-links-to-the-invoice", async () => {
  const home = await page("/", /short on the 27th/);
  expect(/<a [^>]*href="#runway-day"[^>]*>on the 27th</.test(home), "c-sentence-date-link");
  const id = /href="\/invoices\/([0-9a-f-]{36})"/.exec(home)?.[1];
  expect(id !== undefined, "c-invoice-id");
  const paid = await request("/api/invoices/paid", { method: "POST", form: { id } });
  expect(paid.response.status === 303, "c-paid-outside");
  const html = await page("/activity", /marked paid outside PayPal/);
  expect(html.includes(`href="/invoices/${id}"`), "c-activity-invoice-link");
});
// Stage 15 B: the add forms show three fields, the rest under More ›, in the user's words
await step("action", "stage15b-try-it-session", async () => adopt(await request("/api/try", { session: "" }))); // the C block ends on a blank household
await step("page", "stage15b-bill-form-words-and-more", async () => {
  const html = pageContent(await page("/", /short on the 27th/));
  const form = html.slice(html.indexOf("Add a bill or charge"));
  expect(html.includes("Add a bill or charge") && form.includes("Due date") && form.includes("Add bill"), "b-bill-three-fields");
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
    const month = await content("/plan", /Where the month goes/);
    expect(month.includes("1 bill not counted: Minato Gas (amount not known)") && !/Utilities\s*¥0/.test(month), "s19b-month-line");
    const search = await content("/plan?q=gas", /Spending/);
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
    const refused = await request("/api/bills", { method: "POST", form: { kind: "fill", id: randomUUID(), amount: "1,000", returnTo: "/" } });
    expect(refused.response.status === 400 && refused.body === "Choose a bill of this household", "s19b-foreign-id");
  });
}
console.log(`${failures ? "FAIL" : "PASS"} summary ${failures} failed`);
process.exitCode = failures ? 1 : 0;
