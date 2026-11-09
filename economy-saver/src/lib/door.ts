// Shared by the route handlers under src/app/api: the no-store header, redirects and plain-text answers,
// the return-target check and the typed-in-data failure and bad-fields responses.
import { InputError } from "@/db/input-error";
import { StatementChargeError } from "@/db/statement-charge";
import { FORM_REDIRECT_HEADER, postedByForm } from "./form-fetch";

export const NO_STORE = { "Cache-Control": "private, no-store" };

export const BAD_FIELDS = "Check the required fields and try again.";

/**
 * Where a successful post goes next. A native post gets the 303 redirect. A post made by `ApiForm` (pass the request) gets
 * 204 with the destination in a header, so the page can navigate without fetching the destination twice.
 */
export function redirectTo(location: string, request?: Request) {
  if (request && postedByForm(request)) return new Response(null, { status: 204, headers: { [FORM_REDIRECT_HEADER]: location, ...NO_STORE } });
  return new Response(null, { status: 303, headers: { Location: location, ...NO_STORE } });
}

/** A plain-text answer that is never cached; `headers` adds to the no-store header (for example Retry-After). */
export function text(message: string, status: number, headers: Record<string, string> = {}) {
  return new Response(message, { status, headers: { ...NO_STORE, ...headers } });
}

/** The answer to a request over its rate limit: 429 with the message and a one-minute Retry-After. */
export function tooMany(message: string) {
  return text(message, 429, { "Retry-After": "60" });
}

/** Only the pages that offer a form are valid return targets. */
export function returnPath(value: FormDataEntryValue | null) {
  return value === "/to-check" || value === "/plan" || value === "/settings" || value === "/memory" || value === "/canvas" || (typeof value === "string" && /^\/(?:cards\/|canvas\?space=)[0-9a-f-]{36}$/.test(value)) ? String(value) : "/";
}

/** Plain-text failure: a request problem is 400 with its user-facing message, anything else is 503 with no detail. */
export function failure(error: unknown) {
  if (error instanceof InputError || error instanceof StatementChargeError) return text(error.message, 400);
  return text("This could not be saved. Try again.", 503);
}

export function badFields() {
  return text(BAD_FIELDS, 400);
}

/** The posted form, or the bad-fields answer when the body is not a form (JSON, broken multipart, nothing): `formData()` throws there, which used to surface as an empty 500. */
export async function formOf(request: Request): Promise<FormData | Response> {
  try {
    return await request.formData();
  } catch {
    return badFields();
  }
}

export function formText(form: FormData, name: string) {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

// Reads at most `limit` bytes whatever Content-Length says (a chunked body has none), then parses the form.
export async function boundedForm(request: Request, limit: number): Promise<FormData | null> {
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
  try {
    return await new Response(body, { headers: { "content-type": request.headers.get("content-type") ?? "" } }).formData();
  } catch { return new FormData(); }
}
