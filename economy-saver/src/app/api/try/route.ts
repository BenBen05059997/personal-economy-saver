import { privateRedirect, verifiedUid } from "@/lib/auth-request";
import { db, MissingDatabaseUrl } from "@/db/client";
import { ClientIpError, TRY_PER_HOUR, clientIp, consumeIpRequest, demoCreationAllowed } from "@/db/rate-limit";
import { seedBen } from "@/db/seed";
import { tooMany } from "@/lib/door";
import { currentHouseholdId, demoResponse, sameOrigin } from "@/lib/session";

export async function GET(request: Request) {
  if (!sameOrigin(request)) return new Response("Same-origin navigation required", { status: 403 });
  try {
    if (await verifiedUid()) return privateRedirect("/account");
    const existing = await currentHouseholdId();
    if (existing) return demoResponse(existing);
    // Per client address, ahead of the app-wide cap: a visitor who already has a demo household is sent back to it above.
    if (!await consumeIpRequest(db(), clientIp(request), "try", TRY_PER_HOUR)) return tooMany("Too many new demos from this connection. Try again in an hour.");
    if (!await demoCreationAllowed(db())) return new Response("Too many new demos right now. Try again in a few minutes.", { status: 429, headers: { "Retry-After": "300" } });
    return demoResponse(await seedBen(db(), { isDemo: true }));
  } catch (error) {
    if (error instanceof MissingDatabaseUrl) return new Response(error.message, { status: 503 });
    if (error instanceof ClientIpError) return new Response(error.message, { status: error.status });
    throw error;
  }
}
