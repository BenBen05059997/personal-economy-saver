// The one content-free log line per request (D50): `at: "request"`, the Cloudflare ray id (null off Cloudflare), the method,
// the route pattern (ids replaced, no query), the household id when the request resolved one from its session, the HTTP
// status, duration and aggregate database timings. Never a body, query text, parameters, results, cookie or address.
// `worker.ts` wraps the app's fetch in `logged`, the one place that sees the real status and duration; the session helper
// reports the household through `noteHousehold`. Relative imports only: wrangler bundles this file for the Worker.
import { AsyncLocalStorage } from "node:async_hooks";
import { subscribe } from "node:diagnostics_channel";

type Span = { start: number; end: number };
type Seen = {
  householdId: string | null;
  connectMs: number[];
  connectFailures: number;
  sqlCommands: number;
  sqlMs: number;
  spans: Span[];
};
const seen = new AsyncLocalStorage<Seen>();
let subscribed = false;

function subscribeToPostgres() {
  if (subscribed) return;
  subscribed = true;

  // Keep only the originating request and a timestamp. A pooled connection may finish work in a different async context.
  function track(operation: "connect" | "query", finish: (store: Seen, start: number, event: object) => void) {
    const pending = new WeakMap<object, { store: Seen; start: number }>();
    subscribe(`tracing:postgres:${operation}:start`, event => {
      const store = seen.getStore();
      if (store && event && typeof event === "object") pending.set(event, { store, start: performance.now() });
    });
    subscribe(`tracing:postgres:${operation}:asyncEnd`, event => {
      if (!event || typeof event !== "object") return;
      const origin = pending.get(event);
      if (!origin) return;
      pending.delete(event);
      finish(origin.store, origin.start, event);
    });
  }

  track("connect", (store, start, event) => {
    const end = performance.now();
    store.spans.push({ start, end });
    if ("error" in event) store.connectFailures++;
    else store.connectMs.push(Math.round(end - start));
  });
  track("query", (store, _start, event) => {
    if (!("sent" in event) || typeof event.sent !== "number" || !("complete" in event) || typeof event.complete !== "number") return;
    store.sqlCommands++;
    store.sqlMs += event.complete - event.sent;
    store.spans.push({ start: event.sent, end: event.complete });
  });
}

function databaseTimings(store: Seen, requestStart: number) {
  // SQL time is a sum. Busy time counts overlap only once, across both SQL and connection setup.
  const spans = store.spans.sort((a, b) => a.start - b.start);
  let busyMs = 0;
  let lastEnd = requestStart;
  for (const { start, end } of spans) {
    busyMs += Math.max(0, end - Math.max(start, lastEnd));
    lastEnd = Math.max(lastEnd, end);
  }
  return {
    connections: store.connectMs.length, connectMs: store.connectMs, connectFailures: store.connectFailures,
    sqlCommands: store.sqlCommands, sqlMs: Math.round(store.sqlMs), busyMs: Math.round(busyMs),
    firstMs: spans.length ? Math.round(spans[0].start - requestStart) : null,
    lastMs: spans.length ? Math.round(lastEnd - requestStart) : null,
  };
}

/** Called when a request's session resolves to a household. A no-op outside a logged request. */
export function noteHousehold(householdId: string): void {
  const store = seen.getStore();
  if (store) store.householdId = householdId;
}

/** `/cards/<uuid>` becomes `/cards/:id`; the query string is never read. */
export function routePattern(pathname: string): string {
  // Shared link tokens are bearer credentials, even if the rest of the URL is malformed.
  const link = /^\/(join|family)\/.+/i.exec(pathname);
  if (link) return `/${link[1].toLowerCase()}/:token`;
  return pathname.replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\/|$)/gi, "/:id").replace(/\/\d+(?=\/|$)/g, "/:id");
}

const SKIPPED = /^\/(_next\/|fonts\/|favicon\.ico$)/;

type RequestLog = {
  at: "request"; ray: string | null; method: string; route: string; householdId: string | null; status: number; ms: number;
  db: ReturnType<typeof databaseTimings>;
};

function logRequest(entry: RequestLog): void {
  console.info(JSON.stringify(entry));
}

function startRequestLog(method: string, pathname: string, ray: string | null) {
  if (SKIPPED.test(pathname)) return;
  const started = performance.now();
  const route = routePattern(pathname);
  const store: Seen = { householdId: null, connectMs: [], connectFailures: 0, sqlCommands: 0, sqlMs: 0, spans: [] };
  let finished = false;
  subscribeToPostgres();
  return {
    run<T>(run: () => T): T { return seen.run(store, run); },
    finish(status: number) {
      if (finished) return;
      finished = true;
      logRequest({ at: "request", ray, method, route, householdId: store.householdId, status,
        ms: Math.round(performance.now() - started), db: databaseTimings(store, started) });
    },
  };
}

/** Log through the end of the response body so streamed pages include their last database phase. */
export async function logged(request: Request, run: () => Promise<Response>): Promise<Response> {
  const log = startRequestLog(request.method, new URL(request.url).pathname, request.headers.get("cf-ray"));
  if (!log) return run();
  try {
    const response = await log.run(run);
    if (!response.body) {
      log.finish(response.status);
      return response;
    }
    const reader = response.body.getReader();
    return new Response(new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const chunk = await log.run(() => reader.read());
          if (!chunk.done) { controller.enqueue(chunk.value); return; }
          log.finish(response.status);
          controller.close();
        } catch (error) {
          log.finish(response.status);
          controller.error(error);
        }
      },
      cancel(reason) {
        log.finish(response.status);
        return log.run(() => reader.cancel(reason));
      },
    }), response);
  } catch (error) {
    log.finish(500);
    throw error;
  }
}
