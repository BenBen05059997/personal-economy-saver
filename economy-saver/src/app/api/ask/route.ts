import { AiKeyError } from "@/db/ai-key";
import { answerQuestion, askInput } from "@/db/ask";
import { db } from "@/db/client";
import { InputError } from "@/db/input-error";
import { consumeRequest } from "@/db/rate-limit";
import { AgentError } from "@/lib/agent/run";
import { NO_STORE, text, tooMany } from "@/lib/door";
import { householdRequest } from "@/lib/session";
import { askUnavailable } from "@/lib/agent/availability";
import { MissingAuthSetting } from "@/lib/supabase-auth";

// D59: a question that carries the memory and the recent turns from a device still fits in 128 KiB.
const MAX_BODY = 128 * 1024;

/** One question of the Ask conversation (D60): `{ id, conversationId, text, source, canvas }` in, the reply (`AskReply`) out. */
export async function POST(request: Request) {
  const hid = await householdRequest(request);
  if (hid instanceof Response) return hid;
  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > MAX_BODY) return text("That is more than one question can carry. Delete some of what the assistant remembers, or start a new conversation.", 400);
  let body: unknown = null;
  try { body = JSON.parse(raw); } catch { /* answered below */ }
  const data = askInput.safeParse(body);
  if (!data.success) return text("Enter a question of up to 320 characters.", 400);
  const connection = db();
  if (!await consumeRequest(connection, hid, "ask")) return tooMany("Ask again in a minute.");
  try {
    return Response.json(await answerQuestion(connection, hid, data.data), { headers: NO_STORE });
  } catch (error) {
    if (error instanceof InputError) return text(error.message, 400);
    // These messages are fixed text or setting names, never secrets, so the person can read them.
    const known = error instanceof AgentError || error instanceof AiKeyError || error instanceof MissingAuthSetting;
    // A missing AI setting keeps its name (so the owner can fix it) inside a sentence a person can read.
    const missing = known ? /^(AI_[A-Z_]+) is not set$/.exec(error.message) : null;
    return text(missing ? askUnavailable(missing[1]) : known ? error.message : "Couldn't answer right now. Try again.", 503);
  }
}
