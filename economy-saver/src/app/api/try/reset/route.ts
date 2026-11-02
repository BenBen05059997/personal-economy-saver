import { db } from "@/db/client";
import { resetDemoHousehold } from "@/db/demo";
import { currentHouseholdId, demoResponse, sameOrigin } from "@/lib/session";
import { AiKeyError } from "@/db/ai-key";
import { ReaderError } from "@/lib/reader/settings";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return new Response("Same-origin request required", { status: 403 });
  const id = await currentHouseholdId();
  if (!id) return new Response("Demo session required", { status: 403 });
  let fresh: string | null;
  try { fresh = await resetDemoHousehold(db(), id); }
  catch (error) { return new Response(error instanceof AiKeyError || error instanceof ReaderError ? error.message : "Could not finish the reset. Your household is retained; try again.", { status: 503 }); }
  if (!fresh) return new Response("Demo session has expired", { status: 409 });
  return demoResponse(fresh);
}
