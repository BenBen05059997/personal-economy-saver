import { db } from "@/db/client";
import { AiKeyError, deleteHouseholdKey, saveHouseholdKey } from "@/db/ai-key";
import { currentHouseholdId, sameOrigin } from "@/lib/session";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return new Response("Same-origin request required", { status: 403 });
  const hid = await currentHouseholdId();
  if (!hid) return new Response("Household session required", { status: 401 });
  const form = await smallForm(request, 4096);
  if (!form) return new Response("Key request is too large", { status: 413 });
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

// Reads at most `limit` bytes whatever Content-Length says (a chunked body has none), then parses the form.
async function smallForm(request: Request, limit: number): Promise<FormData | null> {
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (reader) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    body.set(chunk, at);
    at += chunk.byteLength;
  }
  return new Response(body, { headers: { "content-type": request.headers.get("content-type") ?? "" } }).formData();
}
