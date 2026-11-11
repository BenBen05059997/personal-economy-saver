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

// OAuth client-credentials token, cached until a minute before it expires.
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

/** The one place a PayPal request is made and its headers are built. */
export async function paypalRequest(req: PayPalRequest, signal?: AbortSignal): Promise<unknown> {
  const accessToken = await getAccessToken();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    "PayPal-Partner-Attribution-Id": env().PAYPAL_PARTNER_ATTRIBUTION_ID,
  };
  if (req.requestId) headers["PayPal-Request-Id"] = req.requestId;
  if (req.actAs) headers["PayPal-Auth-Assertion"] = authAssertion(req.actAs);
  const timeout = AbortSignal.timeout(PAYPAL_TIMEOUT_MS);
  const res = await fetch(`${PAYPAL_API_BASE}${req.path}`, {
    method: req.method,
    headers,
    ...(req.body !== undefined && { body: JSON.stringify(req.body) }),
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    cache: "no-store",
  });
  const text = await res.text();
  let body: { message?: string; debug_id?: string; details?: { issue?: string }[] } | undefined;
  try { body = text ? JSON.parse(text) : undefined; } catch { body = undefined; }
  if (!res.ok) {
    throw new PayPalError(
      body?.message ?? `PayPal ${req.method} ${req.path} failed`,
      res.status,
      body?.debug_id,
      body?.details,
      body?.details?.[0]?.issue,
    );
  }
  return body;
}

/** A PayPal call that cannot make or take a payment: any POST under /v2/checkout/ is refused. */
export const paypalRead: PayPalCall = async (req, signal) => {
  if (req.method === "POST" && req.path.startsWith("/v2/checkout/")) {
    throw new PayPalError("A read-only PayPal call cannot post to checkout");
  }
  return paypalRequest(req, signal);
};

// Plain REST call for webhook verification and webhook registration.
export async function paypalFetch<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const method = init.method === "POST" ? "POST" : "GET";
  const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
  return await paypalRequest({ method, path, body }, init.signal ?? undefined) as T;
}
