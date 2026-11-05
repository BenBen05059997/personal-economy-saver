import { sql } from "drizzle-orm";
import { requireHousehold, type Db } from "./household";
import { households, requestBuckets } from "./schema";

export async function consumeRequest(db: Db, hid: string, purpose: "ask" | "mcp" | "reader" | "upload" | "draft" | "approve" | "import" | "export" | "people" | "settle" | "remove" | "family-links", limit = 30) {
  const window = sql`date_trunc('minute', now())`;
  const sameWindow = sql`${requestBuckets.window} = ${window}`;
  const rows = await db.insert(requestBuckets).values({ householdId: requireHousehold(hid), purpose, window, count: 1 })
    .onConflictDoUpdate({
      target: [requestBuckets.householdId, requestBuckets.purpose],
      set: { window, count: sql`case when ${sameWindow} then ${requestBuckets.count} + 1 else 1 end` },
      setWhere: sql`not (${sameWindow}) or ${requestBuckets.count} < ${limit}`,
    }).returning({ count: requestBuckets.count });
  return rows.length === 1;
}

// Try it has no household yet, so it is capped across the whole app: demo households made in the last hour.
export async function demoCreationAllowed(db: Db, perHour = 60) {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(households)
    .where(sql`${households.isDemo} and ${households.createdAt} > now() - interval '1 hour'`);
  return row.n < perHour;
}
