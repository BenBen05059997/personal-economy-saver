import { sameOriginOnly, text } from "@/lib/door";
import { db } from "@/db/client";
import { resetDemoHousehold } from "@/db/demo";
import { currentHouseholdId, demoResponse } from "@/lib/session";
import { AiKeyError } from "@/db/ai-key";
import { ReaderError } from "@/lib/reader/settings";

export async function POST(request: Request) {
  const foreign = sameOriginOnly(request);
  if (foreign) return foreign;
  const id = await currentHouseholdId();
  if (!id) return text("Demo session required", 403);
  let fresh: string | null;
  try { fresh = await resetDemoHousehold(db(), id); }
  catch (error) { return text(error instanceof AiKeyError || error instanceof ReaderError ? error.message : "Could not finish the reset. Your household is retained; try again.", 503); }
  if (!fresh) return text("Demo session has expired", 409);
  return demoResponse(fresh, request);
}
