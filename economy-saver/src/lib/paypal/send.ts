// The two PayPal calls that make or take a payment (D12). Lint lets only the approve route and the link's Pay route
// import createOrder, only the webhook route import captureOrder, and only this file import paypalRequest.
import { z } from "zod";
import { fromMinor } from "@/lib/money/format";
import { PayPalError, paypalRequest } from "@/lib/paypal/client";
import type { CaptureOrder, CreateOrder, MadeOrder } from "@/lib/paypal/contracts";

const orderResponse = z.object({
  id: z.string().min(1),
  links: z.array(z.object({ rel: z.string(), href: z.string() })),
});

/** Only an https address on paypal.com can be where a client is sent to pay. */
export function isPayPalApproveUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (url.hostname === "paypal.com" || url.hostname.endsWith(".paypal.com"));
  } catch { return false; }
}

/** Asks PayPal for an order paid to the payee's account. The call always names the payee in the act-for assertion (D13). */
export const createOrder: CreateOrder = async (o): Promise<MadeOrder> => {
  const body = {
    intent: "CAPTURE",
    purchase_units: [{
      reference_id: o.invoiceId,
      custom_id: o.invoiceId,
      invoice_id: o.number,
      description: o.item.slice(0, 127),
      amount: { currency_code: o.currency, value: fromMinor(o.amountMinor, o.currency).toFixed(2) },
      payee: { merchant_id: o.payee },
    }],
    payment_source: { paypal: { experience_context: {
      brand_name: "fipa",
      landing_page: "NO_PREFERENCE",
      user_action: "PAY_NOW",
      shipping_preference: "NO_SHIPPING",
      return_url: o.returnUrl,
      cancel_url: o.cancelUrl,
    } } },
  };
  const made = orderResponse.parse(await paypalRequest({
    method: "POST", path: "/v2/checkout/orders", body, actAs: o.payee, requestId: o.requestId,
  }));
  const approve = made.links.find(link => link.rel === "payer-action")?.href;
  if (!approve || !isPayPalApproveUrl(approve)) throw new PayPalError("PayPal did not give a payment address");
  return { orderId: made.id, approveUrl: approve, createdAt: new Date() };
};

const captureResponse = z.object({
  purchase_units: z.array(z.object({ payments: z.object({
    captures: z.array(z.object({ id: z.string().min(1), status: z.string().optional() })).optional(),
  }).optional() })).optional(),
});

/** A capture that took money or may still: only these keep their id on the invoice. */
const TAKING = ["COMPLETED", "PENDING"];

/**
 * Takes the payment of an order the client approved and gives back PayPal's capture id. An order that was already captured
 * counts as taken, with no id: the completed-payment event brings it. A capture PayPal answered as DECLINED or FAILED took
 * nothing: no id, and `declined`. Any other answer keeps no id
 * and is left to PayPal's own events.
 */
export const captureOrder: CaptureOrder = async (orderId, payee) => {
  let body: unknown;
  try {
    body = await paypalRequest({
      method: "POST", path: `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, body: {},
      actAs: payee, requestId: `C-${orderId}`,
    });
  } catch (error) {
    if (error instanceof PayPalError && error.status === 422 && error.issue === "ORDER_ALREADY_CAPTURED") return { captureId: null };
    throw error;
  }
  const parsed = captureResponse.safeParse(body);
  const captured = parsed.success ? parsed.data.purchase_units?.[0]?.payments?.captures?.[0] : undefined;
  if (!captured) return { captureId: null };
  if (captured.status !== undefined && TAKING.includes(captured.status)) return { captureId: captured.id };
  if (captured.status === "DECLINED" || captured.status === "FAILED") return { captureId: null, declined: true };
  return { captureId: null };
};
