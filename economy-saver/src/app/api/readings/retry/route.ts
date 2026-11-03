import { after } from "next/server";
import { z } from "zod";
import { redirectTo } from "@/lib/door";
import { householdRequest } from "@/lib/session";
import { db } from "@/db/client";
import { consumeRequest } from "@/db/rate-limit";
import { readDocumentInBackground } from "@/db/reader-background";

export async function POST(request: Request) {
  const hid = await householdRequest(request);
  if (hid instanceof Response) return hid;
  const doc = z.string().uuid().safeParse((await request.formData()).get("id"));
  if (!doc.success) return new Response("Invalid document", { status: 400 });
  if (!await consumeRequest(db(), hid, "upload", 6)) return new Response("Retry limit reached.", { status: 429 });
  after(() => readDocumentInBackground(hid, doc.data, true));
  return redirectTo("/to-check");
}
