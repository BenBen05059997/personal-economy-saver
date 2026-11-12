import { z } from "zod";
import { ApprovalError } from "@/db/approval";
import { db } from "@/db/client";
import { payInvoiceAsTestClient } from "@/db/try-pay";
import { formOf, limited, redirectTo, text } from "@/lib/door";
import { payWithSandboxTestCard } from "@/lib/paypal/send";
import { ownerRequest } from "@/lib/session";

/** A Try it household's judge plays the client: pays the sent invoice with PayPal's sandbox test card. Never for any other household. */
export async function POST(request: Request) {
  const householdId = await ownerRequest(request);
  if (householdId instanceof Response) return householdId;
  const connection = db();
  const busy = await limited(householdId, "try-pay", 10, "Too many payments. Try again in a minute.", connection);
  if (busy) return busy;
  const form = await formOf(request);
  if (form instanceof Response) return form;
  const input = z.object({ id: z.string().uuid() }).safeParse(Object.fromEntries(form));
  if (!input.success) return text("Invalid invoice", 400);
  try {
    const id = await payInvoiceAsTestClient({ db: connection, householdId, invoiceId: input.data.id, pay: payWithSandboxTestCard });
    return redirectTo(`/invoices/${id}`, request);
  } catch (error) {
    if (error instanceof ApprovalError) return text(error.message, error.status);
    return text("PayPal did not confirm the test-card payment. Open the invoice again to check its status or retry.", 502);
  }
}
