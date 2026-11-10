import { after } from "next/server";
import { z } from "zod";
import { householdForm, redirectTo, text } from "@/lib/door";
import { readDocumentInBackground } from "@/db/reader-background";

export async function POST(request: Request) {
  const ctx = await householdForm(request);
  if (ctx instanceof Response) return ctx;
  const { hid, form: body } = ctx;
  const doc = z.string().uuid().safeParse(body.get("id"));
  if (!doc.success) return text("Invalid document", 400);
  after(() => readDocumentInBackground(hid, doc.data, true));
  return redirectTo("/to-check");
}
