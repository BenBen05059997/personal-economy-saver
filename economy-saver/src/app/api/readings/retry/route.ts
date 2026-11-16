import { after } from "next/server";
import { householdForm, text } from "@/lib/door";
import { redirectTo } from "@/lib/form-fetch";
import { readDocumentInBackground } from "@/db/reader-background";
import { Uuid } from "@/lib/stable-id";

export async function POST(request: Request) {
  const ctx = await householdForm(request);
  if (ctx instanceof Response) return ctx;
  const { hid, form: body } = ctx;
  const doc = Uuid.safeParse(body.get("id"));
  if (!doc.success) return text("Invalid document", 400);
  after(() => readDocumentInBackground(hid, doc.data, true));
  return redirectTo("/to-check");
}
