import { setting } from "@/lib/env";
import { documentLimitMessage } from "@/lib/document-limit";
import { readBounded } from "@/lib/form-fetch";
import { logSettingProblem } from "@/lib/operator-log";
/**
 * A reader problem in the words the person sees. `status` is what a route answers: 400 for a problem with the person's file or form
 * (the default), 503 when the server lacks a setting or a service it needs (the setting's name goes to the operator log, not the message), 502 when a service
 * the server calls (the model, Storage) failed.
 */
export class ReaderError extends Error {
  constructor(message: string, readonly status: 400 | 429 | 502 | 503 = 400) { super(message); }
}

export function readerSetting(name: string) {
  const value = setting(name);
  if (!value) { logSettingProblem("reader_not_set_up", `${name} is not set`); throw new ReaderError("Reading and forwarding bills isn’t set up on this server.", 503); }
  return value;
}

export async function limitedBody(request: Request, limit: number): Promise<ArrayBuffer> {
  if (!request.body) throw new ReaderError("A document is required.");
  const body = await readBounded(request, limit);
  if (!body) throw new ReaderError(documentLimitMessage("Document"));
  return body.buffer as ArrayBuffer;
}
