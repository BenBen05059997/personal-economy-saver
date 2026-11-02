import { z } from "zod";
import { db } from "@/db/client";
import { readingForm } from "@/lib/reader/form";
import { ReaderError } from "@/lib/reader/settings";
import { reviewReading } from "@/db/readings";
import { confirmPending } from "@/db/confirm";
import { currentHouseholdId, sameOrigin } from "@/lib/session";
import { StatementChargeError } from "@/db/statement-charge";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return new Response("Same-origin request required", { status: 403 });
  const hid = await currentHouseholdId();
  if (!hid) return new Response("Household session required", { status: 401 });
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
    return new Response(null, { status: 303, headers: { Location: "/to-check", "Cache-Control": "private, no-store" } });
  }
  if (kind !== "bill" && kind !== "charge") return new Response("Invalid item", { status: 400 });
  try { await confirmPending(db(), hid, kind, id.data); }
  catch (error) { return new Response(error instanceof StatementChargeError ? error.message : "Confirmation could not be saved. Try again.", { status: error instanceof StatementChargeError ? 400 : 503 }); }
  return new Response(null, { status: 303, headers: { Location: form.get("returnTo") === "/to-check" ? "/to-check" : "/", "Cache-Control": "private, no-store" } });
}
