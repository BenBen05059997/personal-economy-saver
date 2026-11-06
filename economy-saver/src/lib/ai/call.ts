import { callAnthropic } from "./anthropic";
import { checkBaseUrl, localAllowed } from "./endpoint";
import { callOpenAI } from "./openai";
import type { ModelRequest, Reply } from "./types";

/** The ONE way the app calls a model. No retries: every attempt must reserve its own allowance. */
export async function callModel(request: ModelRequest): Promise<Reply> {
  // Defence in depth: the address was checked when it was saved, and is checked again on every call.
  const raw = process.env.APP_URL?.trim();
  const appUrl = request.appUrl ?? (raw ? new URL(raw) : undefined);
  checkBaseUrl(request.connection.baseUrl, { allowLocal: appUrl ? localAllowed(appUrl) : false });
  return request.connection.protocol === "anthropic" ? callAnthropic(request) : callOpenAI(request);
}
