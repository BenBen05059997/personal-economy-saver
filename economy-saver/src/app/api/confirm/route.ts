import { z } from "zod";
import { db } from "@/db/client";
import { readingForm } from "@/lib/reader/form";
import { ReaderError } from "@/lib/reader/settings";
import { reviewReading } from "@/db/readings";
import { confirmPending } from "@/db/confirm";
import { redirectTo, returnPath } from "@/lib/door";
import { householdRequest } from "@/lib/session";
import { StatementChargeError } from "@/db/statement-charge";

export async function POST(request: Request) {
  const hid = await householdRequest(request);
  if (hid instanceof Response) return hid;
  const form = await request.formData();
  const kind = form.get("kind");
  const id = z.string().uuid().safeParse(form.get("id"));
  if (!id.success) return new Response("Invalid item", { status: 400 });
  if (kind === "reading") {
    const decision = form.get("decision");
    if (decision !== "confirm" && decision !== "reject") return new Response("Invalid decision", { status: 400 });
    try {
      await reviewReading(db(), hid, id.data, decision === "reject" ? null : readingForm(form));
    } catch (error) {
      if (error instanceof ReaderError || error instanceof StatementChargeError) return new Response(error.message, { status: 400 });
      return new Response("Reading could not be saved. Try again.", { status: 503 });
    }
    return redirectTo("/to-check");
  }
  if (kind !== "bill" && kind !== "charge" && kind !== "balance" && kind !== "pot") return new Response("Invalid item", { status: 400 });
  try { await confirmPending(db(), hid, kind, id.data); }
  catch (error) { return new Response(error instanceof StatementChargeError ? error.message : "Confirmation could not be saved. Try again.", { status: error instanceof StatementChargeError ? 400 : 503 }); }
  return redirectTo(returnPath(form.get("returnTo")));
}
