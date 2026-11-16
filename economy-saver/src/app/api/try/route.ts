import { missingDatabase, NO_REFERRER, sameOriginOnly } from "@/lib/door";
import { redirectTo } from "@/lib/form-fetch";
import { verifiedUid } from "@/lib/auth-request";
import { db } from "@/db/client";
import { seedBen } from "@/db/seed";
import { currentHouseholdId, demoResponse } from "@/lib/session";
import { SETTINGS_ACCOUNT } from "@/lib/links";

export async function GET(request: Request) {
  const foreign = sameOriginOnly(request, "Same-origin navigation required");
  if (foreign) return foreign;
  try {
    if (await verifiedUid()) return redirectTo(SETTINGS_ACCOUNT, undefined, NO_REFERRER);
    const existing = await currentHouseholdId();
    if (existing) return await demoResponse(existing);
    return await demoResponse(await seedBen(db(), { isDemo: true }));
  } catch (error) {
    const missing = missingDatabase(error);
    if (missing) return missing;
    throw error;
  }
}
