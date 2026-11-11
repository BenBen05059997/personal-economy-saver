// Connect PayPal (D76): the referral, the tracking-id check, the readiness checks, one account per household,
// disconnect, a revoked-consent delivery and the payee. PGlite and a fake PayPal call; no network, no real settings.
import assert from "node:assert/strict";

// Fictional settings; the env schema reads them when the PayPal modules run.
Object.assign(process.env, {
  PAYPAL_ENVIRONMENT: "SANDBOX", PAYPAL_CLIENT_ID: "client-fictional", PAYPAL_CLIENT_SECRET: "secret-fictional",
  PAYPAL_PARTNER_ATTRIBUTION_ID: "FIPA_TEST_BN", PAYPAL_PARTNER_MERCHANT_ID: "PARTNERFICTIONAL", APP_URL: "https://fipa.example.test",
});

import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { and, eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { seedBen } from "@/db/seed";
import { applyMerchantEvent, confirmConnection, ConnectError, disconnect, recheckConnection, startConnect } from "@/db/paypal-connection";
import { paypalConnectionView, payeeFor } from "@/db/paypal-connection-read";
import { applyVerifiedDelivery } from "@/lib/events";
import { PayPalError } from "@/lib/paypal/client";
import { NotConnected, type PayPalCall, type PayPalRequest } from "@/lib/paypal/contracts";
import { referralBody } from "@/lib/paypal/partner";
import type { PayPalWebhookEvent } from "@/lib/paypal/webhook";

const BASE = "/v1/customer/partners/PARTNERFICTIONAL/merchant-integrations";

type Seller = { merchant: string; email?: string; receivable?: boolean; confirmed?: boolean; partner?: string; known?: boolean };

/** A fake PayPal: referrals are accepted, and sellers are looked up by tracking id from this table. */
function fakePayPal(sellers: Map<string, Seller>) {
  const calls: PayPalRequest[] = [];
  const call: PayPalCall = async req => {
    calls.push(req);
    if (req.method === "POST" && req.path === "/v2/customer/partner-referrals") {
      return { links: [{ rel: "self", href: "https://api-m.sandbox.paypal.com/x" }, { rel: "action_url", href: "https://www.sandbox.paypal.com/bizsignup/partner/entry?referralToken=fictional" }] };
    }
    if (req.method === "GET" && req.path.startsWith(`${BASE}?tracking_id=`)) {
      const seller = sellers.get(decodeURIComponent(req.path.split("tracking_id=")[1]));
      if (!seller || seller.known === false) throw new PayPalError("Not found", 404);
      return { merchant_id: seller.merchant, tracking_id: "echo" };
    }
    if (req.method === "GET" && req.path.startsWith(`${BASE}/`)) {
      const id = decodeURIComponent(req.path.slice(BASE.length + 1));
      const seller = [...sellers.values()].find(s => s.merchant === id);
      if (!seller) throw new PayPalError("Not found", 404);
      return {
        merchant_id: id, primary_email: seller.email ?? "seller@example.test",
        primary_email_confirmed: seller.confirmed ?? true, payments_receivable: seller.receivable ?? true,
        oauth_integrations: [{ integration_type: "OAUTH_THIRD_PARTY", oauth_third_party: [{ partner_client_id: seller.partner ?? "client-fictional", scopes: ["x"] }] }],
      };
    }
    throw new Error(`Unexpected PayPal call ${req.method} ${req.path}`);
  };
  return { call, calls };
}

const event = (id: string, type: string, resource: Record<string, unknown>): PayPalWebhookEvent => ({ id, event_type: type, create_time: "2026-11-11T00:00:00Z", resource });

async function main() {
  const pg = new PGlite({ extensions: { pg_trgm } });
  try {
    const db = drizzle(pg, { schema });
    await migrate(db, { migrationsFolder: "./drizzle" });
    const demo = await seedBen(db, { isDemo: true });
    const a = await seedBen(db, { isDemo: false });
    const b = await seedBen(db, { isDemo: false });
    const row = async (hid: string) => (await db.select().from(schema.paypalConnections).where(eq(schema.paypalConnections.householdId, hid)))[0];
    const events = (hid: string, kind: string) => db.select().from(schema.events).where(and(eq(schema.events.householdId, hid), eq(schema.events.kind, kind)));
    const sellers = new Map<string, Seller>();
    const { call, calls } = fakePayPal(sellers);

    // The referral body: the three permissions, the express checkout product, consent and the return address.
    const body = referralBody("fipa-track");
    assert.equal(body.tracking_id, "fipa-track");
    assert.equal(body.partner_config_override.return_url, "https://fipa.example.test/api/paypal/connect/return?tracking_id=fipa-track");
    assert.deepEqual(body.operations[0].api_integration_preference.rest_api_integration.third_party_details.features, ["PAYMENT", "ACCESS_MERCHANT_INFORMATION", "ADVANCED_TRANSACTIONS_SEARCH"]);
    assert.equal(body.operations[0].api_integration_preference.rest_api_integration.integration_type, "THIRD_PARTY");
    assert.deepEqual(body.products, ["EXPRESS_CHECKOUT"]);
    assert.deepEqual(body.legal_consents, [{ type: "SHARE_DATA_CONSENT", granted: true }]);

    // Views and payee before connecting.
    assert.equal((await paypalConnectionView(db, demo)).state, "demo");
    assert.equal((await paypalConnectionView(db, a)).state, "none");
    assert.equal(await payeeFor(db, demo), "PARTNERFICTIONAL");
    await assert.rejects(payeeFor(db, a), NotConnected);

    // A Try it household cannot connect, and nothing is asked of PayPal.
    await assert.rejects(startConnect(db, demo, call), ConnectError);
    assert.equal(calls.length, 0);

    // Starting stores a pending tracking id and returns PayPal's address.
    const url = await startConnect(db, a, call);
    assert.match(url, /^https:\/\/www\.sandbox\.paypal\.com\//);
    const posted = calls[0];
    assert.equal(posted.method, "POST");
    assert.equal(posted.actAs, undefined);
    const tracking = (posted.body as { tracking_id: string }).tracking_id;
    const started = await row(a);
    assert.equal(started.connectionStatus, "pending");
    assert.equal(started.trackingId, tracking);
    assert.ok(started.referralStartedAt);
    assert.equal((await paypalConnectionView(db, a)).state, "pending");
    await assert.rejects(payeeFor(db, a), NotConnected);

    // A tracking id that is not the one just started is refused, whoever asks, and nothing is asked of PayPal.
    const before = calls.length;
    await assert.rejects(confirmConnection(db, a, "fipa-someone-else", call), ConnectError);
    await assert.rejects(confirmConnection(db, b, tracking, call), ConnectError); // another household's tracking id
    assert.equal(calls.length, before);
    assert.equal((await row(b)).connectionStatus, null);

    // PayPal does not know the sign-up yet: still waiting, not a crash.
    let result = await recheckConnection(db, a, call);
    assert.equal(result.state, "pending");
    assert.match(result.detail!, /hasn't finished/);

    // Each readiness check on its own keeps the connection pending and says what is missing.
    sellers.set(tracking, { merchant: "SELLERA", receivable: false });
    result = await confirmConnection(db, a, tracking, call);
    assert.equal(result.state, "pending");
    assert.match(result.detail!, /can't receive payments/);
    sellers.set(tracking, { merchant: "SELLERA", confirmed: false });
    result = await confirmConnection(db, a, tracking, call);
    assert.match(result.detail!, /Confirm your email/);
    sellers.set(tracking, { merchant: "SELLERA", partner: "some-other-app" });
    result = await confirmConnection(db, a, tracking, call);
    assert.match(result.detail!, /permission isn't granted/);
    assert.equal((await row(a)).connectionStatus, "pending");
    assert.equal((await paypalConnectionView(db, a)).detail, result.detail);

    // Everything ready: connected with the PayPal email, the seller id and an Activity event.
    sellers.set(tracking, { merchant: "SELLERA", email: "ben-seller@example.test" });
    result = await confirmConnection(db, a, tracking, call);
    assert.deepEqual(result, { state: "connected", detail: null });
    const connected = await row(a);
    assert.equal(connected.connectionStatus, "connected");
    assert.equal(connected.sellerMerchantId, "SELLERA");
    assert.equal(connected.paypalEmail, "ben-seller@example.test");
    assert.ok(connected.connectedAt);
    assert.deepEqual(await paypalConnectionView(db, a), { state: "connected", email: "ben-seller@example.test", detail: null });
    assert.equal(await payeeFor(db, a), "SELLERA");
    assert.equal((await events(a, "paypal_connected")).length, 1);
    await assert.rejects(startConnect(db, a, call), ConnectError); // already connected
    const again = await confirmConnection(db, a, tracking, call); // a second return changes nothing
    assert.equal(again.state, "connected");
    assert.equal((await events(a, "paypal_connected")).length, 1);

    // One PayPal account belongs to one household.
    await startConnect(db, b, call);
    const trackingB = (await row(b)).trackingId!;
    sellers.set(trackingB, { merchant: "SELLERA" });
    result = await confirmConnection(db, b, trackingB, call);
    assert.equal(result.state, "pending");
    assert.match(result.detail!, /already connected to another/);
    assert.equal((await row(b)).connectionStatus, "pending");
    assert.equal((await row(b)).sellerMerchantId, null);

    // Disconnect clears the record, says so in Activity, and the payee is gone with it.
    assert.equal(await disconnect(db, a), true);
    const cleared = await row(a);
    assert.equal(cleared.connectionStatus, null);
    assert.equal(cleared.sellerMerchantId, null);
    assert.equal(cleared.paypalEmail, null);
    assert.equal(cleared.trackingId, null);
    assert.equal((await paypalConnectionView(db, a)).state, "none");
    await assert.rejects(payeeFor(db, a), NotConnected);
    assert.equal((await events(a, "paypal_disconnected")).length, 1);
    assert.equal(await disconnect(db, a), false);
    assert.equal((await row(b)).connectionStatus, "pending"); // the other household is untouched

    // B can now connect that account (a tracking id is single-use, so B's sign-up is checked as it stands).
    result = await confirmConnection(db, b, trackingB, call);
    assert.equal(result.state, "connected");
    assert.equal(await payeeFor(db, b), "SELLERA");

    // A verified MERCHANT.PARTNER-CONSENT.REVOKED delivery clears the connection, once, through the delivery entry point.
    const revoked = event("WH-REVOKE-1", "MERCHANT.PARTNER-CONSENT.REVOKED", { merchant_id: "SELLERA" });
    await applyVerifiedDelivery(db, revoked);
    assert.equal((await row(b)).connectionStatus, null);
    assert.equal((await row(b)).sellerMerchantId, null);
    const revokedEvents = await events(b, "paypal_disconnected");
    assert.equal(revokedEvents.length, 1);
    assert.equal(revokedEvents[0].notify, true);
    await applyVerifiedDelivery(db, revoked); // a redelivery changes nothing
    assert.equal((await events(b, "paypal_disconnected")).length, 1);
    const receipts = await db.select().from(schema.webhookDeliveries).where(eq(schema.webhookDeliveries.paypalEventId, "WH-REVOKE-1"));
    assert.equal(receipts.length, 1);
    assert.equal(receipts[0].householdId, b);
    assert.deepEqual(Object.keys(receipts[0].payload as object), ["createdAt"]);

    // Merchant deliveries without the fields they need, or for an account that is not ours, are recorded and change nothing.
    await applyVerifiedDelivery(db, event("WH-REVOKE-2", "MERCHANT.PARTNER-CONSENT.REVOKED", {}));
    await applyVerifiedDelivery(db, event("WH-REVOKE-3", "MERCHANT.PARTNER-CONSENT.REVOKED", { merchant_id: "NOBODY" }));
    await applyVerifiedDelivery(db, event("WH-ONBOARD-1", "MERCHANT.ONBOARDING.COMPLETED", { merchant_id: 42 }));
    for (const id of ["WH-REVOKE-2", "WH-REVOKE-3", "WH-ONBOARD-1"]) {
      const [stored] = await db.select().from(schema.webhookDeliveries).where(eq(schema.webhookDeliveries.paypalEventId, id));
      assert.equal(stored.householdId, null);
    }

    // MERCHANT.ONBOARDING.COMPLETED confirms by asking PayPal, for the household whose pending tracking id it names.
    await startConnect(db, a, call);
    const trackingA2 = (await row(a)).trackingId!;
    sellers.set(trackingA2, { merchant: "SELLERA2", email: "second@example.test" });
    await applyMerchantEvent(db, event("WH-ONBOARD-2", "MERCHANT.ONBOARDING.COMPLETED", { merchant_id: "SELLERA2", tracking_id: trackingA2 }), call);
    assert.equal((await row(a)).connectionStatus, "connected");
    assert.equal((await row(a)).sellerMerchantId, "SELLERA2");
    // A delivery naming a tracking id nobody started changes nothing.
    await applyMerchantEvent(db, event("WH-ONBOARD-3", "MERCHANT.ONBOARDING.COMPLETED", { merchant_id: "SELLERX", tracking_id: "fipa-unknown" }), call);
    assert.equal((await row(b)).connectionStatus, null);

    console.log("PayPal connect: all checks passed");
  } finally {
    await pg.close();
  }
}

main().catch(error => { console.error(error); process.exit(1); });
