// D59, D44: import. Reads a version 2 or 3 file into a household that has nothing in it yet, assigning new ids.
// Every restored row is marked made_by = import (memory items keep the maker they had, because a memory item can only be form, ask or mcp),
// and one event records it. Anything else is refused in words; a refused import changes nothing (one transaction).
//
// What is not restored, on purpose: the file's events (the audit trail starts here), documents (a file holds only references, never
// the file itself, so bills and charges lose their document link), the PayPal invoice ids of invoices (an id from a file must never
// become a key that PayPal's webhooks write to), and the household's own name, time zone, currency and exchange rate (the household
// keeps what it was set up with; a file in another currency is refused).
import { and, eq, sql } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { HouseholdSnapshot, SNAPSHOT_VERSION, type HouseholdSnapshot as Snapshot } from "@/lib/schema/household";
import { MAX_PINS } from "./canvases";
import { InputError } from "./input-error";
import { recordEvent, requireHousehold, type Db } from "./household";
import { MEMORY_LIMIT, hasLongNumber, SECRET_REFUSAL } from "@/lib/schema/memory";
import { generalSpace, SPACE_LIMIT } from "./spaces";
import { z } from "zod";
import { BriefSchema } from "@/lib/agent/brief";
import * as s from "./schema";

export const NOT_EMPTY = "Import works on an empty household. Start with my numbers first.";
export const OLD_VERSION = "This file is an older export (version 1). Import reads version 2 or 3 files. Export again from the app that made it, then import that file.";

type RestoreCounts = { members: number; cards: number; bills: number; charges: number; clients: number; invoices: number; pots: number; memory: number; canvases: number; journal: number; other: number };

/** The file's text, parsed with the schema. Anything else is refused with a sentence. */
export function readSnapshotFile(input: unknown): Snapshot {
  if (input && typeof input === "object" && (input as { version?: unknown }).version === 1) throw new InputError(OLD_VERSION);
  const version2 = input && typeof input === "object" && (input as { version?: unknown }).version === 2;
  const parsed = version2
    ? HouseholdSnapshot.omit({ spaces: true }).extend({ version: z.literal(2) }).safeParse(input)
    : HouseholdSnapshot.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path.map(part => (typeof part === "number" ? `#${part + 1}` : String(part))).join(" > ");
    throw new InputError(`This is not a household file Import can read${path ? ` (${path}: ${issue.message})` : ""}.`);
  }
  return { ...parsed.data, version: SNAPSHOT_VERSION };
}

function dbCode(error: unknown): string | undefined {
  for (let e: unknown = error, i = 0; e && typeof e === "object" && i < 4; e = (e as { cause?: unknown }).cause, i++) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return undefined;
}

async function insertChunks<T>(tx: Db, table: PgTable, rows: T[]) {
  for (let i = 0; i < rows.length; i += 250) await tx.insert(table).values(rows.slice(i, i + 250) as never);
}

/** Restores `input` (the parsed file) into household `householdId`. Returns what was added. */
export async function restoreHousehold(db: Db, householdId: string, input: unknown): Promise<RestoreCounts> {
  const hid = requireHousehold(householdId);
  const file = readSnapshotFile(input);
  if (Object.values(file.truncated).some(Boolean)) throw new InputError("This file holds only part of a household (it was cut to the most recent rows). Import needs a full export.");
  const owners = file.members.filter(m => m.role === "owner");
  if (owners.length !== 1) throw new InputError("This file needs exactly one owner among its people.");
  if (file.members.reduce((sum, m) => sum + m.shareBp, 0) !== 10_000) throw new InputError("The people's shares in this file do not add up to 100%.");
  const memory = file.memory ?? [], pins = file.canvases ?? [], journal = file.journal ?? [], spaces = file.spaces ?? [];
  if (memory.length > MEMORY_LIMIT || pins.length > MAX_PINS) throw new InputError("This file holds more memory or pinned canvases than the app keeps.");
  if (file.spaces && (spaces.filter(space => space.isGeneral).length !== 1 || spaces.filter(space => space.status === "open").length > SPACE_LIMIT))
    throw new InputError("This file needs one General space and up to 20 open spaces.");
  if (memory.some(item => hasLongNumber(item.text))) throw new InputError(SECRET_REFUSAL);

  try {
    return await db.transaction(async tx => {
      const [household] = await tx.select({ currency: s.households.homeCurrency }).from(s.households).where(eq(s.households.id, hid)).for("update");
      if (!household) throw new InputError("Household not found");
      if (household.currency !== file.household.homeCurrency) throw new InputError(`This file is in ${file.household.homeCurrency} and this household uses ${household.currency}.`);

      const existing = await tx.select({ id: s.members.id }).from(s.members).where(eq(s.members.householdId, hid));
      if (existing.length !== 1) throw new InputError(NOT_EMPTY);
      const ownerId = existing[0].id;
      for (const table of [s.bills, s.charges, s.cardStatements, s.clients, s.invoices, s.pots, s.settlements, s.balanceUpdates, s.memories, s.canvases, s.conversationTurns, s.documents] as const) {
        const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(table).where(eq(table.householdId, hid));
        if (n > 0) throw new InputError(NOT_EMPTY);
      }

      const general = await generalSpace(tx, hid);
      const named = await tx.select({ id: s.spaces.id }).from(s.spaces).where(and(eq(s.spaces.householdId, hid), eq(s.spaces.isGeneral, false))).limit(1);
      if (named.length || Object.keys(general.brief).length) throw new InputError(NOT_EMPTY);

      // One old to new table for every id in the file. The file's owner is the household's own owner (so the login keeps working).
      const fresh = new Map<string, string>([[owners[0].id, ownerId]]);
      const next = (old: string): string => {
        let id = fresh.get(old);
        if (!id) { id = crypto.randomUUID(); fresh.set(old, id); }
        return id;
      };
      const ref = (id: string): string => {
        const mapped = fresh.get(id);
        if (!mapped) throw new InputError("This file is not consistent with itself (a row refers to something it does not hold, or a value is out of range).");
        return mapped;
      };
      const sourceGeneral = spaces.find(space => space.isGeneral);
      if (sourceGeneral) fresh.set(sourceGeneral.id, general.id);
      const sourceSpaceIds = new Set(spaces.map(space => space.id));
      const spaceRef = (id: string | undefined) => {
        if (id === undefined) return null;
        if (!sourceSpaceIds.has(id)) throw new InputError("This file refers to a space it does not list.");
        return ref(id);
      };
      for (const list of [spaces, file.members, file.cards, file.clients, file.bills, file.statements, file.charges, file.invoices, file.pots, file.settlements, file.balanceUpdates, memory, pins, journal]) for (const row of list) next(row.id);
      for (const t of journal) next(t.conversationId);
      const briefFor = (raw: unknown) => {
        if (!raw || typeof raw !== "object" || Object.keys(raw).length === 0) return {};
        const brief = BriefSchema.parse(raw);
        const known = (ids: string[], rows: { id: string }[]) => ids.filter(id => rows.some(row => row.id === id)).map(ref);
        return {
          ...brief,
          state: brief.state.map(line => ({ ...line, source: fresh.get(line.source) ?? line.source })),
          refs: { bills: known(brief.refs.bills, file.bills), clients: known(brief.refs.clients, file.clients),
            pots: known(brief.refs.pots, file.pots), documents: [] },
        };
      };
      const importedSpaces = spaces.map(space => ({
        ...space, brief: briefFor(space.brief), id: ref(space.id), householdId: hid, createdAt: new Date(space.createdAt),
        briefUpdatedAt: space.briefUpdatedAt ? new Date(space.briefUpdatedAt) : null,
      }));
      await insertChunks(tx, s.spaces, importedSpaces.filter(space => !space.isGeneral));
      if (sourceGeneral) {
        await tx.update(s.spaces).set({
          brief: briefFor(sourceGeneral.brief), briefUpdatedBy: sourceGeneral.briefUpdatedBy,
          briefUpdatedAt: sourceGeneral.briefUpdatedAt ? new Date(sourceGeneral.briefUpdatedAt) : null,
        }).where(and(eq(s.spaces.householdId, hid), eq(s.spaces.id, general.id)));
      }
      // A recipe names clients and bills by id (sliders, what-if changes); a bill may be `<id>@<date>`.
      const remap = (value: unknown): unknown => {
        if (Array.isArray(value)) return value.map(remap);
        if (value && typeof value === "object") {
          return Object.fromEntries(Object.entries(value).map(([k, v]) => {
            if (typeof v === "string" && k === "clientId") return [k, fresh.get(v) ?? v];
            if (typeof v === "string" && k === "billId") { const [id, ...rest] = v.split("@"); return [k, [fresh.get(id) ?? id, ...rest].join("@")]; }
            return [k, remap(v)];
          }));
        }
        return value;
      };
      const person = fresh;
      const who = (id: string | null): string | null => {
        if (id === null) return null;
        const mapped = person.get(id);
        if (!mapped) throw new InputError("This file refers to a person it does not list.");
        return mapped;
      };
      await tx.update(s.members).set({ displayName: owners[0].displayName, shareBp: owners[0].shareBp }).where(and(eq(s.members.householdId, hid), eq(s.members.id, ownerId)));
      await insertChunks(tx, s.members, file.members.filter(m => m.role !== "owner").map(m => ({ id: ref(m.id), householdId: hid, displayName: m.displayName, role: m.role, shareBp: m.shareBp })));

      await tx.delete(s.cards).where(eq(s.cards.householdId, hid)); // the setup's card, if any: nothing can refer to it yet
      await insertChunks(tx, s.cards, file.cards.map(c => ({ ...c, id: ref(c.id), householdId: hid, memberId: who(c.memberId) })));

      await tx.update(s.households).set({ bankBalanceMinor: file.household.bankBalanceMinor, splitSince: file.members.length > 1 ? file.household.splitSince : null }).where(eq(s.households.id, hid));
      await tx.update(s.paypalConnections).set({ balanceMinor: file.household.paypalBalanceMinor }).where(and(eq(s.paypalConnections.householdId, hid), eq(s.paypalConnections.memberId, ownerId)));

      const made = { householdId: hid, madeBy: "import" as const };
      await insertChunks(tx, s.clients, file.clients.map(c => ({ ...c, id: ref(c.id), householdId: hid })));
      await insertChunks(tx, s.cardStatements, file.statements.map(x => ({ ...x, id: ref(x.id), cardId: ref(x.cardId), householdId: hid })));
      await insertChunks(tx, s.charges, file.charges.map(c => ({ ...c, id: ref(c.id), cardId: ref(c.cardId), ...made, documentId: null })));
      await insertChunks(tx, s.bills, file.bills.map(b => ({ ...b, id: ref(b.id), ...made, memberId: who(b.memberId), paidByMemberId: who(b.paidByMemberId), documentId: null, seriesBillId: null })));
      for (const b of file.bills) if (b.seriesBillId) await tx.update(s.bills).set({ seriesBillId: ref(b.seriesBillId) }).where(and(eq(s.bills.householdId, hid), eq(s.bills.id, ref(b.id))));
      await insertChunks(tx, s.invoices, file.invoices.map(i => ({ ...i, id: ref(i.id), clientId: ref(i.clientId), ...made, paypalInvoiceId: null, paypalStatus: null, remindedAt: i.remindedAt ? new Date(i.remindedAt) : null })));
      await insertChunks(tx, s.pots, file.pots.map(p => ({ ...p, id: ref(p.id), ...made, memberId: who(p.memberId) })));
      await insertChunks(tx, s.settlements, file.settlements.map(x => ({ ...x, id: ref(x.id), householdId: hid, fromMemberId: who(x.fromMemberId)!, toMemberId: who(x.toMemberId)!, settledAt: new Date(x.settledAt), createdAt: new Date(x.createdAt) })));
      await insertChunks(tx, s.balanceUpdates, file.balanceUpdates.map(u => ({ ...u, id: ref(u.id), ...made, createdAt: new Date(u.createdAt) })));
      await insertChunks(tx, s.memories, memory.map(m => ({ ...m, id: ref(m.id), householdId: hid, spaceId: spaceRef(m.spaceId), createdAt: new Date(m.createdAt), updatedAt: new Date(m.updatedAt) })));
      await insertChunks(tx, s.canvases, pins.map(p => ({
        id: ref(p.id), householdId: hid, title: p.title, recipe: remap(p.recipe), position: p.position, spaceId: spaceRef(p.spaceId), madeBy: "import" as const, createdAt: new Date(p.createdAt),
      })));
      await insertChunks(tx, s.conversationTurns, journal.map(t => ({
        id: ref(t.id), householdId: hid, conversationId: ref(t.conversationId), question: t.question, kind: t.kind, reply: t.reply, choices: t.choices, recipe: remap(t.recipe),
        sources: t.sources, thumb: t.thumb, createdAt: new Date(t.createdAt),
      })));

      const other = file.statements.length + file.settlements.length + file.balanceUpdates.length;
      const counts: RestoreCounts = {
        members: file.members.length, cards: file.cards.length, bills: file.bills.length, charges: file.charges.length, clients: file.clients.length,
        invoices: file.invoices.length, pots: file.pots.length, memory: memory.length, canvases: pins.length, journal: journal.length, other,
      };
      await recordEvent(tx, hid, { madeBy: "import", kind: "household_imported", title: "Imported a household file" });
      return counts;
    });
  } catch (error) {
    if (error instanceof InputError) throw error;
    const code = dbCode(error);
    if (code === "23503" || code === "23514" || code === "22P02" || code === "22007") throw new InputError("This file is not consistent with itself (a row refers to something it does not hold, or a value is out of range).");
    throw error;
  }
}
