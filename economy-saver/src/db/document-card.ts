// D61: the card for a file attached in Ask, drawn by code from the document's readings. Read-only apart from `attachDocument`, which stores
// the file and the turn. The reading itself is scheduled by the route. Every query is scoped by the household.
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { requireHousehold, type Db } from "./household";
import { documents, readings } from "./schema";
import { readPlaces } from "./place";
import { readerInbox } from "./reader-inbox";
import { storeDocument } from "./reader-job";
import { saveTurn } from "./conversation";
import { loadCanvasContext } from "@/lib/canvas/request";
import { readingProposal } from "@/lib/money/checks";
import { buildCard, DOCUMENT_WORDS, type CardReading, type DocumentCard } from "@/lib/reader/document-card";
import { extractSchema } from "@/lib/reader/extract";
import { TURN_VERSION, type ConversationTurn, type TurnKind } from "@/lib/schema/turn";

// A turn kind, not an Activity event kind: written as a constant so the doors scan for `kind: "…"` does not take it for one.
const DOCUMENT: TurnKind = "document";

const uuid = z.string().uuid();

type Stored = { proposed: unknown; confirmed?: unknown; targetId?: string };

// The canvas a document card draws never asks for foreign costs, so its context loads none.
/** The card for one document of this household. A document that is not this household's, or no longer exists, is `gone`. `draw: false` skips the money state: no checks and no canvas. */
export async function documentCard(db: Db, householdId: string, documentId: string, options: { draw?: boolean } = {}): Promise<DocumentCard> {
  const hid = requireHousehold(householdId);
  if (!uuid.safeParse(documentId).success) return buildCard({ documentId, doc: null, readings: [] }, null);
  const [doc] = await db.select({ status: documents.status, error: documents.error }).from(documents).where(and(eq(documents.householdId, hid), eq(documents.id, documentId)));
  if (!doc) return buildCard({ documentId, doc: null, readings: [] }, null);
  const rows = doc.status === "read" ? await db.select({ id: readings.id, status: readings.status, extracted: readings.extracted, confirmedAt: readings.confirmedAt, createdAt: readings.createdAt }).from(readings)
    .where(and(eq(readings.householdId, hid), eq(readings.documentId, documentId))).orderBy(asc(readings.createdAt), asc(readings.id)) : [];
  const draw = options.draw !== false && rows.length > 0;
  const [context, inbox] = draw ? await Promise.all([loadCanvasContext(db, hid, { blocks: [] }), readerInbox(db, hid)]) : [null, null];
  const links = new Map((inbox?.readings ?? []).map(reading => [reading.id, reading.link]));
  const items = rows.flatMap((row): CardReading[] => {
    if (row.status !== "to_check" && row.status !== "confirmed" && row.status !== "rejected") return [];
    const stored = row.extracted as Stored;
    return [{
      id: row.id, status: row.status, value: extractSchema.parse(row.status === "confirmed" && stored.confirmed !== undefined ? stored.confirmed : stored.proposed),
      link: links.get(row.id) ?? null, targetId: stored.targetId ?? null, confirmedAt: row.confirmedAt?.toISOString() ?? null,
    }];
  });
  const waiting = (inbox?.readings ?? []).map(reading => readingProposal(reading));
  return buildCard({ documentId, doc: { status: doc.status as "queued" | "reading" | "read" | "failed", error: doc.error }, readings: items }, context, waiting);
}

/**
 * Stores the file attached in Ask (kind `upload`) and the document turn that stands for it (kept only when the household keeps its
 * conversations in the cloud; on the device the page saves the returned turn). Never reads the file: the route schedules that.
 * The same file twice is one document.
 */
export async function attachDocument(
  db: Db, householdId: string, input: { id: string; conversationId: string; text: string | null; mime: string; bytes: ArrayBuffer }, at: Date = new Date(),
): Promise<{ turn: ConversationTurn; card: DocumentCard; documentId: string }> {
  const hid = requireHousehold(householdId);
  const documentId = await storeDocument(db, hid, "upload", input.mime, input.bytes);
  const turn: ConversationTurn = {
    version: TURN_VERSION, id: input.id, conversationId: input.conversationId, question: input.text ?? DOCUMENT_WORDS.question, kind: DOCUMENT,
    reply: DOCUMENT_WORDS.sent, choices: null, recipe: null, sources: [], documentId, thumb: null, createdAt: at.toISOString(),
  };
  if ((await readPlaces(db, hid)).journal === "cloud") {
    await saveTurn(db, hid, { id: turn.id, conversationId: turn.conversationId, question: turn.question, kind: DOCUMENT, reply: turn.reply, choices: null, recipe: null, sources: [], documentId }, at);
  }
  return { turn, card: await documentCard(db, hid, documentId), documentId };
}
