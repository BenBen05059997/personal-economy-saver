import { z } from "zod";
import { ApprovalError, approvePaymentLink } from "@/db/approval";
import { householdClock } from "@/db/account";
import { db } from "@/db/client";
import { usdRate, withHousehold } from "@/db/household";
import { fromRateMicro } from "@/db/money";
import { createOrder } from "@/lib/paypal/send";
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
  const input = z.object({ approve_key: z.string().uuid(), action: z.literal("send") }).safeParse(Object.fromEntries(form));
  if (!input.success) return text("Invalid approval", 400);
  const { today, rateMicro } = await withHousehold(connection, householdId, async tx => {
    const { today, currency } = await householdClock(tx, householdId);
    return { today, ...await usdRate(tx, householdId, currency, today) };
  });
  try {
    const id = await approvePaymentLink({ db: connection, householdId, today, usdRate: fromRateMicro(rateMicro),
      approveKey: input.data.approve_key, createOrder });
    return redirectTo(`/invoices/${id}`, request);
  } catch (error) {
    if (error instanceof ApprovalError) return text(error.message, error.status);
    return text("PayPal did not confirm the payment link. Open the invoice again to check its status or retry.", 502);
  }
}
