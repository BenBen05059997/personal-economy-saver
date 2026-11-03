import { z } from "zod";
import { ApprovalError, approveInvoice } from "@/db/approval";
import { householdDate } from "@/db/account";
import { db } from "@/db/client";
import { loadMoneyState } from "@/db/household";
import { consumeRequest } from "@/db/rate-limit";
import { env } from "@/lib/env";
import { runTool } from "@/lib/paypal/toolkit";
import { currentHouseholdId, sameOrigin } from "@/lib/session";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return new Response("Same-origin request required", { status: 403 });
  const householdId = await currentHouseholdId();
  if (!householdId) return new Response("Household session required", { status: 401 });
  if (!await consumeRequest(db(), householdId, "approve", 10)) return new Response("Approval limit reached. Try again in a minute.", { status: 429, headers: { "Retry-After": "60" } });
  const form = await request.formData();
  const input = z.object({ approve_key: z.string().uuid(), action: z.enum(["send", "remind"]) }).safeParse(Object.fromEntries(form));
  if (!input.success) return new Response("Invalid approval", { status: 400 });
  let recipient;
  try {
    recipient = env().SANDBOX_CLIENT_EMAIL;
  } catch (error) {
    // env() reports only setting names and validation messages.
    return new Response((error as Error).message, { status: 503 });
  }
  if (!recipient) return new Response("SANDBOX_CLIENT_EMAIL is not set", { status: 503 });
  const connection = db();
  const today = await householdDate(connection, householdId);
  const state = await loadMoneyState(connection, householdId, today);
  try {
    const id = await approveInvoice({ db: connection, householdId, today, usdRate: state.fxPerUsd,
      approveKey: input.data.approve_key, recipient, tool: runTool }, input.data.action);
    return new Response(null, { status: 303, headers: { Location: `/invoices/${id}`, "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ApprovalError) return new Response(error.message, { status: error.status });
    return new Response(input.data.action === "remind"
      ? "PayPal did not confirm the reminder. Check its delivery in the sandbox."
      : "PayPal did not confirm the send. Open the invoice again to check its status or retry.", { status: 502 });
  }
}
