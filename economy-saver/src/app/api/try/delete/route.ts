import { sameOriginOnly, text, NO_REFERRER, redirectTo } from "@/lib/door";
import { db } from "@/db/client";
import { deleteDemoHousehold } from "@/db/demo";
import { currentHouseholdId } from "@/lib/session";
import { AiKeyError } from "@/db/ai-key";
import { ReaderError } from "@/lib/reader/settings";

/** Deletes the Try it household this browser's cookie resolves to, now instead of at the sweep; a household that is not a demo is refused. */
export async function POST(request: Request) {
  const foreign = sameOriginOnly(request);
  if (foreign) return foreign;
  const id = await currentHouseholdId();
  if (!id) return text("Demo session required", 403);
  let deleted: boolean;
  try { deleted = await db().transaction(tx => deleteDemoHousehold(tx, id)); }
  catch (error) { return text(error instanceof AiKeyError || error instanceof ReaderError ? error.message : "Could not delete the Try it household. Try again.", 503); }
  if (!deleted) return text("Demo session required", 403);
  const response = redirectTo("/", request, NO_REFERRER);
  response.cookies.delete("household");
  response.cookies.delete("upgrade-demo");
  return response;
}
