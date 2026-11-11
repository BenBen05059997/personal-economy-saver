import { logSettingProblem } from "@/lib/operator-log";
/**
 * A reader problem in the words the person sees. `status` is what a route answers: 400 for a problem with the person's file or form
 * (the default), 503 when the server lacks a setting or a service it needs (the setting's name goes to the operator log, not the message), 502 when a service
 * the server calls (the model, Storage) failed.
 */
export class ReaderError extends Error {
  constructor(message: string, readonly status: 400 | 502 | 503 = 400) { super(message); }
}

export function readerSetting(name: string) {
  const value = process.env[name]?.trim();
  if (!value) { logSettingProblem("reader_not_set_up", `${name} is not set`); throw new ReaderError("Reading and forwarding bills isn’t set up on this server.", 503); }
  return value;
}

export const MAX_DOCUMENT_BYTES = 6 * 1024 * 1024;

export async function limitedBody(request: Request, limit: number): Promise<ArrayBuffer> {
  const reader = request.body?.getReader();
  if (!reader) throw new ReaderError("A document is required.");
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > limit) {
      await reader.cancel();
      throw new ReaderError("Document exceeds the 6 MiB limit.");
    }
    chunks.push(value);
  }
  const data = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }
  return data.buffer;
}
