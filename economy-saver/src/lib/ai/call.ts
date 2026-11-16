import { callAnthropic } from "./anthropic";
import { checkBaseUrl, localCallsAllowed } from "./endpoint";
import { callOpenAI } from "./openai";
import type { ModelRequest, Reply } from "./types";

/** The ONE way the app calls a model. No retries: every attempt asks for its own connection. */
export async function callModel(request: ModelRequest): Promise<Reply> {
  // Defence in depth: the address was checked when it was saved, and is checked again on every call.
  checkBaseUrl(request.connection.baseUrl, { allowLocal: localCallsAllowed(request.appUrl) });
  return request.connection.protocol === "anthropic" ? callAnthropic(request) : callOpenAI(request);
}
