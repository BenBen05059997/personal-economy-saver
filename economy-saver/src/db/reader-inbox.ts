import { and, desc, eq, inArray } from "drizzle-orm";
import { type Db, requireHousehold } from "./household";
import { documents, readings } from "./schema";
import { extractSchema } from "@/lib/reader/extract";

export async function readerInbox(db: Db, id: string) {
  const hid = requireHousehold(id);
  const [pending, jobs] = await Promise.all([
    db.select({ id: readings.id, data: readings.extracted }).from(readings)
      .where(and(eq(readings.householdId, hid), eq(readings.status, "to_check"))).orderBy(desc(readings.createdAt)),
    db.select({ id: documents.id, status: documents.status, error: documents.error, processingAt: documents.processingAt, createdAt: documents.createdAt }).from(documents)
      .where(and(eq(documents.householdId, hid), inArray(documents.status, ["queued", "reading", "failed"]))).orderBy(desc(documents.createdAt)),
  ]);
  return {
    readings: pending.map(row => ({ id: row.id, value: extractSchema.parse((row.data as { proposed: unknown }).proposed) })),
    jobs: jobs.map(job => ({ id: job.id, status: job.status, error: job.error,
      retry: job.status === "failed" || Date.now() - (job.processingAt ?? job.createdAt).getTime() > 90_000 })),
  };
}
export type ReaderInbox = Awaited<ReturnType<typeof readerInbox>>;
