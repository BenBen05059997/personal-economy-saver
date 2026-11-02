import { after } from "next/server";
import { z } from "zod";
import { currentHouseholdId, sameOrigin } from "@/lib/session";
import { db } from "@/db/client";
import { consumeRequest } from "@/db/rate-limit";
import { readDocument } from "@/db/reader-job";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return new Response(null, { status: 403 });
  const hid = await currentHouseholdId();
  if (!hid) return new Response(null, { status: 401 });
  const doc = z.string().uuid().safeParse((await request.formData()).get("id"));
  if (!doc.success) return new Response("Invalid document", { status: 400 });
  if (!await consumeRequest(db(), hid, "upload", 6)) return new Response("Retry limit reached.", { status: 429 });
  after(() => readDocument(db(), hid, doc.data, true));
  return new Response(null, { status: 303, headers: { Location: "/to-check" } });
}
