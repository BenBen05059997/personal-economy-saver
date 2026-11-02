import { sql } from "drizzle-orm";
import { requireHousehold, type Db } from "./household";
import { requestBuckets } from "./schema";

export async function consumeRequest(db: Db, hid: string, purpose: "ask" | "mcp" | "reader" | "upload", limit = 30) {
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
