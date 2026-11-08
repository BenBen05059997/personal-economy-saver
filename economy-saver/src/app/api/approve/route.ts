import { z } from "zod";
import { ApprovalError, approveInvoice } from "@/db/approval";
import { householdClock } from "@/db/account";
import { db } from "@/db/client";
import { usdRate } from "@/db/household";
import { fromRateMicro } from "@/db/money";
import { consumeRequest } from "@/db/rate-limit";
import { env } from "@/lib/env";
import { runTool } from "@/lib/paypal/toolkit";
import { formOf, redirectTo } from "@/lib/door";
import { ownerRequest } from "@/lib/session";

export async function POST(request: Request) {
  const householdId = await ownerRequest(request);
  if (householdId instanceof Response) return householdId;
  if (!await consumeRequest(db(), householdId, "approve", 10)) return new Response("Approval limit reached. Try again in a minute.", { status: 429, headers: { "Retry-After": "60" } });
  const form = await formOf(request);
  if (form instanceof Response) return form;
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
  const { today, currency } = await householdClock(connection, householdId);
  const { rateMicro } = await usdRate(connection, householdId, currency, today);
  try {
    const id = await approveInvoice({ db: connection, householdId, today, usdRate: fromRateMicro(rateMicro),
      approveKey: input.data.approve_key, recipient, tool: runTool }, input.data.action);
    return redirectTo(`/invoices/${id}`, request);
  } catch (error) {
    if (error instanceof ApprovalError) return new Response(error.message, { status: error.status });
    return new Response(input.data.action === "remind"
      ? "PayPal did not confirm the reminder. Check its delivery in the sandbox."
      : "PayPal did not confirm the send. Open the invoice again to check its status or retry.", { status: 502 });
  }
}
