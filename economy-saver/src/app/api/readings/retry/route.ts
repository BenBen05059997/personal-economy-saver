import { after } from "next/server";
import { z } from "zod";
import { redirectTo, formOf } from "@/lib/door";
import { householdRequest } from "@/lib/session";
import { readDocumentInBackground } from "@/db/reader-background";

export async function POST(request: Request) {
  const hid = await householdRequest(request);
  if (hid instanceof Response) return hid;
  const body = await formOf(request);
  if (body instanceof Response) return body;
  const doc = z.string().uuid().safeParse(body.get("id"));
  if (!doc.success) return new Response("Invalid document", { status: 400 });
  after(() => readDocumentInBackground(hid, doc.data, true));
  return redirectTo("/to-check");
}
