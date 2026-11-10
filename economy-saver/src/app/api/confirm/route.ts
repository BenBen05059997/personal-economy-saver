import { z } from "zod";
import { db } from "@/db/client";
import { readingForm, readingUnknown } from "@/lib/reader/form";
import { ReaderError } from "@/lib/reader/settings";
import { CHECK_ORDER, type CheckKind } from "@/lib/money/checks";
import { reviewReading } from "@/db/readings";
import { confirmPending } from "@/db/confirm";
import { householdForm, redirectTo, returnPath, text } from "@/lib/door";
import { ownChoiceFromForm } from "@/lib/reader/own-choices";
import { StatementChargeError } from "@/db/statement-charge";

const isCheckKind = (value: FormDataEntryValue): value is CheckKind => typeof value === "string" && (CHECK_ORDER as readonly string[]).includes(value);

export async function POST(request: Request) {
  const ctx = await householdForm(request);
  if (ctx instanceof Response) return ctx;
  const { hid, form } = ctx;
  const kind = form.get("kind");
  const id = z.string().uuid().safeParse(form.get("id"));
  if (!id.success) return text("Invalid item", 400);
  if (kind === "reading") {
    const decision = form.get("decision");
    if (decision !== "confirm" && decision !== "reject") return text("Invalid decision", 400);
    try {
      await reviewReading(db(), hid, id.data, decision === "reject" ? null : readingForm(form), decision === "reject" ? {} : readingUnknown(form), decision === "confirm" && form.get("remember") === "on",
        decision === "confirm" && form.get("from") === "ask" ? form.getAll("answered").filter(isCheckKind) : undefined, decision === "confirm" ? ownChoiceFromForm(form) : {});
    } catch (error) {
      if (error instanceof ReaderError || error instanceof StatementChargeError) return text(error.message, 400);
      return text("Reading could not be saved. Try again.", 503);
    }
    return redirectTo(form.has("returnTo") ? returnPath(form.get("returnTo")) : "/to-check", request);
  }
  if (kind !== "bill" && kind !== "charge" && kind !== "balance" && kind !== "pot") return text("Invalid item", 400);
  try { await confirmPending(db(), hid, kind, id.data); }
  catch (error) { return text(error instanceof StatementChargeError ? error.message : "Confirmation could not be saved. Try again.", error instanceof StatementChargeError ? 400 : 503); }
  return redirectTo(returnPath(form.get("returnTo")), request);
}
