import { HOUSEHOLD_COOKIE, UPGRADE_DEMO_COOKIE } from "@/lib/supabase-auth";
import { DEMO_SESSION_REQUIRED, NO_REFERRER, sameOriginOnly, settingFailure, text } from "@/lib/door";
import { redirectTo } from "@/lib/form-redirect";
import { db } from "@/db/client";
import { deleteDemoHousehold } from "@/db/demo";
import { currentHouseholdId } from "@/lib/session";

/** Deletes the Try it household this browser's cookie resolves to, now instead of at the sweep; a household that is not a demo is refused. */
export async function POST(request: Request) {
  const foreign = sameOriginOnly(request);
  if (foreign) return foreign;
  const id = await currentHouseholdId();
  if (!id) return text(DEMO_SESSION_REQUIRED, 403);
  let deleted: boolean;
  try { deleted = await db().transaction(tx => deleteDemoHousehold(tx, id)); }
  catch (error) { return settingFailure(error, "Could not delete the Try it household. Try again."); }
  if (!deleted) return text(DEMO_SESSION_REQUIRED, 403);
  const response = redirectTo("/", request, NO_REFERRER);
  response.cookies.delete(HOUSEHOLD_COOKIE);
  response.cookies.delete(UPGRADE_DEMO_COOKIE);
  return response;
}
