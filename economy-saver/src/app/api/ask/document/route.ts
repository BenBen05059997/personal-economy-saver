import { after } from "next/server";
import { z } from "zod";
import { db } from "@/db/client";
import { InputError } from "@/db/input-error";
import { withHousehold } from "@/db/household";
import { attachDocument, documentCard } from "@/db/document-card";
import { documentsLeft } from "@/db/ai-cap";
import { requireDocumentBudget, requireReaderModel } from "@/db/reader-job";
import { readDocumentInBackground } from "@/db/reader-background";
import { BAD_FIELDS, NO_STORE, text } from "@/lib/door";
import { readUpload } from "@/lib/reader/accept";
import { ReaderError } from "@/lib/reader/settings";
import { currentHouseholdId, householdRequest } from "@/lib/session";

const fields = z.object({
  id: z.string().uuid(), conversationId: z.string().uuid(),
  spaceId: z.string().uuid().optional(),
  text: z.string().trim().max(320).optional(),
});

/** D61: attach a file in Ask. The file goes through Upload's storage and reader; the answer is the turn and its card, and the model reads after the response. */
export async function POST(request: Request) {
  const hid = await householdRequest(request);
  if (hid instanceof Response) return hid;
  try {
    const { mime, bytes, form } = await readUpload(request);
    const parsed = fields.safeParse({ id: form.get("id"), conversationId: form.get("conversationId"), spaceId: form.get("spaceId") ?? undefined, text: form.get("text") ?? undefined });
    if (!parsed.success) return text(BAD_FIELDS, 400);
    await requireReaderModel(db(), hid);
    await requireDocumentBudget(db(), hid, mime, bytes);
    const { turn, card, documentId } = await attachDocument(db(), hid, { id: parsed.data.id, conversationId: parsed.data.conversationId, spaceId: parsed.data.spaceId, text: parsed.data.text || null, mime, bytes });
    after(() => readDocumentInBackground(hid, documentId));
    return Response.json({ turn, card, left: await documentsLeft(db(), hid) }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof InputError) return text(error.message, 400);
    return text(error instanceof ReaderError ? error.message : "Upload failed.", error instanceof ReaderError ? error.status : 500);
  }
}

/** The card again, for the page's poll and after a Confirm. A document that is not this household's, or is gone, is `gone`. */
export async function GET(request: Request) {
  const hid = await currentHouseholdId();
  if (!hid) return text("Household session required", 401);
  const id = new URL(request.url).searchParams.get("id");
  if (!z.string().uuid().safeParse(id).success) return text("Invalid item", 400);
  return Response.json({ card: await withHousehold(db(), hid, tx => documentCard(tx, hid, id!)) }, { headers: NO_STORE });
}
