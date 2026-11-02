import { env, PAYPAL_API_BASE } from "@/lib/env";

export class PayPalError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly debugId?: string,
    readonly details?: unknown,
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
    signal: AbortSignal.timeout(8000),
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

// Plain REST call for the endpoints the Agent Toolkit does not cover (balances, webhooks).
export async function paypalFetch<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const accessToken = await getAccessToken();
  const res = await fetch(`${PAYPAL_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
    cache: "no-store",
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    throw new PayPalError(
      body?.message ?? `PayPal ${init.method ?? "GET"} ${path} failed`,
      res.status,
      body?.debug_id,
      body?.details,
    );
  }
  return body as T;
}
