import { after } from "next/server";
import { db } from "@/db/client";
import { consumeRequest } from "@/db/rate-limit";
import { storeDocument } from "@/db/reader-job";
import { readDocumentInBackground } from "@/db/reader-background";
import { matchesFileType, uploadMime } from "@/lib/reader/extract";
import { limitedBody, MAX_DOCUMENT_BYTES, ReaderError } from "@/lib/reader/settings";
import { redirectTo } from "@/lib/door";
import { householdRequest } from "@/lib/session";

export async function POST(request: Request) {
  const hid = await householdRequest(request);
  if (hid instanceof Response) return hid;
  try {
    if (!await consumeRequest(db(), hid, "upload", 6)) return new Response("Upload limit reached. Try again in a minute.", { status: 429 });
    const bytes = await limitedBody(request, MAX_DOCUMENT_BYTES + 8192);
    const type = request.headers.get("content-type");
    if (!type?.startsWith("multipart/form-data;")) throw new ReaderError("Select a file to upload.");
    const form = await new Response(bytes, { headers: { "content-type": type } }).formData().catch(() => null);
    const file = form?.get("document");
    if (!(file instanceof File) || !uploadMime.safeParse(file.type).success) throw new ReaderError("Select a PDF, JPEG, PNG or WebP file.");
    const original = await file.arrayBuffer();
    if (!matchesFileType(original, file.type)) throw new ReaderError("File contents do not match the selected file type.");
    const doc = await storeDocument(db(), hid, "upload", file.type, original);
    after(() => readDocumentInBackground(hid, doc));
    return redirectTo("/to-check");
  } catch (error) {
    return new Response(error instanceof ReaderError ? error.message : "Upload failed.", { status: 400 });
  }
}
