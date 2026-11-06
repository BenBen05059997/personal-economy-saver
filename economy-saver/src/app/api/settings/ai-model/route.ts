import { db } from "@/db/client";
import { AiKeyError, deleteHouseholdConnection, saveHouseholdConnection } from "@/db/ai-key";
import { consumeRequest } from "@/db/rate-limit";
import { households } from "@/db/schema";
import { eq } from "drizzle-orm";
import { checkConnection } from "@/lib/ai/check";
import { NO_STORE, text } from "@/lib/door";
import { householdRequest } from "@/lib/session";

const field = (form: FormData, name: string) => { const v = form.get(name); return typeof v === "string" ? v : ""; };

export async function POST(request: Request) {
  const hid = await householdRequest(request);
  if (hid instanceof Response) return hid;
  if (!await consumeRequest(db(), hid, "ai-model", 6)) return text("Too many changes. Try again in a minute.", 429, { "Retry-After": "60" });
  const form = await smallForm(request, 4096);
  if (!form) return text("That request is too large", 413);
  try {
    if (field(form, "kind") === "default") {
      await deleteHouseholdConnection(db(), hid);
      return text("This household now uses the app’s default model.", 200, NO_STORE);
    }
    if (field(form, "kind") !== "save") return text("Check the fields and try again.", 400);
    const [household] = await db().select({ demo: households.isDemo }).from(households).where(eq(households.id, hid));
    await saveHouseholdConnection(db(), hid, {
      provider: field(form, "provider"), baseUrl: field(form, "baseUrl"), textModel: field(form, "textModel"),
      documentModel: field(form, "documentModel"), sameForDocuments: form.get("sameForDocuments") === "on", key: field(form, "key"),
    }, { signedIn: !household?.demo, check: connection => checkConnection(connection) });
    return text("Saved. Your questions and documents now go to your model.", 200, NO_STORE);
  } catch (error) {
    return text(error instanceof AiKeyError ? error.message : "Your AI model could not be saved", 400);
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
  try {
    return await new Response(body, { headers: { "content-type": request.headers.get("content-type") ?? "" } }).formData();
  } catch { return new FormData(); }
}
