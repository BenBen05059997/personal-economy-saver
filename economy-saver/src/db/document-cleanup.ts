import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { type Db, requireHousehold } from "./household";
import { documents, households, readings } from "./schema";
import { documentBucket } from "@/lib/reader/storage";
import { ReaderError } from "@/lib/reader/settings";

// Caller locks the household before cleanup and removal. Empty households do not need Storage settings.
export async function removeHouseholdDocuments(db: Db, id: string) {
  const hid = requireHousehold(id);
  const rows = await db.select({ path: documents.storagePath }).from(documents).where(eq(documents.householdId, hid));
  if (!rows.length) return;
  const paths = rows.map(row => row.path);
  if (paths.some(path => !path.startsWith(hid + "/"))) throw new ReaderError("Document storage path does not belong to this household.");
  const bucket = await documentBucket();
  for (let i = 0; i < paths.length; i += 100) {
    const { error } = await bucket.remove(paths.slice(i, i + 100));
    if (error) throw new ReaderError("Could not remove household documents from Storage.");
  }
}

const MiB = 1024 * 1024;
/** What one household may keep in private Storage: a real household 200 MiB, a Try it household 20 MiB (27E). */
export const STORAGE_CAP_BYTES = 200 * MiB;
export const DEMO_STORAGE_CAP_BYTES = 20 * MiB;
/** The raw file of a document is removed this many days after its last reading was confirmed or dismissed (27E). */
export const RAW_FILE_RETENTION_DAYS = 30;

/** Bytes this household holds in Storage now: files not yet removed. */
export async function storedBytes(db: Db, id: string): Promise<number> {
  const hid = requireHousehold(id);
  const [row] = await db.select({ n: sql<number>`coalesce(sum(${documents.bytes}), 0)::float8` }).from(documents)
    .where(and(eq(documents.householdId, hid), isNull(documents.fileRemovedAt)));
  return row.n;
}

/** Refuses a file that would take the household past its Storage cap, in words a person reads. Call before the file is stored. */
export async function requireStorageRoom(db: Db, id: string, incomingBytes: number): Promise<void> {
  const hid = requireHousehold(id);
  const [household] = await db.select({ demo: households.isDemo }).from(households).where(eq(households.id, hid));
  if (!household) throw new ReaderError("Household no longer exists.");
  const cap = household.demo ? DEMO_STORAGE_CAP_BYTES : STORAGE_CAP_BYTES;
  if (await storedBytes(db, hid) + incomingBytes > cap) {
    throw new ReaderError(`Your stored documents are full (${Math.round(cap / MiB)} MB). Delete some in Settings, under Your data, then try again.`);
  }
}

/**
 * Removes the raw file of every document of this household whose readings are all confirmed or dismissed, the last of them
 * more than RAW_FILE_RETENTION_DAYS ago. The document row, its readings and the bills and charges made from it stay; the row records
 * the removal. A document with no readings, or one still to check, keeps its file. Returns how many files went.
 */
export async function removeExpiredFiles(db: Db, id: string, now = new Date(), store?: { remove(paths: string[]): PromiseLike<{ error: unknown }> }): Promise<number> {
  const hid = requireHousehold(id);
  const cutoff = new Date(now.getTime() - RAW_FILE_RETENTION_DAYS * 86_400_000);
  const open = db.select({ one: sql`1` }).from(readings)
    .where(and(eq(readings.householdId, hid), eq(readings.documentId, documents.id), eq(readings.status, "to_check")));
  const recent = db.select({ one: sql`1` }).from(readings)
    .where(and(eq(readings.householdId, hid), eq(readings.documentId, documents.id), sql`coalesce(${readings.confirmedAt}, ${readings.createdAt}) >= ${cutoff.toISOString()}::timestamptz`));
  const settled = db.select({ one: sql`1` }).from(readings).where(and(eq(readings.householdId, hid), eq(readings.documentId, documents.id)));
  const rows = await db.select({ id: documents.id, path: documents.storagePath }).from(documents)
    .where(and(eq(documents.householdId, hid), eq(documents.status, "read"), isNull(documents.fileRemovedAt),
      sql`exists (${settled})`, sql`not exists (${open})`, sql`not exists (${recent})`));
  if (!rows.length) return 0;
  if (rows.some(row => !row.path.startsWith(hid + "/"))) throw new ReaderError("Document storage path does not belong to this household.");
  const bucket = store ?? await documentBucket();
  const ids: string[] = [];
  for (let i = 0; i < rows.length; i += 100) {
    const chunk = rows.slice(i, i + 100);
    const { error } = await bucket.remove(chunk.map(row => row.path));
    if (error) throw new ReaderError("Could not remove old documents from Storage.");
    ids.push(...chunk.map(row => row.id));
  }
  await db.update(documents).set({ fileRemovedAt: now }).where(and(eq(documents.householdId, hid), inArray(documents.id, ids), isNull(documents.fileRemovedAt)));
  return ids.length;
}
