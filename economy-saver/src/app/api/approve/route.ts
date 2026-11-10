import { z } from "zod";
import { logSettingProblem } from "@/lib/operator-log";
import { ApprovalError, approveInvoice } from "@/db/approval";
import { householdClock } from "@/db/account";
import { db } from "@/db/client";
import { usdRate, withHousehold } from "@/db/household";
import { fromRateMicro } from "@/db/money";
import { env } from "@/lib/env";
import { runTool } from "@/lib/paypal/toolkit";
import { formOf, limited, redirectTo, text } from "@/lib/door";
import { ownerRequest } from "@/lib/session";

export async function POST(request: Request) {
  const householdId = await ownerRequest(request);
  if (householdId instanceof Response) return householdId;
  const connection = db();
  const busy = await limited(householdId, "approve", 10, "Approval limit reached. Try again in a minute.", connection);
  if (busy) return busy;
  const form = await formOf(request);
  if (form instanceof Response) return form;
  const input = z.object({ approve_key: z.string().uuid(), action: z.enum(["send", "remind"]) }).safeParse(Object.fromEntries(form));
  if (!input.success) return text("Invalid approval", 400);
  let recipient;
  try {
    recipient = env().SANDBOX_CLIENT_EMAIL;
  } catch (error) {
    logSettingProblem("approve_env_not_ready", (error as Error).message, householdId);
    return text("PayPal is not available right now. Try again later.", 503);
  }
  if (!recipient) {
    logSettingProblem("approve_env_not_ready", "SANDBOX_CLIENT_EMAIL is not set", householdId);
    return text("PayPal is not available right now. Try again later.", 503);
  }
  const { today, rateMicro } = await withHousehold(connection, householdId, async tx => {
    const { today, currency } = await householdClock(tx, householdId);
    return { today, ...await usdRate(tx, householdId, currency, today) };
  });
  try {
    const id = await approveInvoice({ db: connection, householdId, today, usdRate: fromRateMicro(rateMicro),
      approveKey: input.data.approve_key, recipient, tool: runTool }, input.data.action);
    return redirectTo(`/invoices/${id}`, request);
  } catch (error) {
    if (error instanceof ApprovalError) return text(error.message, error.status);
    return text(input.data.action === "remind"
      ? "PayPal did not confirm the reminder. Check its delivery in the sandbox."
      : "PayPal did not confirm the send. Open the invoice again to check its status or retry.", 502);
  }
}
