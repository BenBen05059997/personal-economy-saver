import { NO_REFERRER, redirectTo, sameOriginOnly, text } from "@/lib/door";
import { verifiedUid } from "@/lib/auth-request";
import { db, MissingDatabaseUrl } from "@/db/client";
import { seedBen } from "@/db/seed";
import { currentHouseholdId, demoResponse } from "@/lib/session";

export async function GET(request: Request) {
  const foreign = sameOriginOnly(request, "Same-origin navigation required");
  if (foreign) return foreign;
  try {
    if (await verifiedUid()) return redirectTo("/account", undefined, NO_REFERRER);
    const existing = await currentHouseholdId();
    if (existing) return await demoResponse(existing);
    return await demoResponse(await seedBen(db(), { isDemo: true }));
  } catch (error) {
    if (error instanceof MissingDatabaseUrl) return text(error.message, 503);
    throw error;
  }
}
