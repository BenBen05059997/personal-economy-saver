import { and, eq, sql } from "drizzle-orm";
import { requireHousehold, type Db } from "./household";
import { ipBuckets, requestBuckets } from "./schema";

/** The length of a counting window: a minute (the default) or an hour (the sign-in link limit). */
type Window = "minute" | "hour";

export async function consumeRequest(db: Db, hid: string, purpose: "ask" | "mcp" | "draft" | "approve" | "import" | "statement-import" | "export" | "people" | "settle" | "remove" | "family-links" | "canvas" | "ai-model" | "thumb" | "pins" | "data" | "restore" | "move" | "suggestions" | "reminders" | "rules", limit = 30, per: Window = "minute") {
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

export async function consumeIpRequest(db: Db, ip: string, purpose: "magic-link", limit: number, per: Window = "hour") {
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
