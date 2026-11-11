// Shared by the route handlers under src/app/api: the no-store header, redirects and plain-text answers,
// the return-target check and the typed-in-data failure and bad-fields responses.
import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { type Db } from "@/db/household";
import { InputError } from "@/db/input-error";
import { limited as rateLimited } from "@/db/rate-limit";
import { StatementChargeError } from "@/db/statement-charge";
import { businessBpFromForm, CategoryKeySchema } from "@/lib/money/categories";
import { ownChoiceFromForm } from "@/lib/reader/own-choices";
import { FORM_REDIRECT_HEADER, postedByForm } from "./form-fetch";
import { householdRequest, ownerRequest, sameOrigin } from "./session";

export const NO_REFERRER = { noReferrer: true } as const;

export const NO_STORE = { "Cache-Control": "private, no-store" };

export const BAD_FIELDS = "Check the required fields and try again.";

/**
 * Where a successful post goes next. A native post gets the 303 redirect. A post made by `ApiForm` (pass the request) gets
 * 204 with the destination in a header, so the page can navigate without fetching the destination twice. `noReferrer`
 * (the sign-in and account doors) adds `Referrer-Policy: no-referrer`.
 */
export function redirectTo(location: string, request?: Request, options: { noReferrer?: boolean } = {}) {
  const headers: Record<string, string> = { ...NO_STORE, ...(options.noReferrer ? { "Referrer-Policy": "no-referrer" } : {}) };
  if (request && postedByForm(request)) return new NextResponse(null, { status: 204, headers: { ...headers, [FORM_REDIRECT_HEADER]: location } });
  return new NextResponse(null, { status: 303, headers: { ...headers, Location: location } });
}

/** A plain-text answer that is never cached; `headers` adds to the no-store header (for example Retry-After). */
export function text(message: string, status: number, headers: Record<string, string> = {}) {
  return new Response(message, { status, headers: { ...NO_STORE, ...headers } });
}

export { tooMany } from "@/db/rate-limit";

const RETURN_PAGES = new Set(["/", "/to-check", "/activity", "/bills", "/cards", "/clients", "/plan", "/memory", "/canvas", "/household", "/household/people", "/settings", "/settings/ai-model", "/settings/paypal", "/settings/data", "/settings/account", "/options", "/upload"]);
const RETURN_PATTERNS = [/^\/(?:bills|cards|clients)\/[0-9a-f-]{36}$/, /^\/canvas\?space=[0-9a-f-]{36}$/, /^\/setup\?step=(?:bank|income|bills|card)$/];

/** Only a fixed list of app pages is a valid return target; anything else goes Home. */
export function returnPath(value: FormDataEntryValue | null) {
  return typeof value === "string" && (RETURN_PAGES.has(value) || RETURN_PATTERNS.some((pattern) => pattern.test(value))) ? value : "/";
}

/** Plain-text failure: a request problem is 400 with its user-facing message, anything else is 503 with no detail. */
export function failure(error: unknown) {
  if (error instanceof InputError || error instanceof StatementChargeError) return text(error.message, 400);
  return text("This could not be saved. Try again.", 503);
}

export function badFields() {
  return text(BAD_FIELDS, 400);
}

/** The guard for routes with no household yet (sign-in, setup): null when the request is same-origin, else the 403 to return. */
export function sameOriginOnly(request: Request, message = "Same-origin request required"): Response | null {
  return sameOrigin(request) ? null : text(message, 403);
}

/** `limited` (db/rate-limit) on the request's own database handle: null when there is room, else the 429 to return. `connection` is for the caller that already holds the handle. */
export function limited(hid: string, purpose: Parameters<typeof rateLimited>[2], limit: number | undefined, message: string, connection: Db = db()) {
  return rateLimited(connection, hid, purpose, limit, message);
}

/** The most any form post may carry. The largest real form (a bill with its notes) is a few KB; a CSV statement import is JSON, not a form. */
export const MAX_FORM_BYTES = 256 * 1024;

/** The posted form, or the bad-fields answer when the body is not a form (JSON, broken multipart, nothing): `formData()` throws there, which used to surface as an empty 500. A body over `MAX_FORM_BYTES` is a 413 whatever Content-Length says. */
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

// Reads at most `limit` bytes whatever Content-Length says (a chunked body has none); null when the body is longer.
async function readBounded(request: Request, limit: number): Promise<Uint8Array | null> {
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (reader) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    body.set(chunk, at);
    at += chunk.byteLength;
  }
  return body;
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
