import { db } from "@/db/client";
import { connectionView } from "@/db/ai-key";
import { withHousehold } from "@/db/household";
import { missingAskSetting, serverHasNoModel } from "@/lib/agent/availability";
import { logVoice } from "@/lib/agent/log";
import { NO_STORE, text } from "@/lib/door";
import { householdRequest } from "@/lib/session";
import { fillByVoice, VoiceFillError } from "@/lib/voice/fill";
import { VoiceFillRequest } from "@/lib/voice/schema";

const MAX_BODY = 16 * 1024;

/** Reads at most MAX_BODY bytes of the body as the stream arrives; null when it is longer. */
async function readCapped(request: Request): Promise<string | null> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY) { await reader.cancel(); return null; }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}

/**
 * Voice fill (28B): `{ text, fields }` in (`VoiceFillRequest`), `{ values, heard, notes }` out. It only proposes values the code has
 * checked; nothing is written. No rate limit (the owner removed the AI caps).
 */
export async function POST(request: Request) {
  const hid = await householdRequest(request);
  if (hid instanceof Response) return hid;
  const raw = await readCapped(request);
  if (raw === null) return text("That is too long to fill a form from. Say less, or type the fields.", 413);
  let body: unknown = null;
  try { body = JSON.parse(raw); } catch { /* answered below */ }
  const data = VoiceFillRequest.safeParse(body);
  if (!data.success) return text("Say up to 400 characters, for a form of up to 20 fields.", 400);
  const connection = db();
  const view = await withHousehold(connection, hid, tx => connectionView(tx, hid));
  const missing = missingAskSetting(Boolean(view?.textModel));
  if (missing) return text(serverHasNoModel() ? "Voice fill needs an AI key in Settings → Your AI model. Type the fields instead."
    : `Voice fill needs an AI model on this server (${missing}). Type the fields instead.`, 503);
  const started = Date.now();
  try {
    const response = await fillByVoice(connection, hid, data.data);
    logVoice({ at: "voice", householdId: hid, fields: data.data.fields.length, ok: true, ms: Date.now() - started });
    return Response.json(response, { headers: NO_STORE });
  } catch (error) {
    logVoice({ at: "voice", householdId: hid, fields: data.data.fields.length, ok: false, ms: Date.now() - started });
    if (error instanceof VoiceFillError) return text(error.message, error.status);
    return text("Couldn't fill the form right now. Type the fields instead.", 502);
  }
}
