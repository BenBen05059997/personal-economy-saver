import { eq } from "drizzle-orm";
import { type Db, requireHousehold } from "./household";
import { documents } from "./schema";
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
