// D69: spaces have one permanent General, their own thread, and household-scoped lifecycle and export.
// PGlite only. Every fixture is fictional and no model, network or credentials are needed.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { and, eq } from "drizzle-orm";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { drizzle } from "drizzle-orm/pglite";
import { createHousehold, finishSetup } from "@/db/account";
import { listCanvases, pinCanvas } from "@/db/canvases";
import { legacyThreads, saveTurn, spaceThread, type NewTurn } from "@/db/conversation";
import { countKind, deleteKind } from "@/db/data-kinds";
import type { Db } from "@/db/household";
import { InputError } from "@/db/input-error";
import { restoreHousehold } from "@/db/restore";
import * as schema from "@/db/schema";
import { seedBen } from "@/db/seed";
import { loadHouseholdSnapshot } from "@/db/snapshot";
import { archiveSpace, createSpace, deleteSpace, generalSpace, listSpaces, renameSpace, saveBrief } from "@/db/spaces";

const settings = { name: "Fictional owner", timeZone: "Asia/Tokyo", currency: "USD" as const, bank: "1000", limit: "" };
const recipe = { version: 1, title: "Cash now", blocks: [{ type: "number", label: "Cash today", query: { q: "cash" } }] };
const snapshotOptions = { events: false, stored: true };
const turn = (conversationId: string, question: string): NewTurn => ({
  id: randomUUID(), conversationId, question, kind: "answer", reply: "Here is the forecast.",
  choices: null, recipe: null, sources: [],
});

async function main() {
  const pg = new PGlite({ extensions: { pg_trgm } });
  const db = drizzle(pg, { schema });
  const store = db as unknown as Db;
  let passed = 0;
  async function check(name: string, run: () => Promise<void>) {
    await run(); passed++; console.log("✓ " + name);
  }

  try {
    const steps = readMigrationFiles({ migrationsFolder: "./drizzle" });
    for (const migration of steps.slice(0, 30)) await pg.transaction(async tx => {
      for (const statement of migration.sql) await tx.exec(statement);
    });

    const legacy = randomUUID(), conversation = randomUUID(), anotherConversation = randomUUID();
    await pg.query("insert into households (id, name, home_currency) values ($1, 'Fictional legacy household', 'USD')", [legacy]);
    await pg.query(`insert into conversation_turns (id, household_id, conversation_id, question, kind, reply)
      values ($1, $2, $3, 'How is rent?', 'answer', 'Rent is due this month.'),
      ($4, $2, $5, 'When is the statement?', 'answer', 'Look in Cards.')`, [randomUUID(), legacy, conversation, randomUUID(), anotherConversation]);
    for (const migration of steps.slice(30)) await pg.transaction(async tx => {
      for (const statement of migration.sql) await tx.exec(statement);
    });

    await check("0030 adds General to an existing household and keeps its legacy conversations intact", async () => {
      const general = await generalSpace(store, legacy);
      assert.equal(general.name, "General");
      assert.equal(general.status, "open");
      assert.deepEqual((await listSpaces(store, legacy)).map(s => s.id), [general.id]);
      assert.deepEqual((await legacyThreads(store, legacy)).map(s => s.id).sort(), [conversation, anotherConversation].sort());
      assert.deepEqual((await spaceThread(store, legacy, conversation)).map(t => [t.conversationId, t.question]), [[conversation, "How is rent?"]]);
      assert.deepEqual(await spaceThread(store, legacy, general.id), []);
    });

    await check("0030 keeps older household inserts working and installs all three trigram indexes", async () => {
      const oldWriter = randomUUID();
      await pg.query("insert into households (id, name, home_currency) values ($1, 'Fictional old worker', 'USD')", [oldWriter]);
      assert.equal((await generalSpace(store, oldWriter)).name, "General");
      await pg.query("delete from households where id = $1", [oldWriter]);
      assert.deepEqual(await listSpaces(store, oldWriter), []);
      const { rows } = await pg.query<{ indexname: string }>(
        "select indexname from pg_indexes where schemaname = 'public' and indexdef like '%USING gin%gin_trgm_ops%' order by indexname",
      );
      assert.deepEqual(rows.map(row => row.indexname), [
        "conversation_turns_question_trgm_idx", "conversation_turns_reply_trgm_idx", "memories_text_trgm_idx",
      ]);
    });

    const demo = await seedBen(db, { isDemo: true });
    const blank = await createHousehold(store, randomUUID(), settings, { isDemo: true });
    const signedIn = await finishSetup(store, randomUUID(), settings, null);
    await check("Try it, Start with my numbers and a signed-in household each get one permanent General", async () => {
      for (const hid of [demo, blank, signedIn]) {
        const [general, ...rest] = await listSpaces(store, hid);
        assert.deepEqual(rest, []);
        assert.deepEqual([general.name, general.status, general.isGeneral], ["General", "open", true]);
        assert.equal((await generalSpace(store, hid)).id, general.id);
        await assert.rejects(renameSpace(store, hid, general.id, "Fictional renamed General"), InputError);
        await assert.rejects(archiveSpace(store, hid, general.id), InputError);
        await assert.rejects(deleteSpace(store, hid, general.id), InputError);
      }
    });

    await check("the twentieth open space fits, another is refused, and archiving frees one place", async () => {
      const created = [];
      for (let i = 1; i <= 18; i++) created.push(await createSpace(store, demo, `Fictional task ${i}`));
      const attempts = await Promise.allSettled([
        createSpace(store, demo, "Fictional task 19"),
        createSpace(store, demo, "Fictional task 20"),
      ]);
      assert.equal(attempts.filter(r => r.status === "fulfilled").length, 1);
      assert.ok(attempts.some(r => r.status === "rejected" && r.reason instanceof InputError));
      assert.equal((await listSpaces(store, demo)).filter(s => s.status === "open").length, 20);
      const oldest = created[0];
      await renameSpace(store, demo, oldest.id, "  Fictional renamed task  ");
      await archiveSpace(store, demo, oldest.id);
      const archived = (await listSpaces(store, demo)).find(s => s.id === oldest.id);
      assert.deepEqual([archived?.name, archived?.status], ["Fictional renamed task", "archived"]);
      await createSpace(store, demo, "Fictional replacement task");
      assert.equal((await listSpaces(store, demo)).filter(s => s.status === "open").length, 20);
      await assert.rejects(createSpace(store, blank, "x".repeat(61)), InputError);
    });

    await check("Home lists General’s pins, and a work space lists only its own pins", async () => {
      const named = (await listSpaces(store, demo)).find(space => !space.isGeneral && space.status === "open")!;
      const generalPin = await pinCanvas(store, demo, { title: "Fictional General pin", recipe }, { madeBy: "form" });
      const taskPin = await pinCanvas(store, demo, { title: "Fictional task pin", recipe, spaceId: named.id }, { madeBy: "form" });
      assert.deepEqual((await listCanvases(store, demo)).map(pin => pin.id), [generalPin.id]);
      assert.deepEqual((await listCanvases(store, demo, { spaceId: named.id })).map(pin => pin.id), [taskPin.id]);
      assert.deepEqual((await listCanvases(store, blank, { spaceId: named.id })).map(pin => pin.id), []);
    });

    async function populate(hid: string) {
      const space = await createSpace(store, hid, "Fictional late payments");
      const { brief } = await saveBrief(store, hid, space.id, { about: "Follow up on an unpaid invoice." }, "form");
      const [note] = await db.insert(schema.memories).values({ householdId: hid, spaceId: space.id, kind: "fact", text: "Fictional Acme uses net 14." }).returning({ id: schema.memories.id });
      const [pin] = await db.insert(schema.canvases).values({ householdId: hid, spaceId: space.id, title: recipe.title, recipe, position: 0 }).returning({ id: schema.canvases.id });
      const [doc] = await db.insert(schema.documents).values({ householdId: hid, kind: "upload", mime: "application/pdf", storagePath: `${hid}/${randomUUID()}.pdf` }).returning({ id: schema.documents.id });
      const question = turn(space.id, "What is late?");
      const attachment: NewTurn = { ...turn(space.id, "Here is the invoice."), kind: "document", documentId: doc.id };
      await saveTurn(store, hid, question, new Date("2026-11-12T00:00:00Z"));
      await saveTurn(store, hid, attachment, new Date("2026-11-13T00:00:00Z"));
      return { space, brief, note, pin, doc, question, attachment };
    }

    const source = await populate(blank);
    await check("the journal counts work spaces and threads, and export and import preserve links with new ids", async () => {
      assert.equal(await countKind(store, blank, "journal"), 3, "two turns plus one task space");
      const exported = await loadHouseholdSnapshot(store, blank, snapshotOptions);
      assert.equal(exported.version, 4);
      const saved = exported.spaces?.find(s => s.id === source.space.id);
      assert.deepEqual(saved?.brief, source.brief);
      assert.equal(exported.memory?.find(row => row.id === source.note.id)?.spaceId, source.space.id);
      assert.equal(exported.canvases?.find(row => row.id === source.pin.id)?.spaceId, source.space.id);
      assert.equal(exported.journal?.find(row => row.id === source.question.id)?.conversationId, source.space.id);

      await restoreHousehold(store, signedIn, exported);
      const imported = await loadHouseholdSnapshot(store, signedIn, snapshotOptions);
      const restored = imported.spaces?.find(s => s.name === source.space.name);
      assert.ok(restored);
      assert.notEqual(restored.id, source.space.id);
      assert.deepEqual(restored.brief, source.brief);
      assert.equal(imported.spaces?.filter(s => s.name === "General").length, 1);
      assert.notEqual(imported.spaces?.find(s => s.name === "General")?.id, exported.spaces?.find(s => s.name === "General")?.id);
      const note = imported.memory?.find(row => row.spaceId === restored.id);
      const pin = imported.canvases?.find(row => row.spaceId === restored.id);
      const thread = await spaceThread(store, signedIn, restored.id);
      assert.ok(note && pin);
      assert.notEqual(note.id, source.note.id);
      assert.notEqual(pin.id, source.pin.id);
      assert.deepEqual(thread.map(t => [t.question, t.documentId ?? null]), [
        ["What is late?", null], ["Here is the invoice.", null],
      ]);
      assert.notEqual(thread[0].id, source.question.id);
      assert.ok(!(await listSpaces(store, signedIn)).some(s => s.id === source.space.id));
    });

    await check("archiving retains a space's thread and deleting removes its brief, notes, pins and turns while keeping the document", async () => {
      const general = await generalSpace(store, blank);
      const other = turn(general.id, "How is General?");
      await saveTurn(store, blank, other);
      await archiveSpace(store, blank, source.space.id);
      assert.equal((await spaceThread(store, blank, source.space.id)).length, 2);
      assert.deepEqual((await listSpaces(store, blank)).find(s => s.id === source.space.id)?.brief, source.brief);
      await deleteSpace(store, blank, source.space.id);
      const saved = await loadHouseholdSnapshot(store, blank, snapshotOptions);
      assert.ok(!saved.spaces?.some(s => s.id === source.space.id));
      assert.ok(!saved.memory?.some(row => row.id === source.note.id));
      assert.ok(!saved.canvases?.some(row => row.id === source.pin.id));
      assert.deepEqual(saved.journal?.map(t => t.id), [other.id]);
      assert.deepEqual(await db.select({ id: schema.documents.id }).from(schema.documents)
        .where(and(eq(schema.documents.householdId, blank), eq(schema.documents.id, source.doc.id))), [{ id: source.doc.id }]);
      assert.equal(await countKind(store, blank, "journal"), 1);
    });

    await check("deleting the cloud journal clears General's brief and every work space while retaining documents", async () => {
      const general = await generalSpace(store, blank);
      await saveBrief(store, blank, general.id, { about: "General has work." }, "form");
      const other = await populate(blank);
      await deleteKind(store, blank, "journal", { madeBy: "form" });
      assert.deepEqual((await listSpaces(store, blank)).map(s => [s.id, s.brief]), [[general.id, {}]]);
      assert.equal(await countKind(store, blank, "journal"), 0);
      assert.equal(await countKind(store, blank, "memory"), 0);
      assert.equal(await countKind(store, blank, "canvases"), 0);
      assert.equal(await countKind(store, blank, "documents"), 2);
      assert.deepEqual(await spaceThread(store, blank, other.space.id), []);
    });

    console.log(`Spaces checks passed (${passed}).`);
  } finally {
    await pg.close();
  }
}

void main().catch(error => { console.error(error); process.exitCode = 1; });
