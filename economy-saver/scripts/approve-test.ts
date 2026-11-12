// Approve and the client's payment link (D12, D37): the order PayPal is asked for, who it pays, one order per invoice however the
// taps and retries fall, the fipa link's reuse and renewal, and the ended states. PGlite, a fake PayPal and a stubbed fetch for the
// request itself; no network and no real settings.
import assert from "node:assert/strict";

// Fictional settings; the env schema reads them when the PayPal modules run.
Object.assign(process.env, {
  PAYPAL_ENVIRONMENT: "SANDBOX", PAYPAL_CLIENT_ID: "client-fictional", PAYPAL_CLIENT_SECRET: "secret-fictional",
  PAYPAL_PARTNER_ATTRIBUTION_ID: "FIPA_TEST_BN", PAYPAL_PARTNER_MERCHANT_ID: "PARTNERFICTIONAL", APP_URL: "https://fipa.example.test",
  PAYPAL_WEBHOOK_ID: "WH-ID-FICTIONAL",
});

import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { and, eq } from "drizzle-orm";
import { ApprovalError, approvePaymentLink, invoiceReview } from "@/db/approval";
import { listEvents } from "@/db/household";
import { openPaymentLink, ORDER_REUSE_MS, paymentLinkView, paypalInvoiceNumber } from "@/db/payment-link";
import * as schema from "@/db/schema";
import { seedBen } from "@/db/seed";
import { saveInvoiceDraft } from "@/db/invoice-draft";
import { PayPalError, paypalRead } from "@/lib/paypal/client";
import type { CreateOrder, OrderRequest, PayPalCall, PayPalRequest } from "@/lib/paypal/contracts";
import { verifyWebhook } from "@/lib/paypal/webhook";
import { captureOrder, createOrder, payWithSandboxTestCard } from "@/lib/paypal/send";
import { payInvoiceAsTestClient } from "@/db/try-pay";
import { applyVerifiedDelivery } from "@/lib/events";
import type { PayWithTestCard } from "@/lib/paypal/contracts";

const APP = "https://fipa.example.test";
const decodePart = (jwt: string, i: number) => JSON.parse(Buffer.from(jwt.split(".")[i], "base64url").toString());

/**
 * A fake createOrder that records its requests and numbers its orders; `failNext` makes the next call time out (after PayPal
 * made the order, as a lost answer does). Like PayPal, a repeated PayPal-Request-Id gets the order it made the first time.
 */
let count = 0; // PayPal's order ids are unique across every fake
const byRequestId = new Map<string, string>();
function fakeOrders() {
  const requests: OrderRequest[] = [];
  const state = { failNext: false, at: new Date("2026-11-14T00:00:00Z"), made: 0 };
  const create: CreateOrder = async o => {
    requests.push(o);
    let id = byRequestId.get(o.requestId);
    if (!id) { count += 1; state.made += 1; id = `ORDER-${count}`; byRequestId.set(o.requestId, id); }
    if (state.failNext) { state.failNext = false; throw new Error("Timeout"); }
    return { orderId: id, approveUrl: `https://www.sandbox.paypal.com/checkoutnow?token=${id}`, createdAt: state.at };
  };
  return { create, requests, state };
}

/** A fake order read: reports the status the test sets ("COMPLETED/DECLINED" is a completed order whose capture was declined). */
function fakeRead(status: () => string | "404") {
  const calls: string[] = [];
  const read: PayPalCall = async req => {
    assert.equal(req.method, "GET");
    calls.push(req.path);
    if (status() === "404") throw new PayPalError("Not found", 404);
    const [order, capture] = status().split("/");
    return { status: order, ...(capture && { purchase_units: [{ payments: { captures: [{ id: "CAP", status: capture }] } }] }) };
  };
  return { read, calls };
}

async function main() {
  const pg = new PGlite({ extensions: { pg_trgm } });
  const realFetch = globalThis.fetch;
  try {
    const db = drizzle(pg, { schema });
    await migrate(db, { migrationsFolder: "./drizzle" });
    const demo = await seedBen(db, { isDemo: true });
    const other = await seedBen(db, { isDemo: true });
    const signedIn = await seedBen(db, { isDemo: false });
    const connected = await seedBen(db, { isDemo: false });
    for (const hid of [signedIn, connected]) await db.insert(schema.fxRates).values({ householdId: hid, base: "USD", quote: "JPY", date: "2020-01-01", rateMicro: 150_000_000 });
    await db.update(schema.paypalConnections).set({
      connectionStatus: "connected", sellerMerchantId: "SELLERFICTIONAL", paypalEmail: "seller@example.test", connectedAt: new Date("2026-11-01T00:00:00Z"),
    }).where(eq(schema.paypalConnections.householdId, connected));
    const unbilled = async (hid: string) => (await db.select().from(schema.invoices)
      .where(and(eq(schema.invoices.householdId, hid), eq(schema.invoices.status, "unbilled"))))[0];
    const row = async (hid: string, id: string) => (await db.select().from(schema.invoices)
      .where(and(eq(schema.invoices.householdId, hid), eq(schema.invoices.id, id))))[0];
    const today = "2026-11-14";
    const ctx = (hid: string, approveKey: string, create: CreateOrder) => ({ db, householdId: hid, approveKey, today, usdRate: 150, createOrder: create });

    // ---- Approve for a Try it household: pays fipa's own sandbox account.
    const invoice = await unbilled(demo);
    const orders = fakeOrders();
    const [client] = await db.select().from(schema.clients).where(eq(schema.clients.id, invoice.clientId));
    await assert.rejects(approvePaymentLink(ctx(other, invoice.approveKey, orders.create)), (e: unknown) => e instanceof ApprovalError && e.status === 404);
    assert.equal(orders.requests.length, 0, "another household's key reaches nothing");
    orders.state.failNext = true;
    await assert.rejects(approvePaymentLink(ctx(demo, invoice.approveKey, orders.create)), /Timeout/);
    assert.equal((await row(demo, invoice.id)).status, "unbilled", "a timeout leaves the invoice unsent");
    const keptToken = (await row(demo, invoice.id)).payToken;
    assert.match(keptToken ?? "", /^[A-Za-z0-9_-]{43}$/, "but keeps its link token, so the order PayPal made returns to the same link");
    await approvePaymentLink(ctx(demo, invoice.approveKey, orders.create));
    assert.equal(orders.requests.length, 2);
    assert.equal(orders.state.made, 1, "the retry gets the order PayPal already made");
    assert.equal(orders.requests[0].requestId, orders.requests[1].requestId, "a retry carries the same PayPal-Request-Id");
    assert.ok(orders.requests[0].requestId.startsWith("O-" + invoice.approveKey + "-"));
    assert.equal(orders.requests[0].returnUrl, orders.requests[1].returnUrl, "to the same link");
    const sent = await row(demo, invoice.id);
    assert.equal(sent.status, "sent");
    assert.equal(sent.sentOn, today);
    assert.equal(sent.dueOn, new Date(Date.parse(today) + client.termsDays * 86_400_000).toISOString().slice(0, 10));
    assert.equal(sent.fxRateMicro, 150_000_000);
    assert.equal(sent.paypalOrderId, "ORDER-1");
    assert.equal(sent.paypalPayeeId, "PARTNERFICTIONAL");
    assert.ok(sent.paypalApproveUrl?.startsWith("https://www.sandbox.paypal.com/"));
    assert.match(sent.payToken ?? "", /^[A-Za-z0-9_-]{43}$/);
    const request = orders.requests[1];
    assert.equal(request.payee, "PARTNERFICTIONAL");
    assert.equal(request.invoiceId, invoice.id);
    assert.equal(request.amountMinor, invoice.amountMinor);
    assert.equal(request.currency, "USD");
    assert.equal(request.number, paypalInvoiceNumber(invoice.id), "PayPal's invoice number is worked out from the invoice id");
    assert.match(request.number, /^P-[A-Za-z0-9_-]{22}$/);
    assert.equal(sent.number, invoice.number, "and never written into the visible number");
    assert.equal(request.returnUrl, `${APP}/pay/${sent.payToken}/done`);
    assert.equal(request.cancelUrl, `${APP}/pay/${sent.payToken}`);
    await approvePaymentLink(ctx(demo, invoice.approveKey, orders.create));
    assert.equal(orders.requests.length, 2, "a second tap on a sent invoice makes nothing");
    const titles = (await listEvents(db, demo)).filter(e => e.kind === "invoice_sent" && e.refId === invoice.id).map(e => e.title);
    assert.deepEqual(titles, [`Payment link made for ${client.name}`]);
    const review = await invoiceReview(db, demo, invoice.id);
    assert.equal(review?.payLink, `${APP}/pay/${sent.payToken}`);
    assert.ok(!("connection" in (review ?? {})), "the page reads the connection once, from its workspace");
    assert.equal(await invoiceReview(db, other, invoice.id), undefined);

    // ---- Two concurrent taps make one order.
    const draft = { id: crypto.randomUUID(), clientId: invoice.clientId, item: "Design sketches", amount: "15.45", note: "" };
    await saveInvoiceDraft(db, demo, draft, { madeBy: "form" });
    const draftRow = await row(demo, draft.id);
    const race = fakeOrders();
    await Promise.all([approvePaymentLink(ctx(demo, draftRow.approveKey, race.create)), approvePaymentLink(ctx(demo, draftRow.approveKey, race.create))]);
    assert.equal(race.state.made, 1, "both taps carry one PayPal-Request-Id, so PayPal makes one order");
    assert.ok(race.requests.every(r => r.requestId === race.requests[0].requestId && r.returnUrl === race.requests[0].returnUrl));
    assert.equal(race.requests[0].amountMinor, 1545, "the exact cents");
    assert.equal((await listEvents(db, demo)).filter(e => e.kind === "invoice_sent" && e.refId === draft.id).length, 1);
    // A draft edited while PayPal was asked is not sent with the old order; the next tap asks for an order for the new amount.
    const edited = { id: crypto.randomUUID(), clientId: invoice.clientId, item: "Icon set", amount: "40.00", note: "" };
    await saveInvoiceDraft(db, demo, edited, { madeBy: "form" });
    const editedRow = await row(demo, edited.id);
    const slow = fakeOrders();
    const editing: CreateOrder = async o => {
      await db.update(schema.invoices).set({ amountMinor: 4500 }).where(and(eq(schema.invoices.householdId, demo), eq(schema.invoices.id, edited.id)));
      return slow.create(o);
    };
    await assert.rejects(approvePaymentLink(ctx(demo, editedRow.approveKey, editing)), (e: unknown) => e instanceof ApprovalError && /changed/.test(e.message));
    assert.notEqual((await row(demo, edited.id)).status, "sent");
    assert.equal((await row(demo, edited.id)).paypalOrderId, null);
    await approvePaymentLink(ctx(demo, editedRow.approveKey, slow.create));
    assert.notEqual(slow.requests[1].requestId, slow.requests[0].requestId, "a new amount is a new PayPal-Request-Id");
    assert.equal(slow.requests[1].amountMinor, 4500);
    assert.equal((await row(demo, edited.id)).status, "sent");

    // ---- Connected pays the seller; signed in and not connected is refused before any call.
    const mine = await unbilled(connected);
    const connectedOrders = fakeOrders();
    await approvePaymentLink(ctx(connected, mine.approveKey, connectedOrders.create));
    assert.equal(connectedOrders.requests[0].payee, "SELLERFICTIONAL");
    assert.equal((await row(connected, mine.id)).paypalPayeeId, "SELLERFICTIONAL");
    const notYet = await unbilled(signedIn);
    const refused = fakeOrders();
    await assert.rejects(approvePaymentLink(ctx(signedIn, notYet.approveKey, refused.create)), (e: unknown) => e instanceof ApprovalError && e.status === 409 && /Connect your PayPal/.test(e.message));
    assert.equal(refused.requests.length, 0);
    assert.equal((await row(signedIn, notYet.id)).status, "unbilled");

    // ---- The request itself: headers, body and the approve link, through the real createOrder with a stubbed fetch.
    const seen: { url: string; headers: Record<string, string>; body: unknown }[] = [];
    let links: { rel: string; href: string }[] = [{ rel: "self", href: "https://api-m.sandbox.paypal.com/v2/checkout/orders/ORDER-X" }, { rel: "payer-action", href: "https://www.sandbox.paypal.com/checkoutnow?token=ORDER-X" }];
    let captureAnswer: { status: number; body: unknown } = { status: 201, body: { status: "COMPLETED", purchase_units: [{ payments: { captures: [{ id: "CAPTURE-X", status: "COMPLETED" }] } }] } };
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/v1/oauth2/token")) return Response.json({ access_token: "token-fictional", expires_in: 3600 });
      seen.push({ url, headers: init?.headers as Record<string, string>, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url.endsWith("/capture")) return Response.json(captureAnswer.body, { status: captureAnswer.status });
      return Response.json({ id: "ORDER-X", status: "PAYER_ACTION_REQUIRED", links });
    }) as typeof fetch;
    const made = await createOrder({ payee: "SELLERFICTIONAL", requestId: "O-key", invoiceId: "inv-1", number: "P-ABC", item: "x".repeat(300),
      amountMinor: 123_400, currency: "USD", returnUrl: `${APP}/pay/t/done`, cancelUrl: `${APP}/pay/t` });
    assert.deepEqual([made.orderId, made.approveUrl], ["ORDER-X", "https://www.sandbox.paypal.com/checkoutnow?token=ORDER-X"]);
    const [call] = seen;
    assert.equal(call.url, "https://api-m.sandbox.paypal.com/v2/checkout/orders");
    assert.equal(call.headers.Authorization, "Bearer token-fictional");
    assert.equal(call.headers["PayPal-Partner-Attribution-Id"], "FIPA_TEST_BN");
    assert.equal(call.headers["PayPal-Request-Id"], "O-key");
    assert.deepEqual(decodePart(call.headers["PayPal-Auth-Assertion"], 1), { iss: "client-fictional", payer_id: "SELLERFICTIONAL" });
    assert.deepEqual(call.body, {
      intent: "CAPTURE",
      purchase_units: [{ reference_id: "inv-1", custom_id: "inv-1", invoice_id: "P-ABC", description: "x".repeat(127),
        amount: { currency_code: "USD", value: "1234.00" }, payee: { merchant_id: "SELLERFICTIONAL" } }],
      payment_source: { paypal: { experience_context: { brand_name: "fipa", landing_page: "NO_PREFERENCE", user_action: "PAY_NOW",
        shipping_preference: "NO_SHIPPING", return_url: `${APP}/pay/t/done`, cancel_url: `${APP}/pay/t` } } },
    });
    const orderOf = () => createOrder({ payee: "PARTNERFICTIONAL", requestId: "O-k", invoiceId: "i", number: "P-1", item: "x", amountMinor: 100, currency: "USD", returnUrl: `${APP}/a`, cancelUrl: `${APP}/b` });
    for (const bad of ["http://www.sandbox.paypal.com/checkoutnow", "https://evil.example.test/paypal.com", "https://paypal.com.evil.example.test/x", "javascript:alert(1)"]) {
      links = [{ rel: "payer-action", href: bad }];
      await assert.rejects(orderOf(), /did not give a payment address/, bad);
    }
    links = [{ rel: "approve", href: "https://www.sandbox.paypal.com/checkoutnow?token=T" }];
    await assert.rejects(orderOf(), /did not give a payment address/, "only the payer-action link is taken");
    // Taking the payment: the capture's path, Request-Id and assertion; an order already captured counts as taken; anything else throws.
    seen.length = 0;
    assert.deepEqual(await captureOrder("ORDER-X", "SELLERFICTIONAL"), { captureId: "CAPTURE-X" }, "the capture id PayPal gave");
    assert.equal(seen[0].url, "https://api-m.sandbox.paypal.com/v2/checkout/orders/ORDER-X/capture");
    assert.equal(seen[0].headers["PayPal-Request-Id"], "C-ORDER-X");
    assert.equal(decodePart(seen[0].headers["PayPal-Auth-Assertion"], 1).payer_id, "SELLERFICTIONAL");
    captureAnswer = { status: 422, body: { name: "UNPROCESSABLE_ENTITY", details: [{ issue: "ORDER_ALREADY_CAPTURED" }] } };
    assert.deepEqual(await captureOrder("ORDER-X", "SELLERFICTIONAL"), { captureId: null });
    captureAnswer = { status: 422, body: { details: [{ issue: "INSTRUMENT_DECLINED" }] } };
    await assert.rejects(captureOrder("ORDER-X", "SELLERFICTIONAL"), (e: unknown) => e instanceof PayPalError && e.status === 422 && e.issue === "INSTRUMENT_DECLINED");
    captureAnswer = { status: 500, body: {} };
    await assert.rejects(captureOrder("ORDER-X", "SELLERFICTIONAL"), (e: unknown) => e instanceof PayPalError && e.status === 500);
    // A 201 answer is read by its capture's own status: only COMPLETED or PENDING keeps an id.
    const answered = (status: string) => ({ status: 201, body: { status: "COMPLETED", purchase_units: [{ payments: { captures: [{ id: "CAPTURE-" + status, status }] } }] } });
    for (const [status, expected] of [["PENDING", { captureId: "CAPTURE-PENDING" }], ["DECLINED", { captureId: null, declined: true }], ["FAILED", { captureId: null, declined: true }]] as const) {
      captureAnswer = answered(status);
      assert.deepEqual(await captureOrder("ORDER-X", "SELLERFICTIONAL"), expected, status);
    }
    globalThis.fetch = realFetch;

    // ---- A refused token (401) is dropped and the call made once more with a fresh one; a 403 is not retried.
    {
      const tokens: string[] = []; const used: string[] = [];
      let refuse = 1;
      let forbid = false;
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/v1/oauth2/token")) { tokens.push("t" + tokens.length); return Response.json({ access_token: tokens.at(-1), expires_in: 3600 }); }
        used.push((init?.headers as Record<string, string>).Authorization);
        if (forbid) return Response.json({ name: "NOT_AUTHORIZED" }, { status: 403 });
        if (refuse > 0) { refuse--; return Response.json({ error: "invalid_token" }, { status: 401 }); }
        return Response.json({ status: "COMPLETED", purchase_units: [{ payments: { captures: [{ id: "CAPTURE-AFTER-401", status: "COMPLETED" }] } }] }, { status: 201 });
      }) as typeof fetch;
      assert.deepEqual(await captureOrder("ORDER-401", "SELLERFICTIONAL"), { captureId: "CAPTURE-AFTER-401" }, "a 401 then success takes the payment");
      assert.equal(used.length, 2);
      assert.notEqual(used[0], used[1], "the retry carries a fresh token");
      refuse = 2;
      await assert.rejects(captureOrder("ORDER-401", "SELLERFICTIONAL"), (e: unknown) => e instanceof PayPalError && e.status === 401, "a second 401 throws: the webhook refuses the delivery");
      const calls = used.length;
      forbid = true;
      await assert.rejects(captureOrder("ORDER-403", "SELLERFICTIONAL"), (e: unknown) => e instanceof PayPalError && e.status === 403);
      assert.equal(used.length, calls + 1, "a 403 is made once");
      globalThis.fetch = realFetch;
    }

    // ---- paypalRead reaches only the calls on its list: no order, capture, refund, payout or authorization, however the path is spelled.
    {
      const reached: string[] = [];
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/v1/oauth2/token")) return Response.json({ access_token: "token-fictional", expires_in: 3600 });
        reached.push(`${init?.method} ${url.replace("https://api-m.sandbox.paypal.com", "")}`);
        return Response.json({});
      }) as typeof fetch;
      const refusedCalls: PayPalRequest[] = [
        { method: "POST", path: "/v2/checkout/orders" },
        { method: "POST", path: "/v2/checkout/orders/X/capture" },
        { method: "POST", path: "/v2/./checkout/orders/X/capture" },
        { method: "POST", path: "/v2/checkout/./orders/X/capture" },
        { method: "POST", path: "//v2/checkout/orders/X/capture" },
        { method: "POST", path: "/v1/notifications/../../v2/checkout/orders/X/capture" },
        { method: "POST", path: "/v1/notifications/verify-webhook-signature/../../../v2/checkout/orders/X/capture" },
        { method: "POST", path: "/v2/checkout/orders/X%2Fcapture" },
        { method: "POST", path: "/v2/payments/captures/X/refund" },
        { method: "POST", path: "/v2/payments/authorizations/X/capture" },
        { method: "POST", path: "/v1/payments/payouts" },
        { method: "GET", path: "/v2/checkout/orders/../orders/X" },
        { method: "GET", path: "/v2/checkout/orders/X/capture" },
        { method: "GET", path: "/v2/checkout/orders/X?y=1" },
        { method: "POST", path: "/v1/reporting/balances" },
        { method: "GET", path: "/v1/reporting/balances/../../../v2/checkout/orders/X" },
        { method: "GET", path: "/v1/reporting/transactions?x=/../" },
      ];
      for (const req of refusedCalls) await assert.rejects(paypalRead(req), /read-only PayPal call/, `${req.method} ${req.path}`);
      assert.deepEqual(reached, [], "nothing refused reached PayPal");
      const allowed: PayPalRequest[] = [
        { method: "GET", path: "/v2/checkout/orders/ORDER-1" },
        { method: "GET", path: "/v1/reporting/balances?currency_code=ALL" },
        { method: "GET", path: "/v1/reporting/transactions?" + new URLSearchParams({ start_date: "2026-11-01T00:00:00.000Z", end_date: "2026-11-02T00:00:00.000Z", fields: "transaction_info,payer_info", page_size: "100", page: "1" }) },
        { method: "GET", path: "/v1/customer/partners/PARTNERFICTIONAL/merchant-integrations?tracking_id=fipa-abc_DEF-1" },
        { method: "GET", path: "/v1/customer/partners/PARTNERFICTIONAL/merchant-integrations/SELLERFICTIONAL" },
        { method: "POST", path: "/v2/customer/partner-referrals", body: {} },
        { method: "POST", path: "/v1/notifications/verify-webhook-signature", body: {} },
        { method: "POST", path: "/v1/notifications/webhooks", body: {} },
        { method: "GET", path: "/v1/notifications/webhooks" },
      ];
      for (const req of allowed) await paypalRead(req);
      assert.equal(reached.length, allowed.length, "every call the app makes still gets through");
      globalThis.fetch = realFetch;
    }

    // ---- The signature check sends PayPal the event exactly as it arrived, not a re-serialised copy.
    {
      const raw = '{ "id":"WH-RAW","event_type":"PAYMENT.CAPTURE.COMPLETED","resource":{"amount":{"value":"250.10"},"n":1.0,"note":"caf\\u00e9 \\/"} }';
      let sent = "";
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).endsWith("/v1/oauth2/token")) return Response.json({ access_token: "token-fictional", expires_in: 3600 });
        sent = String(init?.body);
        return Response.json({ verification_status: "SUCCESS" });
      }) as typeof fetch;
      const headers = new Headers({ "paypal-auth-algo": "SHA256withRSA", "paypal-cert-url": "https://api.sandbox.paypal.com/cert", "paypal-transmission-id": "t-1",
        "paypal-transmission-sig": "sig", "paypal-transmission-time": "2026-11-14T00:00:00Z" });
      const result = await verifyWebhook(raw, headers);
      assert.equal(result.verified, true, result.verified ? "" : result.reason);
      assert.ok(sent.endsWith(`"webhook_event":${raw}}`), "the raw body is embedded byte for byte");
      const parsed = JSON.parse(sent);
      assert.deepEqual([parsed.webhook_id, parsed.transmission_id, parsed.auth_algo, parsed.webhook_event.id], ["WH-ID-FICTIONAL", "t-1", "SHA256withRSA", "WH-RAW"]);
      assert.deepEqual((await verifyWebhook("[1]", headers)).verified, false, "a body that is not an event is refused before any call");
      globalThis.fetch = realFetch;
    }

    // ---- The client's link: reuse, renewal, the ended states.
    const token = sent.payToken!;
    const view = await paymentLinkView(db, token);
    assert.deepEqual(view, { state: "open", item: invoice.item, amountMinor: invoice.amountMinor, currency: "USD" }, "the item and the amount, nothing about the household");
    assert.deepEqual(await paymentLinkView(db, "x".repeat(43)), { state: "ended" });
    assert.deepEqual(await paymentLinkView(db, "../../etc/passwd"), { state: "ended" });
    const nothing = fakeOrders();
    const status = { value: "PAYER_ACTION_REQUIRED" };
    const reading = fakeRead(() => status.value);
    const at = (ms: number) => new Date(orders.state.at.getTime() + ms);
    assert.deepEqual(await openPaymentLink(db, "x".repeat(43), nothing.create, reading.read, at(0)), { kind: "unknown" });
    assert.equal(nothing.requests.length + reading.calls.length, 0, "an unknown token reaches nothing");
    assert.deepEqual(await openPaymentLink(db, token, nothing.create, reading.read, at(60_000)), { kind: "redirect", url: sent.paypalApproveUrl });
    assert.equal(nothing.requests.length, 0, "a live order is reused");
    assert.deepEqual(reading.calls, ["/v2/checkout/orders/ORDER-1"]);
    status.value = "APPROVED";
    assert.deepEqual(await openPaymentLink(db, token, nothing.create, reading.read, at(60_000)), { kind: "processing" });
    status.value = "404";
    const lapsed = await openPaymentLink(db, token, nothing.create, reading.read, at(60_000));
    assert.equal(nothing.requests.length, 1, "an order PayPal no longer has is renewed");
    assert.equal(nothing.requests[0].requestId, "N-ORDER-1");
    assert.equal(nothing.requests[0].amountMinor, invoice.amountMinor);
    assert.equal(nothing.requests[0].payee, "PARTNERFICTIONAL");
    assert.deepEqual({ ...nothing.requests[0], requestId: "" }, { ...orders.requests[1], requestId: "" }, "Pay asks for the same order Approve did");
    assert.equal(lapsed.kind, "redirect");
    const renewed = await row(demo, invoice.id);
    const fourth = renewed.paypalOrderId!;
    assert.notEqual(fourth, "ORDER-1", "the invoice now holds the new order");
    assert.deepEqual(lapsed, { kind: "redirect", url: renewed.paypalApproveUrl });
    assert.equal(renewed.paypalApproveUrl, "https://www.sandbox.paypal.com/checkoutnow?token=" + fourth);
    // Opened after the reuse window: PayPal is still asked first. An order the client approved, or paid, is never replaced.
    const old = fakeOrders();
    const later = at(ORDER_REUSE_MS + 1_000);
    old.state.at = later;
    for (const taking of ["APPROVED", "COMPLETED/COMPLETED", "COMPLETED/PENDING", "COMPLETED"]) {
      status.value = taking;
      const before = reading.calls.length;
      assert.deepEqual(await openPaymentLink(db, token, old.create, reading.read, later), { kind: "processing" }, taking);
      assert.equal(reading.calls.length - before, 1, taking + ": the old order's state was asked");
    }
    assert.equal(old.requests.length, 0, "an approved or paid order is never replaced, whatever its age");
    assert.equal((await row(demo, invoice.id)).paypalOrderId, fourth);
    // Still waiting but about to lapse: replaced; two taps make one order.
    status.value = "PAYER_ACTION_REQUIRED";
    const [a, b] = await Promise.all([
      openPaymentLink(db, token, old.create, reading.read, later),
      openPaymentLink(db, token, old.create, reading.read, later),
    ]);
    assert.equal(old.state.made, 1, "two taps after the window make one order");
    assert.ok(old.requests.every(r => r.requestId === "N-" + fourth));
    assert.deepEqual([a.kind, b.kind], ["redirect", "redirect"]);
    const fifth = (await row(demo, invoice.id)).paypalOrderId;
    assert.ok(a.kind === "redirect" && a.url.endsWith(fifth!));
    // A completed order whose capture was declined took no money: replaced.
    status.value = "COMPLETED/DECLINED";
    const declined = fakeOrders();
    assert.equal((await openPaymentLink(db, token, declined.create, reading.read, at(60_000))).kind, "redirect");
    assert.equal(declined.requests[0]?.requestId, "N-" + fifth);
    // An order fipa dropped (its capture took no money) is replaced without asking PayPal about it.
    const sixth = (await row(demo, invoice.id)).paypalOrderId!;
    await db.update(schema.invoices).set({ paypalApproveUrl: null }).where(and(eq(schema.invoices.householdId, demo), eq(schema.invoices.id, invoice.id)));
    const dropped = fakeOrders();
    const asked = reading.calls.length;
    assert.equal((await openPaymentLink(db, token, dropped.create, reading.read, at(60_000))).kind, "redirect");
    assert.equal(reading.calls.length, asked);
    assert.equal(dropped.requests[0].requestId, "N-" + sixth);
    status.value = "PAYER_ACTION_REQUIRED";
    // A household that reconnected another account gets an order for it.
    const mineToken = (await row(connected, mine.id)).payToken!;
    await db.update(schema.paypalConnections).set({ sellerMerchantId: "NEWSELLERFICTIONAL" }).where(eq(schema.paypalConnections.householdId, connected));
    const moved = fakeOrders();
    await openPaymentLink(db, mineToken, moved.create, fakeRead(() => "PAYER_ACTION_REQUIRED").read, connectedOrders.state.at);
    assert.equal(moved.requests[0].payee, "NEWSELLERFICTIONAL");
    // A household that is no longer connected: the link has ended.
    await db.update(schema.paypalConnections).set({ connectionStatus: null }).where(eq(schema.paypalConnections.householdId, connected));
    const ended = fakeOrders();
    assert.deepEqual(await paymentLinkView(db, mineToken), { state: "ended" });
    assert.deepEqual(await openPaymentLink(db, mineToken, ended.create, reading.read, connectedOrders.state.at), { kind: "ended" });
    assert.equal(ended.requests.length, 0);
    // Taken by fipa but not yet confirmed by PayPal, paid by a capture, marked paid outside PayPal and closed.
    const shut = fakeOrders();
    const target = and(eq(schema.invoices.householdId, demo), eq(schema.invoices.id, invoice.id));
    await db.update(schema.invoices).set({ paypalCaptureId: "CAPTURE-1" }).where(target);
    assert.deepEqual(await paymentLinkView(db, token), { state: "processing" }, "a sent invoice whose payment was taken is not open again");
    assert.deepEqual(await openPaymentLink(db, token, shut.create, reading.read, at(0)), { kind: "processing" });
    await db.update(schema.invoices).set({ status: "paid", paidOn: today }).where(target);
    assert.deepEqual(await paymentLinkView(db, token), { state: "paid" });
    assert.deepEqual(await openPaymentLink(db, token, shut.create, reading.read, at(0)), { kind: "paid" });
    await db.update(schema.invoices).set({ paypalCaptureId: null }).where(target);
    assert.deepEqual(await paymentLinkView(db, token), { state: "paid" }, "paid is the status, however it was paid");
    assert.deepEqual(await openPaymentLink(db, token, shut.create, reading.read, at(0)), { kind: "paid" });
    await db.update(schema.invoices).set({ status: "closed", paidOn: null }).where(target);
    assert.deepEqual(await paymentLinkView(db, token), { state: "ended" });
    assert.equal(shut.requests.length, 0, "an ended link asks PayPal for nothing");
    await assert.rejects(approvePaymentLink(ctx(demo, invoice.approveKey, shut.create)), /closed/);

    // ---- Try it only: fipa pays the sent invoice as the client with the sandbox test card (D12). Only the webhook marks it paid (D15).
    {
      // The request itself: a card source, the Try it payee, the invoice's own ids, no act-for assertion.
      let seen: { headers: Record<string, string>; body: Record<string, any> } | undefined; // eslint-disable-line @typescript-eslint/no-explicit-any
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).endsWith("/v1/oauth2/token")) return Response.json({ access_token: "token-fictional", expires_in: 3600 });
        seen = { headers: init?.headers as Record<string, string>, body: JSON.parse(String(init?.body)) };
        return Response.json({ id: "CARD-ORDER", status: "COMPLETED", purchase_units: [{ payments: { captures: [{ id: "CARD-CAP", status: "COMPLETED" }] } }] }, { status: 201 });
      }) as typeof fetch;
      const req: OrderRequest = { payee: "PARTNERFICTIONAL", requestId: "T-X", invoiceId: "11111111-1111-4111-8111-111111111111", number: "P-X",
        item: "Logo", amountMinor: 25_000, currency: "USD", returnUrl: APP + "/r", cancelUrl: APP + "/c" };
      assert.deepEqual(await payWithSandboxTestCard(req), { orderId: "CARD-ORDER", orderStatus: "COMPLETED", captureId: "CARD-CAP", captureStatus: "COMPLETED" });
      const unit = seen!.body.purchase_units[0];
      assert.equal(seen!.body.intent, "CAPTURE");
      assert.equal(seen!.body.payment_source.card.number, "4005519200000004");
      assert.equal(seen!.body.payment_source.paypal, undefined, "a card, not the PayPal wallet");
      assert.deepEqual([unit.payee.merchant_id, unit.custom_id, unit.invoice_id, unit.amount], ["PARTNERFICTIONAL", req.invoiceId, "P-X", { currency_code: "USD", value: "250.00" }]);
      assert.equal(seen!.headers["PayPal-Request-Id"], "T-X");
      assert.equal(seen!.headers["PayPal-Partner-Attribution-Id"], "FIPA_TEST_BN");
      assert.equal(seen!.headers["PayPal-Auth-Assertion"], undefined, "fipa pays into its own account without acting for anyone");
      globalThis.fetch = realFetch;
    }
    {
      const tryOrders = fakeOrders();
      const target = await unbilled(other);
      await approvePaymentLink(ctx(other, target.approveKey, tryOrders.create));
      const sentOne = await row(other, target.id);
      assert.equal(sentOne.status, "sent");
      const cardCalls: OrderRequest[] = [];
      const cardOrders = new Map<string, string>();
      let captureStatus: string | null = "COMPLETED";
      let cardCount = 0;
      const pay: PayWithTestCard = async o => {
        cardCalls.push(o);
        let id = cardOrders.get(o.requestId);
        if (!id) { cardCount += 1; id = "CARD-ORDER-" + cardCount; cardOrders.set(o.requestId, id); }
        return { orderId: id, orderStatus: "COMPLETED", captureId: captureStatus ? "CARD-CAP-" + id : null, captureStatus };
      };
      const tryPay = (hid: string, id: string) => payInvoiceAsTestClient({ db, householdId: hid, invoiceId: id, pay });
      const refused = (hid: string, id: string, status: number) =>
        assert.rejects(tryPay(hid, id), (e: unknown) => e instanceof ApprovalError && e.status === status);

      // A household that is not a Try it one, another household's invoice, a draft: nothing reaches PayPal.
      const mineSigned = await unbilled(signedIn);
      await db.update(schema.invoices).set({ status: "sent", payToken: "tok-signed-in-fictional-aaaaaaaaaaaaaaaaaaaa", paypalPayeeId: "SELLERFICTIONAL" })
        .where(eq(schema.invoices.id, mineSigned.id));
      await refused(signedIn, mineSigned.id, 403);
      await refused(demo, sentOne.id, 404);
      const [draftClient] = await db.select().from(schema.clients).where(eq(schema.clients.householdId, other)).limit(1);
      const [draft] = await db.insert(schema.invoices).values({
        householdId: other, clientId: draftClient.id, status: "unbilled", item: "Draft", number: "P-DRAFT", amountMinor: 9_000, currency: "USD", fxRateMicro: 150_000_000,
        payToken: "tok-draft-fictional-aaaaaaaaaaaaaaaaaaaaaaaa", paypalPayeeId: "PARTNERFICTIONAL",
      }).returning();
      await refused(other, draft.id, 409);
      assert.equal(cardCalls.length, 0, "refusals ask PayPal for nothing");

      // A declined or failed capture keeps no capture id, and the invoice keeps the order it had.
      for (const status of ["DECLINED", "FAILED"]) {
        captureStatus = status;
        await refused(other, sentOne.id, 402);
        const after = await row(other, sentOne.id);
        assert.deepEqual([after.paypalCaptureId, after.paypalOrderId, after.status], [null, sentOne.paypalOrderId, "sent"], status);
      }
      assert.equal(cardCalls.at(-1)!.requestId, "T-" + sentOne.id);

      // Two taps send the same Request-Id and store one order.
      captureStatus = "COMPLETED";
      const [first, second] = await Promise.all([tryPay(other, sentOne.id), tryPay(other, sentOne.id)]);
      assert.deepEqual([first, second], [sentOne.id, sentOne.id]);
      assert.ok(cardCalls.every(c => c.requestId === "T-" + sentOne.id));
      assert.equal(cardCalls.at(-1)!.payee, "PARTNERFICTIONAL");
      assert.equal(cardCalls.at(-1)!.number, paypalInvoiceNumber(sentOne.id));
      const taken = await row(other, sentOne.id);
      assert.equal(taken.status, "sent", "the payment is taken, but only the webhook marks the invoice paid");
      const stored = taken.paypalOrderId!;
      assert.match(stored, /^CARD-ORDER-/);
      assert.equal(taken.paypalCaptureId, "CARD-CAP-" + stored);
      assert.equal(cardOrders.size, 1, "one PayPal order");
      assert.deepEqual(await paymentLinkView(db, taken.payToken!), { state: "processing" });
      await refused(other, sentOne.id, 409); // already taken

      // The completed-payment event for the stored card order marks it paid once.
      const completed = (id: string, order: string, over: { custom?: string; capture?: string; value?: string; invoice?: typeof sentOne } = {}) => ({
        id, event_type: "PAYMENT.CAPTURE.COMPLETED", create_time: "2026-11-14T16:00:00Z",
        resource: { id: over.capture ?? "CARD-CAP-" + order, status: "COMPLETED", amount: { currency_code: "USD", value: over.value ?? (sentOne.amountMinor / 100).toFixed(2) },
          custom_id: over.custom ?? sentOne.id, payee: { merchant_id: "PARTNERFICTIONAL" }, supplementary_data: { related_ids: { order_id: order } } },
      });
      const noCapture = async () => { throw new Error("a card order is captured at creation; nothing is taken by the webhook"); };
      await applyVerifiedDelivery(db, completed("WH-CARD-1", stored), noCapture);
      await applyVerifiedDelivery(db, completed("WH-CARD-1", stored), noCapture);
      await applyVerifiedDelivery(db, completed("WH-CARD-2", stored), noCapture);
      const paidOne = await row(other, sentOne.id);
      assert.equal(paidOne.status, "paid");
      assert.equal(paidOne.paypalCaptureId, "CARD-CAP-" + stored);
      const paidEvents = await db.select().from(schema.events).where(and(eq(schema.events.householdId, other), eq(schema.events.kind, "invoice_paid")));
      assert.equal(paidEvents.length, 1, "paid once however often the event comes");
      await refused(other, sentOne.id, 409); // paid
      // Any other event type is received without throwing.
      for (const type of ["CHECKOUT.ORDER.COMPLETED", "PAYMENT.CAPTURE.PENDING", "PAYMENT.CAPTURE.REFUNDED"]) {
        await applyVerifiedDelivery(db, { id: "WH-" + type, event_type: type, resource: { id: stored } }, noCapture);
      }

      // The event arrives before the order is stored: found by the invoice id it carries, with its amount and payee, and
      // the late store then changes nothing.
      const [client2] = await db.select().from(schema.clients).where(eq(schema.clients.householdId, other)).limit(1);
      const [early] = await db.insert(schema.invoices).values({
        householdId: other, clientId: client2.id, status: "sent", item: "Early", number: "P-EARLY", amountMinor: 12_000, currency: "USD", fxRateMicro: 150_000_000,
        sentOn: today, dueOn: today, paypalOrderId: "LINK-ORDER-EARLY", paypalPayeeId: "PARTNERFICTIONAL", payToken: "tok-early-fictional-aaaaaaaaaaaaaaaaaaaaaa",
      }).returning();
      const wrongAmount = completed("WH-CARD-WRONG", "CARD-ORDER-EARLY", { custom: early.id, capture: "CARD-CAP-EARLY", value: "119.99" });
      await applyVerifiedDelivery(db, wrongAmount, noCapture);
      assert.equal((await row(other, early.id)).status, "sent", "an event whose amount is not the invoice's settles nothing");
      const payRacing: PayWithTestCard = async () => {
        await applyVerifiedDelivery(db, completed("WH-CARD-EARLY", "CARD-ORDER-EARLY", { custom: early.id, capture: "CARD-CAP-EARLY", value: "120.00" }), noCapture);
        return { orderId: "CARD-ORDER-EARLY", orderStatus: "COMPLETED", captureId: "CARD-CAP-EARLY", captureStatus: "COMPLETED" };
      };
      assert.equal(await payInvoiceAsTestClient({ db, householdId: other, invoiceId: early.id, pay: payRacing }), early.id);
      const raced = await row(other, early.id);
      assert.equal(raced.status, "paid", "settled through custom_id before the order was stored");
      assert.deepEqual([raced.paypalCaptureId, raced.paypalOrderId], ["CARD-CAP-EARLY", "LINK-ORDER-EARLY"], "the late store changes nothing");
    }
    console.log("Approval tests passed: household isolation, order body and headers, payee for Try it and connected, one order per invoice, retry with one Request-Id, link reuse and renewal, ended and processing links, PayPal's invoice number kept out of view.");
  } finally { globalThis.fetch = realFetch; await pg.close(); }
}

main().catch(error => { console.error("Approval test failed", error); process.exitCode = 1; });
