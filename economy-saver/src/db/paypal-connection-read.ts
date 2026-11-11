import { eq } from "drizzle-orm";
import { env } from "@/lib/env";
import { NotConnected, type ConnectionView } from "@/lib/paypal/contracts";
import { requireHousehold, type Db } from "./household";
import { households, paypalConnections } from "./schema";

async function connectionRow(db: Db, hid: string) {
  const [row] = await db.select({
    demo: households.isDemo, status: paypalConnections.connectionStatus, email: paypalConnections.paypalEmail,
    detail: paypalConnections.statusDetail, seller: paypalConnections.sellerMerchantId,
  }).from(households).leftJoin(paypalConnections, eq(paypalConnections.householdId, households.id))
    .where(eq(households.id, requireHousehold(hid)));
  if (!row) throw new Error("Household not found");
  return row;
}

/** What Settings → PayPal and Home show about a household's PayPal connection (D76). */
export async function paypalConnectionView(db: Db, hid: string): Promise<ConnectionView> {
  const row = await connectionRow(db, hid);
  if (row.demo) return { state: "demo", email: null, detail: null };
  if (row.status === "connected") return { state: "connected", email: row.email, detail: null };
  if (row.status === "pending") return { state: "pending", email: null, detail: row.detail };
  return { state: "none", email: null, detail: null };
}

/**
 * The PayPal account a payment link pays: a connected household's own, a Try it household's fipa's own sandbox account.
 * A signed-in household that has not connected throws NotConnected.
 */
export async function payeeFor(tx: Db, hid: string): Promise<string> {
  const row = await connectionRow(tx, hid);
  if (row.demo) return env().PAYPAL_PARTNER_MERCHANT_ID;
  if (row.status === "connected" && row.seller) return row.seller;
  throw new NotConnected();
}
