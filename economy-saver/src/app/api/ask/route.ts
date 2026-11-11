import { logSettingProblem } from "@/lib/operator-log";
import { AiKeyError } from "@/db/ai-key";
import { answerQuestion, askInput } from "@/db/ask";
import { db } from "@/db/client";
import { InputError } from "@/db/input-error";
import { AgentError } from "@/lib/agent/run";
import { NO_STORE, limited, text } from "@/lib/door";
import { householdRequest } from "@/lib/session";

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
  const busy = await limited(hid, "ask", undefined, "Ask again in a minute.", connection);
  if (busy) return busy;
  // After these checks the answer is one stream of JSON lines: `{"step":"…"}` lines, then `{"reply": AskReply}` or `{"error": "…"}`.
  // An InputError raised before the first model call (the question does not fit the household) is still a plain 400.
  const encoder = new TextEncoder();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let closed = false;
  // A client that leaves mid-answer cancels the stream: from then on nothing is written, and the run still finishes and saves the turn.
  const stream = new ReadableStream<Uint8Array>({ start(c) { controller = c; }, cancel() { closed = true; } });
  const send = (line: object) => {
    if (closed) return;
    try { controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`)); } catch { closed = true; }
  };
  let began!: (value: "began") => void;
  const start = new Promise<"began">(resolve => { began = resolve; });
  const finished = answerQuestion(connection, hid, data.data, { onStep: step => { began("began"); send({ step }); } })
    .then(reply => ({ reply }), (error: unknown) => ({ error }));
  const first = await Promise.race([start, finished]);
  if (first !== "began" && "error" in first && first.error instanceof InputError) return text(first.error.message, 400);
  void finished.then(last => {
    send("reply" in last ? { reply: last.reply } : { error: errorWords(last.error) });
    if (closed) return;
    closed = true;
    try { controller.close(); } catch { /* the client already left */ }
  });
  return new Response(stream, { headers: { ...NO_STORE, "Content-Type": "application/x-ndjson" } });
}

function errorWords(error: unknown): string {
  if (error instanceof InputError) return error.message;
  if (error instanceof MissingAuthSetting) logSettingProblem("ask_auth_not_set_up", error.message);
  // These messages are fixed words for the person; a missing setting's name went to the operator log where it was found.
  return error instanceof AgentError || error instanceof AiKeyError ? error.message : "Couldn't answer right now. Try again.";
}
