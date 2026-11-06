// D59: the five kinds of stored data and the one set of operations on them: count a kind, delete a kind, delete one item.
// Memory, canvases, the journal and documents are real deletes; the record is refused here ("Delete everything" is the household delete).
// Every query is scoped by household_id.
import { and, eq, sql } from "drizzle-orm";
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";
import { documentBucket } from "@/lib/reader/storage";
import { ReaderError } from "@/lib/reader/settings";
import { deleteMemory, forgetEverything } from "./memory";
import { unpinCanvas } from "./canvases";
import { InputError } from "./input-error";
import { recordEvent, requireHousehold, type Db, type Maker } from "./household";
import * as s from "./schema";

export const DATA_KINDS = ["record", "memory", "canvases", "journal", "documents"] as const;
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
    case "journal": return count(db, s.conversationTurns, hid);
    case "documents": return count(db, s.documents, hid);
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
    case "journal": {
      const gone = await db.delete(s.conversationTurns).where(eq(s.conversationTurns.householdId, hid)).returning({ id: s.conversationTurns.id });
      return gone.length;
    }
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
