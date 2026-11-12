import { logSettingProblem } from "@/lib/operator-log";
import { db } from "@/db/client";
import { connectionView } from "@/db/ai-key";
import { withHousehold } from "@/db/household";
import { missingAskSetting, serverHasNoModel } from "@/lib/agent/availability";
import { logVoice } from "@/lib/agent/log";
import { QUESTIONS_USED_UP, spendAiBudget } from "@/db/ai-cap";
import { boundedText, NO_STORE, text, tooMany } from "@/lib/door";
import { householdRequest } from "@/lib/session";
import { fillByVoice, VoiceFillError } from "@/lib/voice/fill";
import { VoiceFillRequest } from "@/lib/voice/schema";

const MAX_BODY = 16 * 1024;

/**
 * Voice fill (28B): `{ text, fields }` in (`VoiceFillRequest`), `{ values, heard, notes }` out. It only proposes values the code has
 * checked; nothing is written. On the owner's connection it spends the household's daily question budget (D33).
 */
export async function POST(request: Request) {
  const hid = await householdRequest(request);
  if (hid instanceof Response) return hid;
  const raw = await boundedText(request, MAX_BODY);
  if (raw === null) return text("That is too long to fill a form from. Say less, or type the fields.", 413);
  let body: unknown = null;
  try { body = JSON.parse(raw); } catch { /* answered below */ }
  const data = VoiceFillRequest.safeParse(body);
  if (!data.success) return text("Say up to 400 characters, for a form of up to 20 fields.", 400);
  const connection = db();
  const view = await withHousehold(connection, hid, tx => connectionView(tx, hid));
  const missing = missingAskSetting(Boolean(view?.textModel));
  if (missing) logSettingProblem("voice_fill_not_set_up", `${missing} is not set`, hid);
  if (missing) return text(serverHasNoModel() ? "Voice fill needs an AI key in Settings → Your AI model. Type the fields instead."
    : "Voice fill isn’t set up on this server. Type the fields instead.", 503);
  // D33: a voice fill spends from the same daily budget as a question on the owner's connection.
  if (!await spendAiBudget(connection, hid, "question")) return tooMany(QUESTIONS_USED_UP.replace("asked", "used"));
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
