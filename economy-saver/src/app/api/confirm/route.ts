import { z } from "zod";
import { db } from "@/db/client";
import { readingForm, readingUnknown } from "@/lib/reader/form";
import { ReaderError } from "@/lib/reader/settings";
import { CHECK_ORDER, type CheckKind } from "@/lib/money/checks";
import { reviewReading } from "@/db/readings";
import { confirmPending } from "@/db/confirm";
import { redirectTo, returnPath, formOf } from "@/lib/door";
import { ownChoiceFromForm } from "@/lib/reader/own-choices";
import { householdRequest } from "@/lib/session";
import { StatementChargeError } from "@/db/statement-charge";

const isCheckKind = (value: FormDataEntryValue): value is CheckKind => typeof value === "string" && (CHECK_ORDER as readonly string[]).includes(value);

export async function POST(request: Request) {
  const hid = await householdRequest(request);
  if (hid instanceof Response) return hid;
  const form = await formOf(request);
  if (form instanceof Response) return form;
  const kind = form.get("kind");
  const id = z.string().uuid().safeParse(form.get("id"));
  if (!id.success) return new Response("Invalid item", { status: 400 });
  if (kind === "reading") {
    const decision = form.get("decision");
    if (decision !== "confirm" && decision !== "reject") return new Response("Invalid decision", { status: 400 });
    try {
      await reviewReading(db(), hid, id.data, decision === "reject" ? null : readingForm(form), decision === "reject" ? {} : readingUnknown(form), decision === "confirm" && form.get("remember") === "on",
        decision === "confirm" && form.get("from") === "ask" ? form.getAll("answered").filter(isCheckKind) : undefined, decision === "confirm" ? ownChoiceFromForm(form) : {});
    } catch (error) {
      if (error instanceof ReaderError || error instanceof StatementChargeError) return new Response(error.message, { status: 400 });
      return new Response("Reading could not be saved. Try again.", { status: 503 });
    }
    return redirectTo(form.has("returnTo") ? returnPath(form.get("returnTo")) : "/to-check", request);
  }
  if (kind !== "bill" && kind !== "charge" && kind !== "balance" && kind !== "pot") return new Response("Invalid item", { status: 400 });
  try { await confirmPending(db(), hid, kind, id.data); }
  catch (error) { return new Response(error instanceof StatementChargeError ? error.message : "Confirmation could not be saved. Try again.", { status: error instanceof StatementChargeError ? 400 : 503 }); }
  return redirectTo(returnPath(form.get("returnTo")), request);
}
