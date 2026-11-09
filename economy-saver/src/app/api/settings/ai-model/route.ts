import { withHousehold } from "@/db/household";
import { db } from "@/db/client";
import { AiKeyError, deleteHouseholdConnection, saveHouseholdConnection } from "@/db/ai-key";
import { consumeRequest } from "@/db/rate-limit";
import { households } from "@/db/schema";
import { eq } from "drizzle-orm";
import { checkConnection } from "@/lib/ai/check";
import { boundedForm, formText, NO_STORE, text, tooMany } from "@/lib/door";
import { ownerRequest } from "@/lib/session";

export async function POST(request: Request) {
  const hid = await ownerRequest(request);
  if (hid instanceof Response) return hid;
  if (!await withHousehold(db(), hid, tx => consumeRequest(tx, hid, "ai-model", 6))) return tooMany("Too many changes. Try again in a minute.");
  const form = await boundedForm(request, 4096);
  if (!form) return text("That request is too large", 413);
  try {
    if (formText(form, "kind") === "default") {
      await deleteHouseholdConnection(db(), hid);
      return text("This household now uses the app’s default model.", 200, NO_STORE);
    }
    if (formText(form, "kind") !== "save") return text("Check the fields and try again.", 400);
    const [household] = await withHousehold(db(), hid, async tx => tx.select({ demo: households.isDemo }).from(households).where(eq(households.id, hid)));
    await saveHouseholdConnection(db(), hid, {
      provider: formText(form, "provider"), baseUrl: formText(form, "baseUrl"), textModel: formText(form, "textModel"),
      documentModel: formText(form, "documentModel"), sameForDocuments: form.get("sameForDocuments") === "on", key: formText(form, "key"),
    }, { signedIn: !household?.demo, check: connection => checkConnection(connection) });
    return text("Saved. Your questions and documents now go to your model.", 200, NO_STORE);
  } catch (error) {
    return text(error instanceof AiKeyError ? error.message : "Your AI model could not be saved", 400);
  }
}
