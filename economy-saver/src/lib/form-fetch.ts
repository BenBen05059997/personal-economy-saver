import { NextResponse } from "next/server";

// The no-store header every answer that carries a person's data sends, and the two headers between a form that posts with fetch (components/ui/ApiForm) and the route it posts to. A native post
// (no JavaScript) sends neither, and the route answers it with a 303 redirect as ever. A fetch sends the first, and a
// route that would redirect returns the destination in the second, usually with status 204. A brief save also returns
// its confirmed record. The form shows refusals inline and navigates to the destination when it accepts.

export const FORM_FETCH_HEADER = "x-form-fetch";
export const FORM_REDIRECT_HEADER = "x-form-redirect";

export const NO_STORE = { "Cache-Control": "private, no-store" };

/** Puts the no-store header on a response made elsewhere (a guard's refusal) and returns it. */
export function noStore<T extends Response>(response: T): T {
  response.headers.set("Cache-Control", NO_STORE["Cache-Control"]);
  return response;
}

export const postedByForm = (request: Request) => request.headers.get(FORM_FETCH_HEADER) === "1";

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

/** The body of a request read up to `limit` bytes whatever Content-Length says (a chunked body has none); null when the body is longer. */
export async function readBounded(request: Request, limit: number): Promise<Uint8Array | null> {
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

