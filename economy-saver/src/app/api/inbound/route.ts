import { timingSafeEqual } from "node:crypto";
import { after } from "next/server";
import { db } from "@/db/client";
import { consumeRequest } from "@/db/rate-limit";
import { readDocument, storeDocument } from "@/db/reader-job";
import { householdForRecipient } from "@/lib/reader/forwarding";
import { limitedBody, MAX_DOCUMENT_BYTES, ReaderError, readerSetting } from "@/lib/reader/settings";

export async function POST(request: Request) {
  if (request.headers.get("origin") !== "https://worker.internal") return new Response(null, { status: 403 });
  const expected = Buffer.from("Bearer " + readerSetting("INBOUND_WORKER_SECRET"));
  const supplied = Buffer.from(request.headers.get("authorization") ?? "");
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return new Response(null, { status: 403 });
  const hid = await householdForRecipient(db(), request.headers.get("x-envelope-to") ?? "");
  if (!hid) return new Response(null, { status: 404 });
  if (!await consumeRequest(db(), hid, "upload", 6)) return new Response(null, { status: 429 });
  try {
    const bytes = await limitedBody(request, MAX_DOCUMENT_BYTES);
    const doc = await storeDocument(db(), hid, "email", "message/rfc822", bytes);
    after(() => readDocument(db(), hid, doc));
    return new Response(null, { status: 202 });
  } catch (error) {
    return new Response(error instanceof ReaderError ? error.message : "Could not accept email.", { status: 503 });
  }
}
