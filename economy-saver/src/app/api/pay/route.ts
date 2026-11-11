import { db, MissingDatabaseUrl } from "@/db/client";
import { openPaymentLink } from "@/db/payment-link";
import { ClientIpError, clientIp, consumeIpRequest } from "@/db/rate-limit";
import { formOf, text, tooMany } from "@/lib/door";
import { paypalRead } from "@/lib/paypal/client";
import { createOrder } from "@/lib/paypal/send";
import { sameOrigin } from "@/lib/session";

/** Taps of Pay one client address may make in an hour, counted before anything is read or asked of PayPal. */
const PAYS_PER_HOUR = 30;

/** The pay page sends no referrer, so the browser sends its own post with `Origin: null`; Fetch Metadata still says it came from this site. */
function fromOurPage(request: Request): boolean {
  return sameOrigin(request) || (request.headers.get("origin") === "null" && request.headers.get("sec-fetch-site") === "same-origin");
}

const go = (location: string) => new Response(null, { status: 303, headers: {
  Location: location, "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer",
} });

/** The client tapped Pay on a payment link: no household session, only the token. Sends them to PayPal to pay. */
export async function POST(request: Request) {
  if (!fromOurPage(request)) return text("Same-origin request required", 403);
  try {
    if (!await consumeIpRequest(db(), clientIp(request), "pay", PAYS_PER_HOUR, "hour")) return tooMany("Too many requests. Try again later.");
  } catch (error) {
    if (error instanceof ClientIpError || error instanceof MissingDatabaseUrl) return text(error.message, error instanceof ClientIpError ? error.status : 503);
    throw error;
  }
  const form = await formOf(request);
  if (form instanceof Response) return form;
  const token = form.get("token");
  if (typeof token !== "string" || token.length > 100) return text("This link has ended", 404);
  let opened;
  try {
    opened = await openPaymentLink(db(), token, createOrder, paypalRead, new Date());
  } catch (error) {
    console.error(`[pay] could not open a payment link: ${(error as Error).message}`);
    return text("PayPal did not answer. Go back and tap Pay again.", 502);
  }
  switch (opened.kind) {
    case "unknown": return text("This link has ended", 404);
    case "redirect": return go(opened.url);
    case "processing": return go(`/pay/${encodeURIComponent(token)}/done`);
    default: return go(`/pay/${encodeURIComponent(token)}`);
  }
}
