import { db } from "@/db/client";
import { recordLinkOffered } from "@/db/invoice-offered";
import { badFields, failure, householdForm, limited, text } from "@/lib/door";
import { NO_STORE } from "@/lib/form-fetch";
import { Uuid } from "@/lib/stable-id";

/** The person copied an invoice's payment link to send it. Any member of the household may post this. */
export async function POST(request: Request) {
  const ctx = await householdForm(request);
  if (ctx instanceof Response) return ctx;
  const { hid, form } = ctx;
  const busy = await limited(hid, "offered", 30, "Too many copies. Try again in a minute.");
  if (busy) return busy;
  const id = Uuid.safeParse(form.get("id"));
  if (!id.success) return badFields();
  try {
    if (!await recordLinkOffered(db(), hid, id.data)) return text("This invoice has no payment link to offer.", 409);
    return new Response(null, { status: 204, headers: NO_STORE });
  } catch (error) {
    return failure(error);
  }
}
