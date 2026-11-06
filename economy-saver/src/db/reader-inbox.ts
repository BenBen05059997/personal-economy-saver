import { and, desc, eq, inArray } from "drizzle-orm";
import { type Db, requireHousehold } from "./household";
import { documents, readings } from "./schema";
import { extractSchema, type Extracted } from "@/lib/reader/extract";
import { previewLink } from "./bills";

/** D54: the series a one-off bill reading would join as read, for the review card's one line; null for anything else. */
const linkFor = (db: Db, hid: string, value: Extracted) =>
  value.kind === "bill" && value.repeat === null && value.name && value.category && value.date ? previewLink(db, hid, { biller: value.name, category: value.category, due: value.date }) : Promise.resolve(null);

export async function readerInbox(db: Db, id: string) {
  const hid = requireHousehold(id);
  const [pending, jobs] = await Promise.all([
    db.select({ id: readings.id, data: readings.extracted, documentId: readings.documentId, from: documents.kind }).from(readings)
      .innerJoin(documents, and(eq(documents.householdId, readings.householdId), eq(documents.id, readings.documentId)))
      .where(and(eq(readings.householdId, hid), eq(readings.status, "to_check"))).orderBy(desc(readings.createdAt)),
    db.select({ id: documents.id, status: documents.status, error: documents.error, processingAt: documents.processingAt, createdAt: documents.createdAt }).from(documents)
      .where(and(eq(documents.householdId, hid), inArray(documents.status, ["queued", "reading", "failed"]))).orderBy(desc(documents.createdAt)),
  ]);
  const values = pending.map(row => ({ id: row.id, documentId: row.documentId, from: row.from, value: extractSchema.parse((row.data as { proposed: unknown }).proposed) }));
  const links = await Promise.all(values.map(({ value }) => linkFor(db, hid, value)));
  return {
    readings: values.map((reading, index) => ({ ...reading, link: links[index] })),
    jobs: jobs.map(job => ({ id: job.id, status: job.status, error: job.error,
      retry: job.status === "failed" || Date.now() - (job.processingAt ?? job.createdAt).getTime() > 90_000 })),
  };
}
export type ReaderInbox = Awaited<ReturnType<typeof readerInbox>>;
