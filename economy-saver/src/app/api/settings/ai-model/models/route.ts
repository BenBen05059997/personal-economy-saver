import { AiKeyError, modelListConnection } from "@/db/ai-key";
import { db } from "@/db/client";
import { withHousehold } from "@/db/household";
import { consumeRequest } from "@/db/rate-limit";
import { listModels, markListedModels } from "@/lib/ai/list-models";
import { providerFailureOf, providerFailureWords } from "@/lib/ai/provider-failure";
import { providerById } from "@/lib/ai/providers";
import { boundedForm, formText, NO_STORE, text, tooMany } from "@/lib/door";
import { ownerRequest } from "@/lib/session";

export async function POST(request: Request) {
  const hid = await ownerRequest(request);
  if (hid instanceof Response) {
    hid.headers.set("Cache-Control", NO_STORE["Cache-Control"]);
    return hid;
  }
  const connection = db();
  if (!await withHousehold(connection, hid, tx => consumeRequest(tx, hid, "ai-model-list", 20))) {
    return tooMany("Too many model list requests. Try again in a minute.");
  }
  const form = await boundedForm(request, 4096);
  if (!form) return text("That request is too large", 413);
  const provider = formText(form, "provider");
  try {
    const selected = await modelListConnection(connection, hid, { provider, baseUrl: formText(form, "baseUrl"), key: formText(form, "key") });
    return Response.json({ models: markListedModels(provider, await listModels(selected)) }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof AiKeyError) return text(error.message, 400);
    return text(providerFailureWords(providerFailureOf(error), provider === "custom" ? "your provider" : providerById(provider)?.label ?? "your provider"), 502);
  }
}
