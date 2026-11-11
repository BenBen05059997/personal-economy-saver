import { env, PAYPAL_API_BASE } from "@/lib/env";
import type { PayPalCall, PayPalRequest } from "@/lib/paypal/contracts";

/** How long one PayPal call may take. */
export const PAYPAL_TIMEOUT_MS = 8000;

export class PayPalError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly debugId?: string,
    readonly details?: unknown,
    readonly issue?: string,
  ) {
    super(message);
    this.name = "PayPalError";
  }
}

let token: { value: string; expiresAt: number } | undefined;

/** PayPal refused this token (401): forget it, unless another call has already replaced it. */
function dropAccessToken(value: string) {
  if (token?.value === value) token = undefined;
}

// OAuth client-credentials token, cached until a minute before it expires, or until PayPal refuses it.
export async function getAccessToken(): Promise<string> {
  if (token && Date.now() < token.expiresAt) return token.value;

  const { PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET } = env();
  const basic = Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`).toString("base64");
  const res = await fetch(`${PAYPAL_API_BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
    signal: AbortSignal.timeout(PAYPAL_TIMEOUT_MS),
    cache: "no-store",
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new PayPalError(
      `Could not get a PayPal sandbox token: ${body.error_description ?? res.statusText}`,
      res.status,
    );
  }
  token = { value: body.access_token, expiresAt: Date.now() + (body.expires_in - 60) * 1000 };
  return token.value;
}

function base64url(value: string): string {
  return Buffer.from(value).toString("base64url");
}

/** The act-for-seller assertion (unsigned JWT): names fipa's client id and the account the call is made for. */
export function authAssertion(merchantId: string): string {
  const { PAYPAL_CLIENT_ID } = env();
  return `${base64url(JSON.stringify({ alg: "none" }))}.${base64url(JSON.stringify({ iss: PAYPAL_CLIENT_ID, payer_id: merchantId }))}.`;
}

/**
 * The one place a PayPal request is made and its headers are built. Lint lets only src/lib/paypal/send.ts import it (D12);
 * everything else uses paypalRead. A 401 means the cached token is no longer good: it is dropped and the call is made once
 * more with a fresh one (safe to repeat: a call that makes or takes money carries its own PayPal-Request-Id).
 */
export async function paypalRequest(req: PayPalRequest, signal?: AbortSignal): Promise<unknown> {
  try {
    return await paypalRequestOnce(req, signal);
  } catch (error) {
    if (!(error instanceof RefusedToken)) throw error;
    dropAccessToken(error.token);
    try {
      return await paypalRequestOnce(req, signal);
    } catch (again) {
      if (again instanceof RefusedToken) {
        dropAccessToken(again.token);
        throw again.error;
      }
      throw again;
    }
  }
}

/** A 401 answer, carrying the token PayPal refused so only that one is dropped. */
class RefusedToken extends Error {
  constructor(readonly token: string, readonly error: PayPalError) { super(error.message); }
}

async function paypalRequestOnce(req: PayPalRequest, signal?: AbortSignal): Promise<unknown> {
  const accessToken = await getAccessToken();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    "PayPal-Partner-Attribution-Id": env().PAYPAL_PARTNER_ATTRIBUTION_ID,
  };
  if (req.requestId) headers["PayPal-Request-Id"] = req.requestId;
  if (req.actAs) headers["PayPal-Auth-Assertion"] = authAssertion(req.actAs);
  const timeout = AbortSignal.timeout(PAYPAL_TIMEOUT_MS);
  const payload = req.bodyText ?? (req.body !== undefined ? JSON.stringify(req.body) : undefined);
  const res = await fetch(`${PAYPAL_API_BASE}${req.path}`, {
    method: req.method,
    headers,
    ...(payload !== undefined && { body: payload }),
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    cache: "no-store",
  });
  const text = await res.text();
  let body: { message?: string; debug_id?: string; details?: { issue?: string }[] } | undefined;
  try { body = text ? JSON.parse(text) : undefined; } catch { body = undefined; }
  if (!res.ok) {
    const error = new PayPalError(
      body?.message ?? `PayPal ${req.method} ${req.path} failed`,
      res.status,
      body?.debug_id,
      body?.details,
      body?.details?.[0]?.issue,
    );
    if (res.status === 401) throw new RefusedToken(accessToken, error);
    throw error;
  }
  return body;
}

// The calls paypalRead may make: the reads the app makes and the posts that move no money. A path is matched whole, each
// id segment only letters, digits, "_" and "-", so no "..", "." or encoded segment can turn it into another endpoint.
const SEGMENT = "[A-Za-z0-9_-]+";
const QUERY = "(\\?[A-Za-z0-9_.,:%=&+-]*)?";
const READS: { method: PayPalRequest["method"]; path: RegExp }[] = [
  // Where an order stands (the link's Pay).
  { method: "GET", path: new RegExp(`^/v2/checkout/orders/${SEGMENT}$`) },
  // The connected household's balance and payments received (the PayPal read).
  { method: "GET", path: new RegExp(`^/v1/reporting/balances${QUERY}$`) },
  { method: "GET", path: new RegExp(`^/v1/reporting/transactions${QUERY}$`) },
  // Who signed up under a tracking id, and that account's status (Connect PayPal).
  { method: "GET", path: new RegExp(`^/v1/customer/partners/${SEGMENT}/merchant-integrations${QUERY}$`) },
  { method: "GET", path: new RegExp(`^/v1/customer/partners/${SEGMENT}/merchant-integrations/${SEGMENT}$`) },
  // The sign-up link for Connect PayPal.
  { method: "POST", path: /^\/v2\/customer\/partner-referrals$/ },
  // A webhook delivery's signature check.
  { method: "POST", path: /^\/v1\/notifications\/verify-webhook-signature$/ },
  // The owner's script that registers the webhook endpoint, and its lookup.
  { method: "POST", path: /^\/v1\/notifications\/webhooks$/ },
  { method: "GET", path: /^\/v1\/notifications\/webhooks$/ },
];

/** Whether paypalRead may make this call. Anything not on the list is refused, so no read can make or take a payment. */
export const isReadCall = (req: Pick<PayPalRequest, "method" | "path">) =>
  READS.some(allowed => allowed.method === req.method && allowed.path.test(req.path));

/** A PayPal call that cannot make or take a payment: only the calls on the list above get through. */
export const paypalRead: PayPalCall = async (req, signal) => {
  if (!isReadCall(req)) throw new PayPalError(`A read-only PayPal call cannot make ${req.method} ${req.path.split("?")[0]}`);
  return paypalRequest(req, signal);
};
