import { and, eq, sql } from "drizzle-orm";
import { requireHousehold, type Db } from "./household";
import { households, requestBuckets } from "./schema";

/** The length of a counting window: a minute (the default) or an hour (the out-of-scope limit, D60). */
export type Window = "minute" | "hour";

export async function consumeRequest(db: Db, hid: string, purpose: "ask" | "mcp" | "reader" | "upload" | "draft" | "approve" | "import" | "statement-import" | "export" | "people" | "settle" | "remove" | "family-links" | "canvas" | "ai-model" | "thumb" | "pins" | "data" | "restore" | "move" | "out-of-scope", limit = 30, per: Window = "minute") {
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

// Try it has no household yet, so it is capped across the whole app: demo households made in the last hour.
export async function demoCreationAllowed(db: Db, perHour = 60) {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(households)
    .where(sql`${households.isDemo} and ${households.createdAt} > now() - interval '1 hour'`);
  return row.n < perHour;
}
