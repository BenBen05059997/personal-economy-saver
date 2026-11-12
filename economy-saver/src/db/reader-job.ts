import { logSettingProblem } from "@/lib/operator-log";
import { and, eq, inArray, isNull, lt, or } from "drizzle-orm";
import { requireHousehold, recordEvent, withHousehold, type Db } from "./household";
import { householdClock } from "./account";
import { DOCUMENT_NOT_READ, DOCUMENTS_USED_UP, spendAiBudget } from "./ai-cap";
import { AiKeyError, aiConnection, connectionView } from "./ai-key";
import { missingAskSetting, serverHasNoModel } from "@/lib/agent/availability";
import { cards, documents, households } from "./schema";
import { requireStorageRoom } from "./document-cleanup";
import { proposeReadings } from "./readings";
import { documentBucket } from "@/lib/reader/storage";
import { extractDocument } from "@/lib/reader/extract";
import { MAX_DOCUMENT_BYTES, ReaderError } from "@/lib/reader/settings";

const LEASE_MS = 90_000;
export const staleBefore = () => new Date(Date.now() - LEASE_MS);

async function lockHousehold(tx: Db, hid: string) {
  const [row] = await tx.select({ id: households.id }).from(households).where(eq(households.id, hid)).for("update");
  if (!row) throw new ReaderError("Household no longer exists.");
}

// The content digest includes the household and media type. A redelivered email or double upload has one job.
async function contentId(hid: string, mime: string, bytes: ArrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-256", Buffer.concat([Buffer.from(hid + "/" + mime + "/"), Buffer.from(bytes)]));
  const key = Buffer.from(digest);
  key[6] = (key[6] & 15) | 0x80;
  key[8] = (key[8] & 63) | 0x80;
  return key.subarray(0, 16).toString("hex").replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5");
}

/** A file is refused up front, as a 503 naming the setting, when no model is set up to read it (the household's own, or the server default). */
export async function requireReaderModel(db: Db, id: string) {
  const missing = missingAskSetting(Boolean((await withHousehold(db, id, tx => connectionView(tx, id)))?.textModel));
  if (missing) logSettingProblem("reader_not_set_up", `${missing} is not set`, id);
  if (missing) throw new ReaderError(serverHasNoModel() ? "Reading documents needs an AI key in Settings → Your AI model."
    : "Reading documents isn’t set up on this server.", 503);
}

/**
 * D33: spends one of the household's daily document reads on the owner's connection, before the file is stored, so a refused file is
 * never lost silently: the person sees the refusal. A file already held and not failed is not read again, so it is not counted twice.
 */
export async function requireDocumentBudget(db: Db, id: string, mime: string, bytes: ArrayBuffer) {
  const hid = requireHousehold(id);
  if (!bytes.byteLength || bytes.byteLength > MAX_DOCUMENT_BYTES) return; // storeDocument refuses it with its own words
  const documentId = await contentId(hid, mime, bytes);
  const [held] = await withHousehold(db, hid, tx => tx.select({ status: documents.status }).from(documents)
    .where(and(eq(documents.householdId, hid), eq(documents.id, documentId))));
  if (held && held.status !== "failed") return;
  if (!await spendAiBudget(db, hid, "document")) throw new ReaderError(DOCUMENTS_USED_UP, 429);
}

export async function storeDocument(db: Db, id: string, kind: "email" | "upload", mime: string, bytes: ArrayBuffer) {
  const hid = requireHousehold(id);
  if (!bytes.byteLength || bytes.byteLength > MAX_DOCUMENT_BYTES) throw new ReaderError("Supply a document of 1 byte to 6 MiB.");
  const documentId = await contentId(hid, mime, bytes);
  const path = hid + "/" + documentId;
  const where = and(eq(documents.householdId, hid), eq(documents.id, documentId));
  // Reserve a durable path before touching Storage; even an interrupted upload is removable with the household.
  await withHousehold(db, hid, async tx => {
    await lockHousehold(tx, hid);
    // A file already held does not spend the household's Storage cap twice.
    const [held] = await tx.select({ id: documents.id }).from(documents).where(and(where, isNull(documents.fileRemovedAt)));
    if (!held) await requireStorageRoom(tx, hid, bytes.byteLength);
    await tx.insert(documents).values({ id: documentId, householdId: hid, kind, storagePath: path, mime, bytes: bytes.byteLength,
      status: "failed", error: "Upload incomplete. Submit the original again." }).onConflictDoNothing();
  });
  try {
    return await withHousehold(db, hid, async tx => {
      await lockHousehold(tx, hid);
      const [doc] = await tx.select({ status: documents.status }).from(documents).where(where).for("update");
      if (!doc) throw new ReaderError("Document no longer exists.");
      if (doc.status !== "failed") return documentId;
      const bucket = await documentBucket();
      const { error } = await bucket.upload(path, bytes, { contentType: mime, upsert: true });
      if (error) throw new ReaderError("Could not save the document to private Storage.", 502);
      await tx.update(documents).set({ status: "queued", error: null, processingAt: null }).where(where);
      await recordEvent(tx, hid, { madeBy: "reader", kind: "document_queued", title: "Document ready to read", ref: { type: "document", id: documentId } });
      return documentId;
    });
  } catch (error) {
    await withHousehold(db, hid, async tx => tx.update(documents)
      .set({ status: "failed", error: error instanceof ReaderError ? error.message : "Upload failed. Submit the same file again." })
      .where(and(where, eq(documents.status, "failed"))));
    throw error;
  }
}

export async function readDocument(db: Db, id: string, documentId: string, retry = false) {
  const hid = requireHousehold(id);
  const where = and(eq(documents.householdId, hid), eq(documents.id, documentId));
  const started = new Date();
  const [doc] = await withHousehold(db, hid, async tx =>
    tx.update(documents).set({ status: "reading", processingAt: started, error: null })
      .where(and(where, or(
        inArray(documents.status, retry ? ["queued", "failed"] : ["queued"]),
        and(eq(documents.status, "reading"), or(isNull(documents.processingAt), lt(documents.processingAt, staleBefore()))),
      ))).returning({ path: documents.storagePath, mime: documents.mime, kind: documents.kind }));
  if (!doc) return;
  const claim = and(where, eq(documents.status, "reading"), eq(documents.processingAt, started));
  try {
    // D33: an upload was counted when it arrived; forwarded mail and any retry are counted here. A refusal leaves the document in To check as failed, with the retry.
    if ((doc.kind === "email" || retry) && !await spendAiBudget(db, hid, "document")) throw new ReaderError(DOCUMENT_NOT_READ, 429);
    if (doc.path !== hid + "/" + documentId) throw new ReaderError("Document storage path is invalid.");
    const bucket = await documentBucket();
    const { data, error } = await bucket.download(doc.path);
    if (error || !data) throw new ReaderError("Document could not be read from Storage. Upload the original again.", 502);
    const [clock, knownCards] = await withHousehold(db, hid, tx => Promise.all([
      householdClock(tx, hid),
      tx.select({ id: cards.id, label: cards.label }).from(cards).where(eq(cards.householdId, hid)),
    ]));
    const items = await extractDocument(await data.arrayBuffer(), doc.mime,
      { today: clock.today, currency: clock.currency, cards: knownCards }, need => aiConnection(db, hid, need));
    await withHousehold(db, hid, async tx => {
      await lockHousehold(tx, hid);
      const completed = await tx.update(documents).set({ status: "read" }).where(claim).returning({ id: documents.id });
      if (!completed.length) return;
      if (items.length) await proposeReadings(tx, hid, documentId, items);
      else await recordEvent(tx, hid, { madeBy: "reader", kind: "document_read", title: "No bill or card charge found", ref: { type: "document", id: documentId } });
    });
  } catch (error) {
    const reason = error instanceof ReaderError || error instanceof AiKeyError ? error.message : "Document could not be read. Try again.";
    await withHousehold(db, hid, async tx => {
      await lockHousehold(tx, hid);
      const failed = await tx.update(documents).set({ status: "failed", error: reason }).where(claim).returning({ id: documents.id });
      if (failed.length) await recordEvent(tx, hid, { madeBy: "reader", kind: "document_failed", title: "Document needs attention", body: reason, ref: { type: "document", id: documentId }, notify: true });
    });
  }
}
