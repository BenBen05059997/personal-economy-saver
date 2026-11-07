// The one content-free log line per request (D50): `at: "request"`, the Cloudflare ray id (null off Cloudflare), the method,
// the route pattern (ids replaced, no query), the household id when the request resolved one from its session, the HTTP
// status and the duration. Never a body, a query string, a cookie, an address, a user agent or any content.
// `worker.ts` wraps the app's fetch in `logged`, the one place that sees the real status and duration; the session helper
// reports the household through `noteHousehold`. Relative imports only: wrangler bundles this file for the Worker.
import { AsyncLocalStorage } from "node:async_hooks";

type Seen = { householdId: string | null };
const seen = new AsyncLocalStorage<Seen>();

/** Called when a request's session resolves to a household. A no-op outside a logged request. */
export function noteHousehold(householdId: string): void {
  const store = seen.getStore();
  if (store) store.householdId = householdId;
}

/** `/cards/<uuid>` becomes `/cards/:id`; the query string is never read. */
export function routePattern(pathname: string): string {
  return pathname.replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\/|$)/gi, "/:id").replace(/\/\d+(?=\/|$)/g, "/:id");
}

const SKIPPED = /^\/(_next\/|fonts\/|favicon\.ico$)/;

type RequestLog = { at: "request"; ray: string | null; method: string; route: string; householdId: string | null; status: number; ms: number };

export function logRequest(entry: RequestLog): void {
  console.info(JSON.stringify(entry));
}

/** Runs the app's handler and writes its line; a handler that throws is logged as 500 and rethrown. */
export async function logged(request: Request, run: () => Promise<Response>): Promise<Response> {
  const route = routePattern(new URL(request.url).pathname);
  if (SKIPPED.test(route)) return run();
  const store: Seen = { householdId: null };
  const started = Date.now();
  const line = (status: number) => logRequest({ at: "request", ray: request.headers.get("cf-ray"), method: request.method, route,
    householdId: store.householdId, status, ms: Date.now() - started });
  try {
    const response = await seen.run(store, run);
    line(response.status);
    return response;
  } catch (error) {
    line(500);
    throw error;
  }
}
