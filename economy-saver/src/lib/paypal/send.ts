// The PayPal calls that make or take a payment (D12). Lint lets only the approve route and the link's Pay route
// import createOrder, only the webhook route import captureOrder, only the Try it pay-as-the-client data function import
// payWithSandboxTestCard, and only this file import paypalRequest.
import { z } from "zod";
import { fromMinor } from "@/lib/money/format";
import { PayPalError, paypalRequest } from "@/lib/paypal/client";
import type { CaptureOrder, CreateOrder, MadeOrder, OrderRequest, PayWithTestCard } from "@/lib/paypal/contracts";

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

/** The order body both calls send: the invoice's amount, its ids and the payee. */
const orderUnit = (o: OrderRequest) => ({
  reference_id: o.invoiceId,
  custom_id: o.invoiceId,
  invoice_id: o.number,
  description: o.item.slice(0, 127),
  amount: { currency_code: o.currency, value: fromMinor(o.amountMinor, o.currency).toFixed(2) },
  payee: { merchant_id: o.payee },
});

/** Asks PayPal for an order paid to the payee's account. The call always names the payee in the act-for assertion (D13). */
export const createOrder: CreateOrder = async (o): Promise<MadeOrder> => {
  const body = {
    intent: "CAPTURE",
    purchase_units: [orderUnit(o)],
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

/** PayPal's published sandbox test Visa (developer.paypal.com/tools/sandbox/card-testing): a public test number, not a secret. */
const SANDBOX_TEST_CARD = {
  number: "4005519200000004", expiry: "2030-12", security_code: "123", name: "Test Client",
  billing_address: { address_line_1: "123 Main St", admin_area_2: "San Jose", admin_area_1: "CA", postal_code: "95131", country_code: "US" },
};

const cardOrderResponse = z.object({
  id: z.string().min(1),
  status: z.string(),
  purchase_units: z.array(z.object({ payments: z.object({
    captures: z.array(z.object({ id: z.string().min(1), status: z.string().optional() })).optional(),
  }).optional() })).optional(),
});

/**
 * Pays an order as the client with the sandbox test card, so a Try it judge can play the client without a PayPal login (D12).
 * One call makes the order and captures it into the payee's account; it is the same order body as createOrder, with the card
 * in place of the PayPal wallet. It sends no act-for assertion (fipa pays into its own sandbox account). It only runs against
 * the sandbox (the environment setting refuses anything else when PayPal is first asked). The caller must have checked that the
 * household is a Try it household; this does not mark anything paid, the verified webhook does (D15).
 */
export const payWithSandboxTestCard: PayWithTestCard = async o => {
  const body = { intent: "CAPTURE", purchase_units: [orderUnit(o)], payment_source: { card: SANDBOX_TEST_CARD } };
  const made = cardOrderResponse.parse(await paypalRequest({
    method: "POST", path: "/v2/checkout/orders", body, requestId: o.requestId,
  }));
  const captured = made.purchase_units?.[0]?.payments?.captures?.[0];
  return { orderId: made.id, orderStatus: made.status, captureId: captured?.id ?? null, captureStatus: captured?.status ?? null };
};
