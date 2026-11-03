import { db } from "@/db/client";
import { draftInput, saveInvoiceDraft } from "@/db/invoice-draft";
import { consumeRequest } from "@/db/rate-limit";
import { currentHouseholdId, sameOrigin } from "@/lib/session";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return new Response("Same-origin request required", { status: 403 });
  const hid = await currentHouseholdId();
  if (!hid) return new Response("Household session required", { status: 401 });
  if (!await consumeRequest(db(), hid, "draft", 20)) return new Response("Draft limit reached. Try again in a minute.", { status: 429, headers: { "Retry-After": "60" } });
  const data = draftInput.safeParse(Object.fromEntries(await request.formData()));
  if (!data.success || Number(data.data.amount) <= 0) return new Response("Enter a client, item and positive USD amount.", { status: 400 });
  try {
    const id = await saveInvoiceDraft(db(), hid, data.data);
    return new Response(null, { status: 303, headers: { Location: `/invoices/${id}`, "Cache-Control": "no-store" } });
  } catch {
    return new Response("Could not save this draft. Check the client and try again.", { status: 409 });
  }
}
