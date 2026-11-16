import { DEMO_SESSION_REQUIRED, sameOriginOnly, settingFailure, text } from "@/lib/door";
import { db } from "@/db/client";
import { resetDemoHousehold } from "@/db/demo";
import { currentHouseholdId, DEMO_SESSION_EXPIRED, demoResponse } from "@/lib/session";

export async function POST(request: Request) {
  const foreign = sameOriginOnly(request);
  if (foreign) return foreign;
  const id = await currentHouseholdId();
  if (!id) return text(DEMO_SESSION_REQUIRED, 403);
  let fresh: string | null;
  try { fresh = await resetDemoHousehold(db(), id); }
  catch (error) { return settingFailure(error, "Could not finish the reset. Your household is retained; try again."); }
  if (!fresh) return text(DEMO_SESSION_EXPIRED, 409);
  return demoResponse(fresh, request);
}
