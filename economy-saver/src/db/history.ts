// D70: past turns and notes are quoted on demand. Each cloud search is tenant-scoped; a device copy is read only when sent.
import { and, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { ContextTurn } from "@/lib/agent/context";
import type { MemoryItem } from "@/lib/schema/memory";
import { requireHousehold, withHousehold, type Db } from "./household";
import { InputError } from "./input-error";
import { readPlaces } from "./place";
import { conversationTurns, memories, spaces } from "./schema";
import type { Space } from "./spaces";

export const HistoryInput = z.object({
  text: z.string().trim().min(1).max(160).regex(/^[^\r\n]+$/).describe("A word or phrase to look for, in any language."),
  space: z.string().trim().min(1).max(120).nullish().describe("A space id or its exact name. Omit or pass null to search all history."),
}).strict();
type HistoryInput = z.infer<typeof HistoryInput>;
type HistoryHit = { kind: typeof TURN | typeof MEMORY; id: string; space: string; date: string; line: string };
type HistoryKind = "journal" | "memory";
type HistoryResult = { hits: HistoryHit[]; unavailable: HistoryKind[] };
type Candidate = Omit<HistoryHit, "line"> & { text: string[] };
type DeviceHistory = { turns?: readonly (ContextTurn & { spaceId?: string })[]; notes?: readonly MemoryItem[] };
const MAX_HITS = 10;
const TURN = "turn";
const MEMORY = "memory";

/** History includes archived spaces. An exact name with multiple matches needs an id to disambiguate. */
export async function resolveMemorySpace(db: Db, householdId: string, value: string): Promise<Space> {
  const hid = requireHousehold(householdId), term = value.trim();
  return withHousehold(db, hid, async tx => {
    const isId = z.string().uuid().safeParse(term).success;
    const rows = await tx.select().from(spaces).where(and(eq(spaces.householdId, hid), isId
      ? eq(spaces.id, term) : sql`lower(${spaces.name}) = lower(${term})`)).limit(2);
    if (rows.length > 1) throw new InputError("More than one space has that name. Choose its id.");
    if (!rows.length) throw new InputError("Choose a space from this household.");
    return rows[0];
  });
}

async function cloudTurns(tx: Db, hid: string, pattern: string, space: Space | undefined): Promise<Candidate[]> {
  const turn = conversationTurns;
  const inSpace = space ? (space.isGeneral ? or(eq(turn.conversationId, space.id), isNull(spaces.id)) : eq(turn.conversationId, space.id)) : undefined;
  const rows = await tx.select({ id: turn.id, at: turn.createdAt, space: spaces.name, question: turn.question, reply: turn.reply })
    .from(turn).leftJoin(spaces, and(eq(spaces.householdId, turn.householdId), eq(spaces.id, turn.conversationId)))
    .where(and(eq(turn.householdId, hid), inSpace, or(ilike(turn.question, pattern), ilike(turn.reply, pattern))))
    .orderBy(desc(turn.createdAt), desc(turn.id)).limit(MAX_HITS);
  return rows.map(row => ({ kind: TURN, id: row.id, space: row.space ?? "General", date: row.at.toISOString(), text: [row.question, row.reply] }));
}

async function cloudNotes(tx: Db, hid: string, pattern: string, space: Space | undefined): Promise<Candidate[]> {
  const rows = await tx.select({ id: memories.id, at: memories.createdAt, space: spaces.name, text: memories.text })
    .from(memories).leftJoin(spaces, and(eq(spaces.householdId, memories.householdId), eq(spaces.id, memories.spaceId)))
    .where(and(eq(memories.householdId, hid), space && eq(memories.spaceId, space.id), ilike(memories.text, pattern)))
    .orderBy(desc(memories.createdAt), desc(memories.id)).limit(MAX_HITS);
  return rows.map(row => ({ kind: MEMORY, id: row.id, space: row.space ?? "Profile", date: row.at.toISOString(), text: [row.text] }));
}

function localCandidates(
  names: ReadonlyMap<string, string>, space: Space | undefined,
  turns: NonNullable<DeviceHistory["turns"]>, notes: NonNullable<DeviceHistory["notes"]>,
): Candidate[] {
  const inTurns = turns.flatMap((turn): Candidate[] => {
    const name = names.get(turn.conversationId);
    if (turn.spaceId && (turn.spaceId !== turn.conversationId || !name)) return [];
    if (space && !(turn.conversationId === space.id || space.isGeneral && !name)) return [];
    return [{ kind: TURN, id: turn.id, date: turn.createdAt, space: name ?? "General", text: [turn.question, turn.reply] }];
  });
  const inNotes = notes.flatMap((note): Candidate[] => {
    const name = note.spaceId ? names.get(note.spaceId) : "Profile";
    if (!name || space && note.spaceId !== space.id) return [];
    return [{ kind: MEMORY, id: note.id, date: note.createdAt, space: name, text: [note.text] }];
  });
  return [...inTurns, ...inNotes];
}

export async function searchHistory(db: Db, householdId: string, input: HistoryInput, device: DeviceHistory = {}): Promise<HistoryResult> {
  const hid = requireHousehold(householdId);
  const checked = HistoryInput.safeParse(input);
  if (!checked.success) throw new InputError("Enter a single word or phrase to find in your history.");
  const { text, space: wanted } = checked.data;
  const needle = text.toLowerCase();
  // PostgreSQL LIKE treats these three characters specially. Match a literal substring, with pg_trgm backing the predicates.
  const pattern = "%" + text.replace(/[\\%_]/g, "\\$&") + "%";
  return withHousehold(db, hid, async tx => {
    const [places, space] = await Promise.all([
      readPlaces(tx, hid), wanted ? resolveMemorySpace(tx, hid, wanted) : undefined,
    ]);
    const turns = places.journal === "device" ? device.turns : undefined;
    const notes = places.memory === "device" ? device.notes : undefined;
    const [savedTurns, savedNotes, named] = await Promise.all([
      places.journal === "cloud" ? cloudTurns(tx, hid, pattern, space) : [],
      places.memory === "cloud" ? cloudNotes(tx, hid, pattern, space) : [],
      turns?.length || notes?.length
        ? tx.select({ id: spaces.id, name: spaces.name }).from(spaces).where(eq(spaces.householdId, hid)) : [],
    ]);
    const names = new Map(named.map(row => [row.id, row.name]));
    const candidates = [...savedTurns, ...savedNotes, ...localCandidates(names, space, turns ?? [], notes ?? [])];
    const hits = candidates.flatMap(({ text: lines, ...row }): HistoryHit[] => {
      const line = lines.flatMap(part => part.split(/\r?\n/)).find(part => part.toLowerCase().includes(needle));
      return line === undefined ? [] : [{ ...row, line }];
    });
    hits.sort((a, b) => Date.parse(b.date) - Date.parse(a.date) || b.id.localeCompare(a.id));
    const unavailable: HistoryKind[] = [];
    if (places.journal === "device" && !turns) unavailable.push("journal");
    if (places.memory === "device" && !notes) unavailable.push("memory");
    return { hits: hits.slice(0, MAX_HITS), unavailable };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}
