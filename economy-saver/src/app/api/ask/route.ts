import { AiKeyError } from "@/db/ai-key";
import { answerQuestion, askInput } from "@/db/ask";
import { db } from "@/db/client";
import { consumeRequest } from "@/db/rate-limit";
import { AgentError } from "@/lib/agent/run";
import { NO_STORE, text } from "@/lib/door";
import { householdRequest } from "@/lib/session";
import { askUnavailable } from "@/lib/agent/availability";
import { MissingAuthSetting } from "@/lib/supabase-auth";

export async function POST(request: Request) {
  const hid = await householdRequest(request);
  if (hid instanceof Response) return hid;
  const data = askInput.safeParse(await request.json().catch(() => null));
  if (!data.success) return new Response("Enter a question of up to 320 characters.", { status: 400 });
  const connection = db();
  if (!await consumeRequest(connection, hid, "ask")) return text("Ask again in a minute.", 429, { "Retry-After": "60" });
  try {
    return Response.json(await answerQuestion(connection, hid, data.data), { headers: NO_STORE });
  } catch (error) {
    // These messages are fixed text or setting names, never secrets, so the person can read them.
    const known = error instanceof AgentError || error instanceof AiKeyError || error instanceof MissingAuthSetting;
    // A missing AI setting keeps its name (so the owner can fix it) inside a sentence a person can read.
    const missing = known ? /^(ANTHROPIC_[A-Z_]+) is not set$/.exec(error.message) : null;
    return text(missing ? askUnavailable(missing[1]) : known ? error.message : "Couldn't answer right now. Try again.", 503);
  }
}
