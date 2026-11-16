// Shared by the route handlers under src/app/api: the no-store header, redirects and plain-text answers,
// the return-target check and the typed-in-data failure and bad-fields responses.
import { timingSafeEqual } from "node:crypto";
import { AiKeyError } from "@/db/ai-key";
import { db, MissingDatabaseUrl } from "@/db/client";
import { type Db } from "@/db/household";
import { InputError } from "@/db/input-error";
import { clientIp, ClientIpError, consumeIpRequest, limited as rateLimited, tooMany } from "@/db/rate-limit";
import { StatementChargeError } from "@/db/statement-charge";
import { businessBpFromForm, CategoryKeySchema } from "@/lib/money/categories";
import { ownChoiceFromForm } from "@/lib/reader/own-choices";
import { ReaderError } from "@/lib/reader/settings";
import { NO_STORE, readBounded } from "./form-fetch";
import { householdRequest, ownerRequest, SAME_ORIGIN_REQUIRED, sameOrigin } from "./session";

export const NO_REFERRER = { noReferrer: true } as const;

export const SIGN_IN_TO_CONTINUE = "Sign in to continue.";
export const DEMO_SESSION_REQUIRED = "Demo session required";
export const TOO_MANY_REQUESTS = "Too many requests. Try again in a minute.";
export const TOO_MANY_CHANGES = "Too many changes. Try again in a minute.";
export const TOO_MANY_TRIES = "Too many tries. Try again in a minute.";
export const TOO_MANY_CANVAS_REQUESTS = "Too many canvas requests. Try again in a minute.";

export const BAD_FIELDS = "Check the required fields and try again.";

/** A plain-text answer that is never cached; `headers` adds to the no-store header (for example Retry-After). */
export function text(message: string, status: number, headers: Record<string, string> = {}) {
  return new Response(message, { status, headers: { ...NO_STORE, ...headers } });
}

export { tooMany };

/** The 503 for a server with no database setting (its message names the variable), or null for any other error. */
export function missingDatabase(error: unknown): Response | null {
  return error instanceof MissingDatabaseUrl ? text(error.message, 503) : null;
}

/** The per-address limit of a door with no household (the sign-in link, the pay page, the webhook): null when there is room, else the 429 to return; an address that can't be counted or a missing database is answered as such. `connection` is for the caller that already holds the handle. */
export async function ipLimited(request: Request, purpose: Parameters<typeof consumeIpRequest>[2], limit: number, per: Parameters<typeof consumeIpRequest>[4], message: string, connection?: Db): Promise<Response | null> {
  try {
    return await consumeIpRequest(connection ?? db(), clientIp(request), purpose, limit, per) ? null : tooMany(message);
  } catch (error) {
    if (error instanceof ClientIpError) return text(error.message, error.status);
    const missing = missingDatabase(error);
    if (missing) return missing;
    throw error;
  }
}

const RETURN_PAGES = new Set(["/", "/to-check", "/bills", "/cards", "/clients", "/spending", "/spending/over-time", "/spending/categories", "/saving", "/memory", "/canvas", "/household", "/household/people", "/settings", "/settings/ai-model", "/settings/paypal", "/settings/data", "/settings/account", "/options", "/upload"]);
const RETURN_PATTERNS = [/^\/(?:bills|cards|clients|saving)\/[0-9a-f-]{36}$/, /^\/canvas\?space=[0-9a-f-]{36}$/, /^\/setup\?step=(?:bank|income|bills|card)$/, /^\/to-check\?saved=(?:bill|charge):[0-9a-f-]{36}$/];

/** Only a fixed list of app pages is a valid return target; anything else goes Home. */
export function returnPath(value: FormDataEntryValue | null) {
  return typeof value === "string" && (RETURN_PAGES.has(value) || RETURN_PATTERNS.some((pattern) => pattern.test(value))) ? value : "/";
}

/** Plain-text failure: a request problem is 400 with its user-facing message, anything else is 503 with no detail. */
export function failure(error: unknown) {
  if (error instanceof InputError || error instanceof StatementChargeError) return text(error.message, 400);
  return text("This could not be saved. Try again.", 503);
}

/** True when `header` is exactly `Bearer <secret>`, compared in constant time. */
export function bearerMatches(header: string, secret: string): boolean {
  const expected = Buffer.from(`Bearer ${secret}`);
  const supplied = Buffer.from(header);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

/** The 503 for a failed write that may be the household's AI key or the reader's setting (their messages are for the person) and otherwise says `fallback`. */
export function settingFailure(error: unknown, fallback: string) {
  return text(error instanceof AiKeyError || error instanceof ReaderError ? error.message : fallback, 503);
}

export function badFields() {
  return text(BAD_FIELDS, 400);
}

/** The guard for routes with no household yet (sign-in, setup): null when the request is same-origin, else the 403 to return. */
export function sameOriginOnly(request: Request, message = SAME_ORIGIN_REQUIRED): Response | null {
  return sameOrigin(request) ? null : text(message, 403);
}

/** `limited` (db/rate-limit) on the request's own database handle: null when there is room, else the 429 to return. `connection` is for the caller that already holds the handle. */
export function limited(hid: string, purpose: Parameters<typeof rateLimited>[2], limit: number | undefined, message: string, connection: Db = db()) {
  return rateLimited(connection, hid, purpose, limit, message);
}

/** The most any form post may carry. The largest real form (a bill with its notes) is a few KB; a CSV statement import is JSON, not a form. */
export const MAX_FORM_BYTES = 256 * 1024;

/** The posted form, or the bad-fields answer when the body is not a form (JSON, broken multipart, nothing): `formData()` throws there. A body over `MAX_FORM_BYTES` is a 413 whatever Content-Length says. */
export async function formOf(request: Request): Promise<FormData | Response> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_FORM_BYTES) return text("That form is too large.", 413);
  const body = await readBounded(request, MAX_FORM_BYTES);
  if (!body) return text("That form is too large.", 413);
  try {
    return await asForm(body, request);
  } catch {
    return badFields();
  }
}

/** The guard and the posted form of a household route: `{ hid, form }`, or the 403/401/400/413 response to return as is. */
export async function householdForm(request: Request): Promise<{ hid: string; form: FormData } | Response> {
  const hid = await householdRequest(request);
  if (hid instanceof Response) return hid;
  const form = await formOf(request);
  return form instanceof Response ? form : { hid, form };
}

/** `householdForm` for an owner-only route. */
export async function ownerForm(request: Request): Promise<{ hid: string; form: FormData } | Response> {
  const hid = await ownerRequest(request);
  if (hid instanceof Response) return hid;
  const form = await formOf(request);
  return form instanceof Response ? form : { hid, form };
}

/** The category, business share and own category a bill or charge form carries, or the 400 for the first one that is wrong. */
export function categoryFieldsFromForm(form: FormData) {
  const category = CategoryKeySchema.safeParse(form.get("category"));
  if (!category.success) return text(category.error.issues[0].message, 400);
  const businessBp = businessBpFromForm(form.get("businessShare"), form.get("businessPercent"));
  if (businessBp === null) return text("Enter the business share as a percentage from 0 to 100.", 400);
  return { category: category.data, businessBp, ...ownChoiceFromForm(form) };
}

export function formText(form: FormData, name: string) {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

/** The body as text, or null when it is longer than `limit` bytes (a chunked body has no Content-Length to check). */
export async function boundedText(request: Request, limit: number): Promise<string | null> {
  const body = await readBounded(request, limit);
  return body ? new TextDecoder().decode(body) : null;
}

const asForm = (body: Uint8Array, request: Request) => new Response(body as BodyInit, { headers: { "content-type": request.headers.get("content-type") ?? "" } }).formData();

// Reads at most `limit` bytes, then parses the form: null over the limit, an empty form when it does not parse.
export async function boundedForm(request: Request, limit: number): Promise<FormData | null> {
  const body = await readBounded(request, limit);
  if (!body) return null;
  try { return await asForm(body, request); } catch { return new FormData(); }
}
