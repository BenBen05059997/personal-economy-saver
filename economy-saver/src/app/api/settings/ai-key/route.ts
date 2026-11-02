import { db } from "@/db/client";
import { AiKeyError, deleteHouseholdKey, saveHouseholdKey } from "@/db/ai-key";
import { currentHouseholdId, sameOrigin } from "@/lib/session";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return new Response("Same-origin request required", { status: 403 });
  const hid = await currentHouseholdId();
  if (!hid) return new Response("Household session required", { status: 401 });
  if (Number(request.headers.get("content-length")) > 4096) return new Response("Key request is too large", { status: 413 });
  const form = await request.formData();
  try {
    if (form.get("remove") === "yes") await db().transaction(tx => deleteHouseholdKey(tx, hid));
    else {
      const key = form.get("key");
      if (typeof key !== "string") return new Response("An Anthropic API key is required", { status: 400 });
      await saveHouseholdKey(db(), hid, key.trim());
    }
    return new Response("AI key settings saved", { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return new Response(error instanceof AiKeyError ? error.message : "AI key settings could not be saved", { status: 400 });
  }
}
