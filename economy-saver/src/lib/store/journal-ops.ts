// D59, D60: the operations on the conversation turns and the pinned canvases, as pure functions over a list, for the device store.
// The same rules as src/db/conversation.ts (all turns stay; the last three live turns are the context)
// and src/db/canvases.ts (at most 8, position 0 first).
import { CONTEXT_TURNS, live, type ConversationTurn } from "@/lib/schema/turn";
import { MAX_PINS, recipeOf, titleOf, type Recipe } from "@/lib/canvas/schema";
import { InputError } from "@/db/input-error";

const byTime = (a: ConversationTurn, b: ConversationTurn) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);

/** True when a turn of the conversation named a document the page knows is still waiting (being read, or a reading in To check). */
const holdsWaiting = (turns: ConversationTurn[], waiting: ReadonlySet<string>): boolean => turns.some(turn => !!turn.documentId && waiting.has(turn.documentId));

/** Adds one turn (a retried question has the same id, so it is one turn), oldest first. */
export function appendTurn(turns: ConversationTurn[], turn: ConversationTurn): ConversationTurn[] {
  return [...turns.filter(item => item.id !== turn.id), turn].sort(byTime);
}

export const threadOf = (turns: ConversationTurn[], id: string) => turns.filter(turn => turn.conversationId === id).sort(byTime);

/** Pre-space threads stay grouped under General and are named by their first question. */
export function legacyOf(turns: ConversationTurn[], spaceIds: ReadonlySet<string>): { id: string; question: string }[] {
  const groups = new Map<string, { id: string; question: string }>();
  for (const turn of [...turns].sort(byTime)) {
    if (!turn.spaceId && !spaceIds.has(turn.conversationId) && !groups.has(turn.conversationId)) {
      groups.set(turn.conversationId, { id: turn.conversationId, question: turn.question });
    }
  }
  return [...groups.values()].reverse();
}

/** The conversation's last three turns, oldest first, when its latest turn is under ten minutes old (24 hours while a document attached in it is waiting); otherwise none. */
export function recentOf(turns: ConversationTurn[], conversationId: string, now: Date, waiting: ReadonlySet<string> = new Set()): ConversationTurn[] {
  const own = threadOf(turns, conversationId);
  if (own.length === 0 || !live(own[own.length - 1].createdAt, now, holdsWaiting(own, waiting))) return [];
  return own.slice(-CONTEXT_TURNS);
}

/** The newest conversation with all its turns, when its last turn is under ten minutes old; otherwise null. */
export function latestOf(turns: ConversationTurn[], now: Date, waiting: ReadonlySet<string> = new Set()): { conversationId: string; turns: ConversationTurn[] } | null {
  const sorted = [...turns].sort(byTime);
  const last = sorted[sorted.length - 1];
  if (!last) return null;
  const own = sorted.filter(turn => turn.conversationId === last.conversationId);
  if (!live(last.createdAt, now, holdsWaiting(own, waiting))) return null;
  return { conversationId: last.conversationId, turns: own };
}

/** A canvas pinned on this device: the saved layout and nothing else. */
export type DevicePin = { id: string; title: string; recipe: Recipe; position: number; createdAt: string; spaceId?: string | null };

export const orderedPins = (pins: DevicePin[]) => [...pins].sort((a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt));
const renumber = (pins: DevicePin[]): DevicePin[] => pins.map((pin, position) => ({ ...pin, position }));

/** Pins a canvas last. The ninth is refused. */
export function pinItem(pins: DevicePin[], input: { title: string; recipe: unknown; spaceId?: string | null }, now: Date, id: string): DevicePin[] {
  if (pins.length >= MAX_PINS) throw new InputError("Unpin one first.");
  const ordered = orderedPins(pins);
  return [...ordered, { id, title: titleOf(input.title), recipe: recipeOf(input.recipe), position: (ordered.at(-1)?.position ?? -1) + 1,
    createdAt: now.toISOString(), ...(input.spaceId != null && { spaceId: input.spaceId }) }];
}

/** Replaces a pin's recipe. Null when the id is not in the list. */
export function updatePin(pins: DevicePin[], id: string, recipe: unknown): DevicePin[] | null {
  if (!pins.some(pin => pin.id === id)) return null;
  const checked = recipeOf(recipe);
  return orderedPins(pins).map(pin => (pin.id === id ? { ...pin, recipe: checked } : pin));
}

/** Moves a pin one place up (towards 0) or down. Null when the id is not in the list; past an end changes nothing. */
export function movePin(pins: DevicePin[], id: string, direction: "up" | "down", generalId?: string): DevicePin[] | null {
  const all = orderedPins(pins);
  const at = all.findIndex(pin => pin.id === id);
  if (at < 0) return null;
  const own = all[at].spaceId ?? generalId;
  const peers = all.flatMap((pin, index) => (pin.spaceId ?? generalId) === own ? [index] : []);
  const to = peers[peers.indexOf(at) + (direction === "up" ? -1 : 1)];
  if (to === undefined) return renumber(all);
  [all[at], all[to]] = [all[to], all[at]];
  return renumber(all);
}

/** Removes a pin and closes the gap. Null when the id is not in the list. */
export function unpinItem(pins: DevicePin[], id: string): DevicePin[] | null {
  if (!pins.some(pin => pin.id === id)) return null;
  return renumber(orderedPins(pins).filter(pin => pin.id !== id));
}
