import { timingSafeEqual } from "node:crypto";
import { after } from "next/server";
import { db } from "@/db/client";
import { storeDocument } from "@/db/reader-job";
import { readDocumentInBackground } from "@/db/reader-background";
import { householdForRecipient } from "@/lib/reader/forwarding";
import { limitedBody, MAX_DOCUMENT_BYTES, ReaderError, readerSetting } from "@/lib/reader/settings";

/** An anonymous caller is never told why (D37): a missing setting is one server log line naming the variable, and a 503 with no body. */
function unavailable(error: ReaderError) {
  console.error(`/api/inbound: ${error.message}`);
  return new Response(null, { status: 503 });
}

export async function POST(request: Request) {
  if (request.headers.get("origin") !== "https://worker.internal") return new Response(null, { status: 403 });
  let secret: string;
  try { secret = readerSetting("INBOUND_WORKER_SECRET"); }
  catch (error) { if (error instanceof ReaderError) return unavailable(error); throw error; }
  const expected = Buffer.from("Bearer " + secret);
  const supplied = Buffer.from(request.headers.get("authorization") ?? "");
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return new Response(null, { status: 403 });
  try {
    const hid = await householdForRecipient(db(), request.headers.get("x-envelope-to") ?? "");
    if (!hid) return new Response(null, { status: 404 });
    const bytes = await limitedBody(request, MAX_DOCUMENT_BYTES);
    const doc = await storeDocument(db(), hid, "email", "message/rfc822", bytes);
    after(() => readDocumentInBackground(hid, doc));
    return new Response(null, { status: 202 });
  } catch (error) {
    // The caller is the Worker, which has proved the secret; a missing setting still goes to the log by name.
    if (error instanceof ReaderError && error.status === 503) console.error(`/api/inbound: ${error.message}`);
    return new Response(error instanceof ReaderError ? error.message : "Could not accept email.", { status: 503 });
  }
}
