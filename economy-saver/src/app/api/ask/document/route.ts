import { after } from "next/server";
import { z } from "zod";
import { db } from "@/db/client";
import { attachDocument, documentCard } from "@/db/document-card";
import { requireReaderModel } from "@/db/reader-job";
import { readDocumentInBackground } from "@/db/reader-background";
import { BAD_FIELDS, NO_STORE } from "@/lib/door";
import { readUpload } from "@/lib/reader/accept";
import { ReaderError } from "@/lib/reader/settings";
import { currentHouseholdId, householdRequest } from "@/lib/session";

const fields = z.object({
  id: z.string().uuid(), conversationId: z.string().uuid(),
  text: z.string().trim().max(320).optional(),
});

/** D61: attach a file in Ask. The file goes through Upload's storage and reader; the answer is the turn and its card, and the model reads after the response. */
export async function POST(request: Request) {
  const hid = await householdRequest(request);
  if (hid instanceof Response) return hid;
  try {
    await requireReaderModel(db(), hid);
    const { mime, bytes, form } = await readUpload(request);
    const parsed = fields.safeParse({ id: form.get("id"), conversationId: form.get("conversationId"), text: form.get("text") ?? undefined });
    if (!parsed.success) return new Response(BAD_FIELDS, { status: 400 });
    const { turn, card, documentId } = await attachDocument(db(), hid, { id: parsed.data.id, conversationId: parsed.data.conversationId, text: parsed.data.text || null, mime, bytes });
    after(() => readDocumentInBackground(hid, documentId));
    return Response.json({ turn, card }, { headers: NO_STORE });
  } catch (error) {
    return new Response(error instanceof ReaderError ? error.message : "Upload failed.", { status: error instanceof ReaderError ? error.status : 500 });
  }
}

/** The card again, for the page's poll and after a Confirm. A document that is not this household's, or is gone, is `gone`. */
export async function GET(request: Request) {
  const hid = await currentHouseholdId();
  if (!hid) return new Response("Household session required", { status: 401, headers: NO_STORE });
  const id = new URL(request.url).searchParams.get("id");
  if (!z.string().uuid().safeParse(id).success) return new Response("Invalid item", { status: 400, headers: NO_STORE });
  return Response.json({ card: await documentCard(db(), hid, id!) }, { headers: NO_STORE });
}
