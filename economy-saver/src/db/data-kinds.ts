// D59: the kinds of stored data and the one set of operations on them: count a kind, delete a kind, delete one item.
// Memory, canvases, the journal and documents are real deletes; the record is refused here ("Delete everything" is the household delete).
// Every query is scoped by household_id.
import { and, asc, desc, eq, isNotNull, or, sql } from "drizzle-orm";
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";
import { documentBucket } from "@/lib/reader/storage";
import { ReaderError } from "@/lib/reader/settings";
import { deleteMemory, forgetEverything } from "./memory";
import { unpinCanvas } from "./canvases";
import { InputError } from "./input-error";
import { recordEvent, requireHousehold, withHousehold, type Db, type Maker } from "./household";
import * as s from "./schema";

export const DATA_KINDS = ["record", "memory", "canvases", "journal", "documents", "reminders", "push_subscriptions"] as const;
export type DataKind = (typeof DATA_KINDS)[number];
export const isDataKind = (value: unknown): value is DataKind => (DATA_KINDS as readonly unknown[]).includes(value);

/** What a Storage bucket must offer to delete document files. Defaults to the household-documents bucket; tests pass their own. */
export type DocumentStore = { remove(paths: string[]): PromiseLike<{ error: unknown }> };

const uuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const count = async (db: Db, table: PgTable & { householdId: AnyPgColumn }, hid: string): Promise<number> => {
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(table).where(eq(table.householdId, hid));
  return n;
};

/** How many items a kind holds. The record's count is its bills, charges, statements, clients, invoices, pots and settlements. */
export async function countKind(db: Db, householdId: string, kind: DataKind): Promise<number> {
  const hid = requireHousehold(householdId);
  switch (kind) {
    case "memory": return count(db, s.memories, hid);
    case "canvases": return count(db, s.canvases, hid);
    case "journal": {
      const [turns, [{ n }]] = await Promise.all([count(db, s.conversationTurns, hid),
        db.select({ n: sql<number>`count(*)::int` }).from(s.spaces).where(and(eq(s.spaces.householdId, hid), or(eq(s.spaces.isGeneral, false), isNotNull(s.spaces.briefUpdatedAt))))]);
      return turns + n;
    }
    case "documents": return count(db, s.documents, hid);
    case "reminders": return count(db, s.reminders, hid);
    case "push_subscriptions": return count(db, s.pushSubscriptions, hid);
    case "record": {
      const parts = await Promise.all([s.bills, s.charges, s.cardStatements, s.clients, s.invoices, s.pots, s.settlements].map(table => count(db, table, hid)));
      return parts.reduce((a, b) => a + b, 0);
    }
  }
}

/** Counts of every kind at once (the Your data rows). */
export async function countKinds(db: Db, householdId: string): Promise<Record<DataKind, number>> {
  const hid = requireHousehold(householdId);
  const counts = await Promise.all(DATA_KINDS.map(kind => countKind(db, hid, kind)));
  return Object.fromEntries(DATA_KINDS.map((kind, i) => [kind, counts[i]])) as Record<DataKind, number>;
}

/** Document metadata for Your data, without file paths or reading contents. */
export async function listDocuments(db: Db, householdId: string) {
  const hid = requireHousehold(householdId);
  return withHousehold(db, hid, async tx => {
    const [docs, readings] = await Promise.all([
      tx.select({ id: s.documents.id, kind: s.documents.kind, mime: s.documents.mime, bytes: s.documents.bytes,
        createdAt: s.documents.createdAt, fileRemovedAt: s.documents.fileRemovedAt }).from(s.documents)
        .where(eq(s.documents.householdId, hid)).orderBy(desc(s.documents.createdAt), asc(s.documents.id)),
      tx.select({ id: s.readings.id, documentId: s.readings.documentId, status: s.readings.status,
        confirmedName: sql<string | null>`nullif(btrim(${s.readings.extracted}->'confirmed'->>'name'), '')`,
        proposedName: sql<string | null>`nullif(btrim(${s.readings.extracted}->'proposed'->>'name'), '')`,
      }).from(s.readings).where(eq(s.readings.householdId, hid)).orderBy(asc(s.readings.createdAt), asc(s.readings.id)),
    ]);
    const details = new Map<string, { confirmedName: string | null; proposedName: string | null; waitingReadingId: string | null }>();
    for (const row of readings) {
      const document = details.get(row.documentId) ?? { confirmedName: null, proposedName: null, waitingReadingId: null };
      document.confirmedName ??= row.confirmedName;
      document.proposedName ??= row.proposedName;
      if (row.status === "to_check") document.waitingReadingId ??= row.id;
      details.set(row.documentId, document);
    }
    return docs.map(doc => {
      const reading = details.get(doc.id);
      const type = doc.mime === "application/pdf" ? "Uploaded PDF" : doc.mime.startsWith("image/") ? "Uploaded photo" : "Uploaded document";
      return {
        id: doc.id, name: doc.kind === "email" ? "Forwarded email" : reading?.confirmedName ?? reading?.proposedName ?? type,
        bytes: doc.bytes, createdAt: doc.createdAt, fileRemoved: doc.fileRemovedAt !== null, waitingReadingId: reading?.waitingReadingId ?? null,
      };
    });
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}

/** Removes the Storage objects of the given document rows (all of this household's), then returns. Throws when Storage refuses. */
async function removeObjects(hid: string, paths: string[], store?: DocumentStore) {
  if (paths.length === 0) return;
  if (paths.some(path => !path.startsWith(hid + "/"))) throw new ReaderError("Document storage path does not belong to this household.");
  const bucket = store ?? await documentBucket();
  for (let i = 0; i < paths.length; i += 100) {
    const { error } = await bucket.remove(paths.slice(i, i + 100));
    if (error) throw new ReaderError("Could not remove the documents from Storage.");
  }
}

async function lock(tx: Db, hid: string) {
  const [row] = await tx.select({ id: s.households.id }).from(s.households).where(eq(s.households.id, hid)).for("update");
  if (!row) throw new InputError("Household not found");
}

/** Deletes one uploaded or forwarded document: its Storage object, its readings (waiting or done) and the row. Bills and charges made from it stay in the record and lose the link. False when it is not this household's. */
export async function deleteDocument(db: Db, householdId: string, id: string, by: Maker, store?: DocumentStore): Promise<boolean> {
  const hid = requireHousehold(householdId);
  if (!uuid(id)) return false;
  return db.transaction(async tx => {
    await lock(tx, hid);
    const [doc] = await tx.select({ path: s.documents.storagePath }).from(s.documents).where(and(eq(s.documents.householdId, hid), eq(s.documents.id, id)));
    if (!doc) return false;
    await removeObjects(hid, [doc.path], store);
    await tx.update(s.bills).set({ documentId: null }).where(and(eq(s.bills.householdId, hid), eq(s.bills.documentId, id)));
    await tx.update(s.charges).set({ documentId: null }).where(and(eq(s.charges.householdId, hid), eq(s.charges.documentId, id)));
    await tx.delete(s.documents).where(and(eq(s.documents.householdId, hid), eq(s.documents.id, id))); // the readings go with it
    await recordEvent(tx, hid, { ...by, kind: "data_deleted", title: "Deleted an uploaded document" });
    return true;
  });
}

/** Deletes one conversation turn. False when it is not this household's. */
export async function deleteTurn(db: Db, householdId: string, id: string): Promise<boolean> {
  const hid = requireHousehold(householdId);
  if (!uuid(id)) return false;
  const gone = await db.delete(s.conversationTurns).where(and(eq(s.conversationTurns.householdId, hid), eq(s.conversationTurns.id, id))).returning({ id: s.conversationTurns.id });
  return gone.length === 1;
}

/** Deletes every turn of one conversation (Ask's "Delete this conversation"). Returns how many went. */
export async function deleteConversation(db: Db, householdId: string, conversationId: string): Promise<number> {
  const hid = requireHousehold(householdId);
  if (!uuid(conversationId)) return 0;
  const gone = await db.delete(s.conversationTurns)
    .where(and(eq(s.conversationTurns.householdId, hid), eq(s.conversationTurns.conversationId, conversationId))).returning({ id: s.conversationTurns.id });
  return gone.length;
}

/** Deletes one item of a kind. False when the id is not this household's. The record has no single-item delete here. */
export async function deleteOne(db: Db, householdId: string, kind: DataKind, id: string, by: Maker, store?: DocumentStore): Promise<boolean> {
  const hid = requireHousehold(householdId);
  switch (kind) {
    case "memory": return deleteMemory(db, hid, id, by as { madeBy: "form" | "ask" | "mcp" });
    case "canvases": return uuid(id) ? unpinCanvas(db, hid, id, by) : false;
    case "journal": return deleteTurn(db, hid, id);
    case "documents": return deleteDocument(db, hid, id, by, store);
    case "reminders":
    case "push_subscriptions": return uuid(id) && (await deleteReminderRows(db, hid, kind, by, id)) > 0;
    case "record": throw new InputError("Delete a bill, charge, client, invoice or pot from its own page, or delete everything.");
  }
}

/** Deletes every item of a kind and returns how many went. The record is refused: "Delete everything" is the household delete. */
export async function deleteKind(db: Db, householdId: string, kind: DataKind, by: Maker, store?: DocumentStore): Promise<number> {
  const hid = requireHousehold(householdId);
  switch (kind) {
    case "record": throw new InputError("The record can only be deleted with everything else. Use Delete everything.");
    case "memory": return forgetEverything(db, hid, by as { madeBy: "form" | "ask" | "mcp" });
    case "canvases": {
      const rows = await db.select({ id: s.canvases.id }).from(s.canvases).where(eq(s.canvases.householdId, hid));
      let n = 0;
      for (const { id } of rows) if (await unpinCanvas(db, hid, id, by)) n++;
      return n;
    }
    case "journal":
      return withHousehold(db, hid, async tx => {
        await lock(tx, hid);
        const scope = eq(s.spaces.householdId, hid);
        const named = await tx.select({ id: s.spaces.id }).from(s.spaces)
          .where(and(scope, eq(s.spaces.isGeneral, false))).for("update");
        const turns = await tx.delete(s.conversationTurns).where(eq(s.conversationTurns.householdId, hid))
          .returning({ id: s.conversationTurns.id });
        await tx.update(s.standingRules).set({ spaceId: null })
          .where(and(eq(s.standingRules.householdId, hid), isNotNull(s.standingRules.spaceId)));
        await tx.update(s.reminders).set({ spaceId: null })
          .where(and(eq(s.reminders.householdId, hid), isNotNull(s.reminders.spaceId)));
        await tx.delete(s.spaces).where(and(scope, eq(s.spaces.isGeneral, false)));
        const general = await tx.update(s.spaces).set({ brief: {}, briefUpdatedAt: null, briefUpdatedBy: null })
          .where(and(scope, eq(s.spaces.isGeneral, true), isNotNull(s.spaces.briefUpdatedAt))).returning({ id: s.spaces.id });
        return turns.length + named.length + general.length;
      });
    case "reminders":
    case "push_subscriptions":
      return deleteReminderRows(db, hid, kind, by);
    case "documents":
      return db.transaction(async tx => {
        await lock(tx, hid);
        const rows = await tx.select({ id: s.documents.id, path: s.documents.storagePath }).from(s.documents).where(eq(s.documents.householdId, hid));
        if (rows.length === 0) return 0;
        await removeObjects(hid, rows.map(r => r.path), store);
        await tx.update(s.bills).set({ documentId: null }).where(eq(s.bills.householdId, hid));
        await tx.update(s.charges).set({ documentId: null }).where(eq(s.charges.householdId, hid));
        await tx.delete(s.documents).where(eq(s.documents.householdId, hid));
        await recordEvent(tx, hid, { ...by, kind: "data_deleted", title: `Deleted ${rows.length} uploaded document${rows.length === 1 ? "" : "s"}` });
        return rows.length;
      });
  }
}

type ReminderDataKind = Extract<DataKind, "reminders" | "push_subscriptions">;

async function deleteReminderRows(db: Db, hid: string, kind: ReminderDataKind, by: Maker, id?: string) {
  const table = kind === "reminders" ? s.reminders : s.pushSubscriptions;
  return db.transaction(async tx => {
    const removed = await tx.delete(table).where(and(eq(table.householdId, hid), id ? eq(table.id, id) : undefined)).returning({ id: table.id });
    if (removed.length) await recordEvent(tx, hid, {
      ...by, kind: "data_deleted", title: kind === "reminders" ? "Deleted reminder history" : "Deleted push subscriptions",
    });
    return removed.length;
  });
}
