import { privateRedirect, verifiedUid } from "@/lib/auth-request";
import { db, MissingDatabaseUrl } from "@/db/client";
import { demoCreationAllowed } from "@/db/rate-limit";
import { seedBen } from "@/db/seed";
import { currentHouseholdId, demoResponse, sameOrigin } from "@/lib/session";

export async function GET(request: Request) {
  if (!sameOrigin(request)) return new Response("Same-origin navigation required", { status: 403 });
  try {
    if (await verifiedUid()) return privateRedirect("/account");
    const existing = await currentHouseholdId();
    if (existing) return demoResponse(existing);
    if (!await demoCreationAllowed(db())) return new Response("Too many new demos right now. Try again in a few minutes.", { status: 429, headers: { "Retry-After": "300" } });
    return demoResponse(await seedBen(db(), { isDemo: true }));
  } catch (error) {
    if (error instanceof MissingDatabaseUrl) return new Response(error.message, { status: 503 });
    throw error;
  }
}
