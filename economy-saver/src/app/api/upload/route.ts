import { after } from "next/server";
import { db } from "@/db/client";
import { consumeRequest } from "@/db/rate-limit";
import { requireReaderModel, storeDocument } from "@/db/reader-job";
import { readDocumentInBackground } from "@/db/reader-background";
import { readUpload } from "@/lib/reader/accept";
import { ReaderError } from "@/lib/reader/settings";
import { redirectTo } from "@/lib/door";
import { householdRequest } from "@/lib/session";

export async function POST(request: Request) {
  const hid = await householdRequest(request);
  if (hid instanceof Response) return hid;
  try {
    if (!await consumeRequest(db(), hid, "upload", 6)) return new Response("Upload limit reached. Try again in a minute.", { status: 429 });
    await requireReaderModel(db(), hid);
    const { mime, bytes } = await readUpload(request);
    const doc = await storeDocument(db(), hid, "upload", mime, bytes);
    after(() => readDocumentInBackground(hid, doc));
    return redirectTo("/to-check");
  } catch (error) {
    return new Response(error instanceof ReaderError ? error.message : "Upload failed.", { status: error instanceof ReaderError ? error.status : 500 });
  }
}
