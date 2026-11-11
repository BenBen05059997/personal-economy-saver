import { and, eq, sql } from "drizzle-orm";
import { requireHousehold, withHousehold, type Db } from "./household";
import { ipBuckets, requestBuckets } from "./schema";

/** The length of a counting window: a minute (the default) or an hour (the sign-in link limit). */
type Window = "minute" | "hour";

export async function consumeRequest(db: Db, hid: string, purpose: "ask" | "mcp" | "draft" | "approve" | "statement-import" | "export" | "people" | "settle" | "remove" | "family-links" | "canvas" | "ai-model" | "ai-model-list" | "thumb" | "pins" | "data" | "restore" | "move" | "suggestions" | "reminders" | "rules" | "invites" | "spaces" | "own-categories" | "mcp-tokens" | "add-view" | "paypal-connect" | "offered" | "invoice-paid" | "invoice-match", limit = 30, per: Window = "minute") {
  const window = sql`date_trunc(${sql.raw(`'${per}'`)}, now())`;
  const sameWindow = sql`${requestBuckets.window} = ${window}`;
  const rows = await db.insert(requestBuckets).values({ householdId: requireHousehold(hid), purpose, window, count: 1 })
    .onConflictDoUpdate({
      target: [requestBuckets.householdId, requestBuckets.purpose],
      set: { window, count: sql`case when ${sameWindow} then ${requestBuckets.count} + 1 else 1 end` },
      setWhere: sql`not (${sameWindow}) or ${requestBuckets.count} < ${limit}`,
    }).returning({ count: requestBuckets.count });
  return rows.length === 1;
}

/** The answer to a request over its rate limit: 429 with the message, a one-minute Retry-After and no caching. */
export function tooMany(message: string) {
  return new Response(message, { status: 429, headers: { "Cache-Control": "private, no-store", "Retry-After": "60" } });
}

/** Spends one request of a purpose for this household. Null when there is room; otherwise the 429 to return, with `message`. */
export async function limited(connection: Db, hid: string, purpose: Parameters<typeof consumeRequest>[2], limit: number | undefined, message: string): Promise<Response | null> {
  return await withHousehold(connection, hid, tx => consumeRequest(tx, hid, purpose, limit)) ? null : tooMany(message);
}

/** Sliders and Ask view loads share one canvas request limit. */
export function consumeCanvasRequest(db: Db, householdId: string) {
  return consumeRequest(db, householdId, "canvas", 120);
}

/** How many requests of one purpose this window has used, without spending one. */
export async function requestCount(db: Db, hid: string, purpose: string, per: Window = "minute"): Promise<number> {
  const [row] = await db.select({ count: requestBuckets.count }).from(requestBuckets)
    .where(and(eq(requestBuckets.householdId, requireHousehold(hid)), eq(requestBuckets.purpose, purpose), sql`${requestBuckets.window} = date_trunc(${sql.raw(`'${per}'`)}, now())`));
  return row?.count ?? 0;
}

// ---------------------------------------------------------------- per-client limits before a household exists (27E)

/** Thrown when a request cannot be counted by client address. `status` is the response to send. */
export class ClientIpError extends Error {
  constructor(message: string, readonly status: 400 | 503) { super(message); }
}

/**
 * The client address of this request, from the header named by CLIENT_IP_HEADER (cf-connecting-ip on the Worker, x-forwarded-for
 * under `next dev`). A forwarded list gives its first entry. A missing setting or a request without the header is refused.
 */
export function clientIp(request: Request): string {
  const name = process.env.CLIENT_IP_HEADER?.trim().toLowerCase();
  if (!name) throw new ClientIpError("CLIENT_IP_HEADER is not set", 503);
  const value = request.headers.get(name)?.split(",")[0]?.trim();
  if (!value) throw new ClientIpError(`This request has no ${name} header, so it can't be counted. Check CLIENT_IP_HEADER.`, 400);
  return value;
}

/** SHA-256 of the address with a fixed prefix; the address itself is never stored. */
export async function hashIp(ip: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("pes-ip-v1:" + ip));
  return Buffer.from(digest).toString("hex");
}

/** Spends one request of a purpose for one client address in the current window; false when the limit is reached. */

export async function consumeIpRequest(db: Db, ip: string, purpose: "magic-link" | "webhook" | "pay", limit: number, per: Window = "hour") {
  const ipHash = await hashIp(ip);
  const window = sql`date_trunc(${sql.raw(`'${per}'`)}, now())`;
  const sameWindow = sql`${ipBuckets.window} = ${window}`;
  const rows = await db.insert(ipBuckets).values({ ipHash, purpose, window, count: 1 })
    .onConflictDoUpdate({
      target: [ipBuckets.ipHash, ipBuckets.purpose],
      set: { window, count: sql`case when ${sameWindow} then ${ipBuckets.count} + 1 else 1 end` },
      setWhere: sql`not (${sameWindow}) or ${ipBuckets.count} < ${limit}`,
    }).returning({ count: ipBuckets.count });
  return rows.length === 1;
}

/** Removes per-address windows more than a day old (the daily job). Returns how many went. */
export async function pruneIpBuckets(db: Db): Promise<number> {
  const gone = await db.delete(ipBuckets).where(sql`${ipBuckets.window} < now() - interval '1 day'`).returning({ h: ipBuckets.ipHash });
  return gone.length;
}
