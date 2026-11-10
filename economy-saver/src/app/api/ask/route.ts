import { AiKeyError } from "@/db/ai-key";
import { answerQuestion, askInput } from "@/db/ask";
import { db } from "@/db/client";
import { withHousehold } from "@/db/household";
import { InputError } from "@/db/input-error";
import { consumeRequest } from "@/db/rate-limit";
import { AgentError } from "@/lib/agent/run";
import { NO_STORE, text, tooMany } from "@/lib/door";
import { householdRequest } from "@/lib/session";
import { askUnavailable, NEEDS_KEY, serverHasNoModel } from "@/lib/agent/availability";
import { MissingAuthSetting } from "@/lib/supabase-auth";

// D59: device questions carry notes, a brief, and a bounded local history.
const MAX_BODY = 128 * 1024;
const MAX_DEVICE_BODY = 512 * 1024;
const tooLarge = () => text("That is more than one question can carry. Delete some of what the assistant remembers, or ask in a new space.", 400);

/** One question of the Ask conversation (D60): `{ id, conversationId, text, source, screen?, canvas }` in, the reply (`AskReply`) out. */
export async function POST(request: Request) {
  const hid = await householdRequest(request);
  if (hid instanceof Response) return hid;
  const raw = await request.text();
  const bytes = new TextEncoder().encode(raw).length;
  if (bytes > MAX_DEVICE_BODY) return tooLarge();
  let body: unknown = null;
  try { body = JSON.parse(raw); } catch { /* answered below */ }
  const data = askInput.safeParse(body);
  if (bytes > MAX_BODY && (!data.success || (data.data.memory === undefined && data.data.recent === undefined))) return tooLarge();
  if (!data.success) return text("Enter a question of up to 320 characters.", 400);
  const connection = db();
  if (!await withHousehold(connection, hid, tx => consumeRequest(tx, hid, "ask"))) return tooMany("Ask again in a minute.");
  // After these checks the answer is one stream of JSON lines: `{"step":"…"}` lines, then `{"reply": AskReply}` or `{"error": "…"}`.
  // An InputError raised before the first model call (the question does not fit the household) is still a plain 400.
  const encoder = new TextEncoder();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({ start(c) { controller = c; } });
  let closed = false;
  const send = (line: object) => { if (!closed) controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`)); };
  let began!: (value: "began") => void;
  const start = new Promise<"began">(resolve => { began = resolve; });
  const finished = answerQuestion(connection, hid, data.data, { onStep: step => { began("began"); send({ step }); } })
    .then(reply => ({ reply }), (error: unknown) => ({ error }));
  const first = await Promise.race([start, finished]);
  if (first !== "began" && "error" in first && first.error instanceof InputError) return text(first.error.message, 400);
  void finished.then(last => {
    send("reply" in last ? { reply: last.reply } : { error: errorWords(last.error) });
    closed = true;
    controller.close();
  });
  return new Response(stream, { headers: { ...NO_STORE, "Content-Type": "application/x-ndjson" } });
}

function errorWords(error: unknown): string {
  if (error instanceof InputError) return error.message;
  // These messages are fixed text or setting names, never secrets, so the person can read them.
  const known = error instanceof AgentError || error instanceof AiKeyError || error instanceof MissingAuthSetting;
  // A missing AI setting keeps its name (so the owner can fix it) inside a sentence a person can read.
  const missing = known ? /^(AI_[A-Z_]+) is not set$/.exec(error.message) : null;
  return missing ? (serverHasNoModel() ? NEEDS_KEY : askUnavailable(missing[1])) : known ? error.message : "Couldn't answer right now. Try again.";
}
