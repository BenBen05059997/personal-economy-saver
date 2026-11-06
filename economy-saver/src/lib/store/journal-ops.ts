// D59, D60: the operations on the conversation turns and the pinned canvases, as pure functions over a list, for the device store.
// The same rules as src/db/conversation.ts (200 turns, a conversation carries on for ten minutes, the last three turns are the context)
// and src/db/canvases.ts (at most 8, position 0 first).
import { CONTEXT_TURNS, live, TURN_LIMIT, type ConversationTurn } from "@/lib/schema/turn";
import { MAX_PINS, recipeOf, titleOf, type Recipe } from "@/lib/canvas/schema";
import { InputError } from "@/db/input-error";

const byTime = (a: ConversationTurn, b: ConversationTurn) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);

/** Adds one turn (a retried question has the same id, so it is one turn), oldest first, then drops the oldest beyond 200. */
export function appendTurn(turns: ConversationTurn[], turn: ConversationTurn): ConversationTurn[] {
  const all = [...turns.filter(item => item.id !== turn.id), turn].sort(byTime);
  return all.slice(Math.max(0, all.length - TURN_LIMIT));
}

/** The conversation's last three turns, oldest first, when its latest turn is under ten minutes old; otherwise none. */
export function recentOf(turns: ConversationTurn[], conversationId: string, now: Date): ConversationTurn[] {
  const own = turns.filter(turn => turn.conversationId === conversationId).sort(byTime);
  if (own.length === 0 || !live(own[own.length - 1].createdAt, now)) return [];
  return own.slice(-CONTEXT_TURNS);
}

/** The newest conversation with all its turns, when its last turn is under ten minutes old; otherwise null. */
export function latestOf(turns: ConversationTurn[], now: Date): { conversationId: string; turns: ConversationTurn[] } | null {
  const sorted = [...turns].sort(byTime);
  const last = sorted[sorted.length - 1];
  if (!last || !live(last.createdAt, now)) return null;
  return { conversationId: last.conversationId, turns: sorted.filter(turn => turn.conversationId === last.conversationId) };
}

/** A canvas pinned on this device: the saved layout and nothing else. */
export type DevicePin = { id: string; title: string; recipe: Recipe; position: number; createdAt: string };

export const orderedPins = (pins: DevicePin[]) => [...pins].sort((a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt));
const renumber = (pins: DevicePin[]): DevicePin[] => pins.map((pin, position) => ({ ...pin, position }));

/** Pins a canvas last. The ninth is refused. */
export function pinItem(pins: DevicePin[], input: { title: string; recipe: unknown }, now: Date, id: string): DevicePin[] {
  if (pins.length >= MAX_PINS) throw new InputError("Unpin one first.");
  return [...orderedPins(pins), { id, title: titleOf(input.title), recipe: recipeOf(input.recipe), position: pins.length, createdAt: now.toISOString() }];
}

/** Replaces a pin's recipe. Null when the id is not in the list. */
export function updatePin(pins: DevicePin[], id: string, recipe: unknown): DevicePin[] | null {
  if (!pins.some(pin => pin.id === id)) return null;
  const checked = recipeOf(recipe);
  return orderedPins(pins).map(pin => (pin.id === id ? { ...pin, recipe: checked } : pin));
}

/** Moves a pin one place up (towards 0) or down. Null when the id is not in the list; past an end changes nothing. */
export function movePin(pins: DevicePin[], id: string, direction: "up" | "down"): DevicePin[] | null {
  const all = orderedPins(pins);
  const at = all.findIndex(pin => pin.id === id);
  if (at < 0) return null;
  const to = direction === "up" ? at - 1 : at + 1;
  if (to < 0 || to >= all.length) return renumber(all);
  [all[at], all[to]] = [all[to], all[at]];
  return renumber(all);
}

/** Removes a pin and closes the gap. Null when the id is not in the list. */
export function unpinItem(pins: DevicePin[], id: string): DevicePin[] | null {
  if (!pins.some(pin => pin.id === id)) return null;
  return renumber(orderedPins(pins).filter(pin => pin.id !== id));
}
