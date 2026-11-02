import { answerQuestion, askInput } from "@/db/ask";
import { db } from "@/db/client";
import { consumeRequest } from "@/db/rate-limit";
import { currentHouseholdId, sameOrigin } from "@/lib/session";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return new Response("Same-origin request required", { status: 403 });
  const hid = await currentHouseholdId();
  if (!hid) return new Response("Household session required", { status: 401 });
  const data = askInput.safeParse(await request.json().catch(() => null));
  if (!data.success) return new Response("Enter a question of up to 320 characters.", { status: 400 });
  const connection = db();
  if (!await consumeRequest(connection, hid, "ask")) return new Response("Ask again in a minute.", { status: 429, headers: { "Retry-After": "60" } });
  return Response.json(await answerQuestion(connection, hid, data.data), { headers: { "Cache-Control": "private, no-store" } });
}
