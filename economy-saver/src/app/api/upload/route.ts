import { after } from "next/server";
import { db } from "@/db/client";
import { requireReaderModel, storeDocument } from "@/db/reader-job";
import { readDocumentInBackground } from "@/db/reader-background";
import { readUpload } from "@/lib/reader/accept";
import { ReaderError } from "@/lib/reader/settings";
import { redirectTo, text } from "@/lib/door";
import { householdRequest } from "@/lib/session";

export async function POST(request: Request) {
  const hid = await householdRequest(request);
  if (hid instanceof Response) return hid;
  try {
    const { mime, bytes } = await readUpload(request);
    await requireReaderModel(db(), hid);
    const doc = await storeDocument(db(), hid, "upload", mime, bytes);
    after(() => readDocumentInBackground(hid, doc));
    return redirectTo("/to-check", request);
  } catch (error) {
    return text(error instanceof ReaderError ? error.message : "Upload failed.", error instanceof ReaderError ? error.status : 500);
  }
}
