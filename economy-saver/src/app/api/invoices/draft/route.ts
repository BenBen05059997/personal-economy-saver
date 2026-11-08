import { db } from "@/db/client";
import { withHousehold } from "@/db/household";
import { draftInput, saveInvoiceDraft } from "@/db/invoice-draft";
import { InputError } from "@/db/input-error";
import { consumeRequest } from "@/db/rate-limit";
import { failure, formOf, redirectTo, text, tooMany } from "@/lib/door";
import { householdRequest } from "@/lib/session";

export async function POST(request: Request) {
  const hid = await householdRequest(request);
  if (hid instanceof Response) return hid;
  if (!await withHousehold(db(), hid, tx => consumeRequest(tx, hid, "draft", 20))) return tooMany("Draft limit reached. Try again in a minute.");
  const body = await formOf(request);
  if (body instanceof Response) return body;
  const data = draftInput.safeParse(Object.fromEntries(body));
  if (!data.success) return text("Enter a client, item and positive USD amount.", 400);
  try {
    const id = await withHousehold(db(), hid, tx => saveInvoiceDraft(tx, hid, data.data, { madeBy: "form" }));
    return redirectTo(`/invoices/${id}`, request);
  } catch (error) {
    return error instanceof InputError ? failure(error) : text("Could not save this draft. Check the client and try again.", 409);
  }
}
