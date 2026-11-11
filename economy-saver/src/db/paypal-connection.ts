import { and, eq, getTableColumns, ne } from "drizzle-orm";
import { env } from "@/lib/env";
import { recordEvent, recordWebhookDelivery, requireHousehold, withHousehold, type Db } from "./household";
import { households, members, paypalConnections } from "./schema";
import { createReferral, sellerStatus } from "@/lib/paypal/partner";
import { NotConnected, type ConnectionView, type PayPalCall } from "@/lib/paypal/contracts";
import type { PayPalWebhookEvent } from "@/lib/paypal/webhook";

/** A connection step that cannot go ahead; `message` is for the person. */
export class ConnectError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409 = 409) { super(message); this.name = "ConnectError"; }
}

const WAITING = "PayPal hasn't finished your sign-up yet. Check again in a moment.";
const TAKEN = "That PayPal account is already connected to another fipa household.";

/**
 * The household owner's PayPal connection row (one per household, made with it), with the household's Try it flag, time zone
 * and home currency. Undefined when the household has none. The one place this lookup is written.
 */
export async function ownerPayPal(tx: Db, householdId: string) {
  const hid = requireHousehold(householdId);
  const [row] = await tx.select({ ...getTableColumns(paypalConnections), demo: households.isDemo, timeZone: households.timeZone, home: households.homeCurrency })
    .from(paypalConnections)
    .innerJoin(members, and(eq(members.id, paypalConnections.memberId), eq(members.householdId, hid)))
    .innerJoin(households, eq(households.id, paypalConnections.householdId))
    .where(and(eq(paypalConnections.householdId, hid), eq(members.role, "owner")));
  return row;
}

async function ownerConnection(tx: Db, hid: string) {
  const row = await ownerPayPal(tx, hid);
  if (!row) throw new ConnectError("This household has no PayPal record.", 404);
  return row;
}

/** What Settings → PayPal and Home show about a household's PayPal connection (D76). */
export async function paypalConnectionView(tx: Db, hid: string): Promise<ConnectionView> {
  const row = await ownerPayPal(tx, hid);
  if (!row) throw new Error("Household PayPal connection is missing.");
  if (row.demo) return { state: "demo", email: null, detail: null };
  if (row.connectionStatus === "connected") return { state: "connected", email: row.paypalEmail, detail: null };
  if (row.connectionStatus === "pending") return { state: "pending", email: null, detail: row.statusDetail };
  return { state: "none", email: null, detail: null };
}

/**
 * The PayPal account a payment link pays: a connected household's own, a Try it household's fipa's own sandbox account.
 * A signed-in household that has not connected throws NotConnected.
 */
export async function payeeFor(tx: Db, hid: string): Promise<string> {
  const row = await ownerPayPal(tx, hid);
  if (!row) throw new Error("Household PayPal connection is missing.");
  if (row.demo) return env().PAYPAL_PARTNER_MERCHANT_ID;
  if (row.connectionStatus === "connected" && row.sellerMerchantId) return row.sellerMerchantId;
  throw new NotConnected();
}

const CLEARED = {
  connectionStatus: null, trackingId: null, sellerMerchantId: null, paypalEmail: null, statusDetail: null,
  referralStartedAt: null, connectedAt: null, transactionsReadUntil: null,
} as const;

/** Starts a sign-up for the owner: a fresh tracking id, stored as pending, and the PayPal address to send the person to. */
export async function startConnect(db: Db, householdId: string, call: PayPalCall): Promise<string> {
  const hid = requireHousehold(householdId);
  const current = await withHousehold(db, hid, tx => ownerConnection(tx, hid));
  if (current.demo) throw new ConnectError("A Try it household can't connect PayPal. Sign in with your email first.", 400);
  if (current.connectionStatus === "connected") throw new ConnectError("PayPal is already connected. Disconnect it first.");
  const trackingId = `fipa-${Buffer.from(crypto.getRandomValues(new Uint8Array(18))).toString("base64url")}`;
  const actionUrl = await createReferral(call, trackingId);
  await withHousehold(db, hid, async tx => {
    const row = await ownerConnection(tx, hid);
    if (row.connectionStatus === "connected") throw new ConnectError("PayPal is already connected. Disconnect it first.");
    await tx.update(paypalConnections).set({ connectionStatus: "pending", trackingId, statusDetail: null, referralStartedAt: new Date() })
      .where(and(eq(paypalConnections.householdId, hid), eq(paypalConnections.id, row.id)));
  });
  return actionUrl;
}

export type ConfirmResult = { state: "connected" | "pending"; detail: string | null };

/**
 * Confirms the sign-up this household started by asking PayPal about the tracking id it stored; nothing in a return address
 * (tracking id, merchant ids, flags) is believed. The connection is stored only when the account can receive payments, its
 * email is confirmed and fipa's permission is granted; otherwise it stays pending and says what PayPal still needs.
 */
export async function confirmConnection(db: Db, householdId: string, call: PayPalCall): Promise<ConfirmResult> {
  const hid = requireHousehold(householdId);
  const row = await withHousehold(db, hid, tx => ownerConnection(tx, hid));
  if (row.connectionStatus === "connected") return { state: "connected", detail: null };
  if (row.connectionStatus !== "pending" || !row.trackingId) throw new ConnectError("There is no PayPal sign-up to check. Start again from Settings.", 400);
  const seller = await sellerStatus(call, row.trackingId);
  const pending = async (detail: string): Promise<ConfirmResult> => {
    await withHousehold(db, hid, tx => tx.update(paypalConnections).set({ statusDetail: detail })
      .where(and(eq(paypalConnections.householdId, hid), eq(paypalConnections.id, row.id), eq(paypalConnections.trackingId, row.trackingId!))));
    return { state: "pending", detail };
  };
  if (!seller.found) return pending(WAITING);
  if (!seller.ready) return pending(seller.missing.join(" "));
  const taken = await db.select({ id: paypalConnections.id }).from(paypalConnections)
    .where(and(eq(paypalConnections.sellerMerchantId, seller.merchantId), eq(paypalConnections.connectionStatus, "connected"), ne(paypalConnections.id, row.id)));
  if (taken.length > 0) return pending(TAKEN);
  try {
    await withHousehold(db, hid, async tx => {
      const done = await tx.update(paypalConnections).set({
        connectionStatus: "connected", sellerMerchantId: seller.merchantId, paypalEmail: seller.email, statusDetail: null, connectedAt: new Date(),
      }).where(and(eq(paypalConnections.householdId, hid), eq(paypalConnections.id, row.id), eq(paypalConnections.trackingId, row.trackingId!), eq(paypalConnections.connectionStatus, "pending")))
        .returning({ id: paypalConnections.id });
      if (done.length === 1) await recordEvent(tx, hid, { madeBy: "form", kind: "paypal_connected", title: "PayPal connected", body: seller.email ?? undefined });
    });
  } catch (error) {
    if (uniqueViolation(error)) return pending(TAKEN); // another household connected this account between the check and the write
    throw error;
  }
  return { state: "connected", detail: null };
}

function uniqueViolation(error: unknown): boolean {
  for (let e = error as { code?: string; cause?: unknown } | undefined, depth = 0; e && depth < 4; e = e.cause as typeof e, depth++) {
    if (e.code === "23505") return true;
  }
  return false;
}

/** Forgets the connection. PayPal has no call that removes fipa's permission, so the person does that in PayPal. */
export async function disconnect(db: Db, householdId: string): Promise<boolean> {
  const hid = requireHousehold(householdId);
  return withHousehold(db, hid, async tx => {
    const row = await ownerConnection(tx, hid);
    if (row.connectionStatus === null) return false;
    const was = row.connectionStatus;
    await tx.update(paypalConnections).set(CLEARED).where(and(eq(paypalConnections.householdId, hid), eq(paypalConnections.id, row.id)));
    if (was === "connected") await recordEvent(tx, hid, { madeBy: "form", kind: "paypal_disconnected", title: "PayPal disconnected" });
    return true;
  });
}

const str = (value: unknown) => (typeof value === "string" && value.trim() !== "" ? value : undefined);

/**
 * A verified MERCHANT.* delivery (the signature has been checked). The resource fields are not verified against real
 * deliveries, so they are read defensively: without the field this needs, the delivery is recorded and nothing changes.
 * Onboarding completed confirms by asking PayPal; consent revoked clears the record like Disconnect.
 */
export async function applyMerchantEvent(db: Db, event: PayPalWebhookEvent, call: PayPalCall): Promise<void> {
  const merchantId = str(event.resource?.merchant_id);
  const trackingId = str(event.resource?.tracking_id);
  const receipt = () => ({ paypalEventId: event.id, eventType: event.event_type, verified: true, payload: { createdAt: event.create_time } });
  if (event.event_type === "MERCHANT.ONBOARDING.COMPLETED" && trackingId) {
    const [match] = await db.select({ hid: paypalConnections.householdId }).from(paypalConnections)
      .where(and(eq(paypalConnections.trackingId, trackingId), eq(paypalConnections.connectionStatus, "pending")));
    if (match) {
      // Confirming asks PayPal; if that fails the delivery fails and PayPal sends it again, so the receipt comes after it.
      await confirmConnection(db, match.hid, call);
      await recordWebhookDelivery(db, match.hid, receipt());
      return;
    }
  }
  if (event.event_type === "MERCHANT.PARTNER-CONSENT.REVOKED" && merchantId) {
    const [match] = await db.select({ hid: paypalConnections.householdId }).from(paypalConnections)
      .where(and(eq(paypalConnections.sellerMerchantId, merchantId), eq(paypalConnections.connectionStatus, "connected")));
    if (match) {
      await withHousehold(db, match.hid, async tx => {
        if (!await recordWebhookDelivery(tx, match.hid, receipt())) return;
        const cleared = await tx.update(paypalConnections).set(CLEARED)
          .where(and(eq(paypalConnections.householdId, match.hid), eq(paypalConnections.sellerMerchantId, merchantId), eq(paypalConnections.connectionStatus, "connected")))
          .returning({ id: paypalConnections.id });
        if (cleared.length > 0) await recordEvent(tx, match.hid, { madeBy: "form", kind: "paypal_disconnected", title: "PayPal disconnected", body: "PayPal reported that fipa's permission was removed.", notify: true });
      });
      return;
    }
  }
  await recordWebhookDelivery(db, null, receipt());
}
