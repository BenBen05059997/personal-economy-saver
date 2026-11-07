import type { AskReply } from "@/db/ask";

/** What /api/ask streams after its checks: step lines, then one `{ reply }` or `{ error }` line (newline-delimited JSON). */
export type AskLine = { step: string } | { reply: AskReply } | { error: string };

/** Reads the stream line by line; `onStep` hears each step's words. Returns the final line, or null when the stream ended without one. */
export async function readAskStream(response: Response, onStep: (step: string) => void): Promise<{ reply: AskReply } | { error: string } | null> {
  const reader = response.body?.getReader();
  if (!reader) return null;
  const decoder = new TextDecoder();
  let buffer = "";
  let last: { reply: AskReply } | { error: string } | null = null;
  const take = (line: string) => {
    if (!line.trim()) return;
    const parsed = JSON.parse(line) as AskLine;
    if ("step" in parsed) onStep(parsed.step); else last = parsed;
  };
  for (;;) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    lines.forEach(take);
    if (done) break;
  }
  take(buffer);
  return last;
}
