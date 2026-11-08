import { z } from "zod";
import { ConversationTurn } from "@/lib/schema/turn";

export const THREAD_CONTEXT_MAX = 12_000;

export const ContextTurn = ConversationTurn.pick({
  id: true, conversationId: true, spaceId: true, question: true, reply: true, kind: true, documentId: true, createdAt: true,
}).strip();
export type ContextTurn = z.infer<typeof ContextTurn>;

export function turnWords(turn: ContextTurn): string {
  return JSON.stringify({ question: turn.question, reply: turn.reply, ...(turn.documentId && { documentId: turn.documentId }) });
}

/** Keep the newest complete lines from an oldest-first thread. Cards are attached separately. */
export function contextTail(input: readonly ContextTurn[]): { turns: ContextTurn[]; omitted: number } {
  let size = 0;
  let start = input.length;
  while (start > 0) {
    const next = turnWords(input[start - 1]).length + (start === input.length ? 0 : 1);
    if (size + next > THREAD_CONTEXT_MAX) break;
    size += next;
    start--;
  }
  return { turns: input.slice(start).map(turn => ContextTurn.parse(turn)), omitted: start };
}

/** A searchable copy of the newest local turns that fit in the device request. It stays out of the model prompt until a search. */
export function historyTail(input: readonly ContextTurn[]): ContextTurn[] {
  const encoder = new TextEncoder();
  const kept: ContextTurn[] = [];
  let size = 2;
  const newest = [...input].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  for (const raw of newest) {
    const turn = ContextTurn.parse(raw);
    const length = encoder.encode(JSON.stringify(turn)).length + 1;
    if (size + length > 64 * 1024) break;
    size += length;
    kept.push(turn);
  }
  return kept.reverse();
}
