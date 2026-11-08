// The checks of D61: what is unclear about a bill or charge about to be added (missing, already saved, due date passed, far from the
// usual, repeat not known), their words and choices, and the to_check read tool. Fictional data only; PGlite for the tool.
// Run from the project root: npx tsx --tsconfig ./tsconfig.json scripts/checks-test.ts
import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "@/db/schema";
import { householdDate } from "@/db/account";
import { loadMoneyState } from "@/db/household";
import { seedBen } from "@/db/seed";
import { checkTools } from "@/lib/agent/check-tools";
import { toolInputSchema, type ToolContext } from "@/lib/agent/tools";
import { extractSchema } from "@/lib/reader/extract";
import { dayLabel } from "@/lib/money/format";
import { CHECK_ORDER, DUPLICATE_DAYS, FAR_PERCENT, checksFor, pendingProposals, readingProposal, type Check, type Proposal } from "@/lib/money/checks";
import { expandBills } from "@/lib/money/repeat";
import { addDays, daysBetween, planWindow, series } from "@/lib/money/runway";
import { dayView, stateThrough } from "@/lib/money/window";
import { latestDate } from "@/lib/money/horizon";
import { benMoney, benStoredBills } from "@/lib/sample/ben";
import type { MoneyState, StoredBill } from "@/lib/money/types";

const TODAY = "2026-11-14";
const END = addDays(TODAY, planWindow(benMoney) - 1);
const stored = (over: Partial<StoredBill> & Pick<StoredBill, "id" | "biller">): StoredBill => ({ amount: null, due: null, category: "utilities", businessBp: 0, status: "confirmed", ...over });
const stateWith = (bills: StoredBill[]): MoneyState => ({ ...benMoney, storedBills: [...benStoredBills, ...bills], bills: expandBills([...benStoredBills, ...bills], TODAY, END, "JPY") });
const proposal = (over: Partial<Proposal> = {}): Proposal => ({
  source: "reading", id: "r1", kind: "bill", name: "Kawa Gym", amountMinor: 6_000, currency: "JPY", date: "2026-12-27", repeat: "month", category: "health", cardId: null, ...over,
});
const kinds = (checks: Check[]) => checks.map(c => c.kind);
const only = (checks: Check[], kind: string) => checks.find(c => c.kind === kind);

async function main() {
  let passed = 0;
  async function check(name: string, run: () => void | Promise<void>) { await run(); passed++; console.log(`✓ ${name}`); }
  const base = benMoney;

  await check("constants and order", () => {
    assert.equal(DUPLICATE_DAYS, 3);
    assert.equal(FAR_PERCENT, 30);
    assert.deepEqual([...CHECK_ORDER], ["missing", "already_saved", "past_due", "far_from_usual", "repeat_unknown"]);
  });

  await check("missing: the amount, the date, both; the words and choices for a bill", () => {
    const a = only(checksFor(proposal({ amountMinor: null, currency: null }), base), "missing")!;
    assert.equal(a.words, "Kawa Gym, due Dec 27: how much?");
    assert.deepEqual(a.choices.map(c => c.label), ["Type the amount", "Not known yet"]);
    assert.deepEqual(a.choices[1].step, { do: "unknown", fields: ["amount"] });
    const d = only(checksFor(proposal({ date: null }), base), "missing")!;
    assert.equal(d.words, "Kawa Gym, ¥6,000: when is it due?");
    assert.deepEqual(d.choices.map(c => c.label), ["Type the date", "Not known yet"]);
    const both = only(checksFor(proposal({ amountMinor: null, currency: null, date: null, name: null }), base), "missing")!;
    assert.equal(both.words, "Bill: how much, and when is it due?");
    assert.deepEqual(both.choices.map(c => c.label), ["Type them in", "Not known yet"]);
    assert.deepEqual(both.choices[1].step, { do: "unknown", fields: ["amount", "date"] });
    assert.equal(only(checksFor(proposal(), base), "missing"), undefined);
  });

  await check("missing: a charge may not be saved as not known yet", () => {
    const c = only(checksFor(proposal({ kind: "charge", date: null, repeat: null }), base), "missing")!;
    assert.equal(c.words, "Kawa Gym, ¥6,000: when is it due?");
    assert.deepEqual(c.choices.map(x => x.label), ["Type it in", "Don't add it"]);
    assert.deepEqual(c.choices[0].step, { do: "edit", field: "date" });
    assert.equal(only(checksFor(proposal({ kind: "charge", amountMinor: null, currency: null, date: null, name: null }), base), "missing")!.words, "Charge: how much, and when is it due?");
  });

  await check("already saved: a one-off bill with the same name key, amount and a date within 3 days; 4 days is not", () => {
    const state = stateWith([stored({ id: "gym", biller: "Kawa Gym", amount: 6_000, due: "2026-12-27" })]);
    const same = checksFor(proposal({ date: "2026-12-30" }), state);
    assert.equal(only(same, "already_saved")!.words, "Already saved: Kawa Gym, ¥6,000, due Dec 27.");
    assert.deepEqual(only(same, "already_saved")!.choices.map(c => c.label), ["Same one, don't add it", "A different one, add it"]);
    assert.equal(only(checksFor(proposal({ date: "2026-12-31" }), state), "already_saved"), undefined, "4 days apart");
    assert.equal(only(checksFor(proposal({ date: "2026-12-24" }), state), "already_saved")!.kind, "already_saved", "3 days earlier");
    assert.equal(only(checksFor(proposal({ amountMinor: 6_001 }), state), "already_saved"), undefined, "another amount");
    assert.equal(only(checksFor(proposal({ name: "KAWA gym" }), state), "already_saved")!.kind, "already_saved", "the name key");
  });

  await check("already saved: a bill waiting in To check says so; the bill itself is not its own duplicate", () => {
    const state = stateWith([stored({ id: "gym", biller: "Kawa Gym", amount: 6_000, due: "2026-12-27", status: "pending" })]);
    assert.equal(only(checksFor(proposal(), state), "already_saved")!.words, "Already waiting in To check: Kawa Gym, ¥6,000, due Dec 27.");
    assert.equal(only(checksFor(proposal({ source: "bill", id: "gym" }), state), "already_saved"), undefined);
    const waiting = [proposal({ id: "r2", date: "2026-12-26" })];
    assert.equal(only(checksFor(proposal(), base, waiting), "already_saved")!.words, "Already waiting in To check: Kawa Gym, ¥6,000, due Dec 26.");
    assert.equal(only(checksFor(proposal(), base, [proposal()]), "already_saved"), undefined, "itself");
  });

  await check("already saved: a repeating bill matches at any amount; its words say the amount it is counted at", () => {
    const rent = proposal({ name: "Rent", amountMinor: 92_000, date: "2026-12-27", repeat: null, category: "housing" });
    const c = only(checksFor(rent, base), "already_saved")!;
    assert.equal(c.words, "Rent is already counted on Dec 27: ¥82,000, every month. This one is ¥92,000.");
    assert.equal(only(checksFor({ ...rent, amountMinor: 82_000 }, base), "already_saved")!.words, "Already saved: Rent, ¥82,000, due Dec 27.");
    assert.equal(only(checksFor({ ...rent, date: "2026-12-31" }, base), "already_saved"), undefined, "4 days from the occurrence");
    assert.equal(only(checksFor({ ...rent, currency: "USD", amountMinor: 92_000 }, base), "already_saved")!.kind, "already_saved", "a series matches whatever the currency");
  });

  await check("already saved: an amount-varies month is not a duplicate (the real bill replaces the estimate)", () => {
    const state = stateWith([stored({ id: "gas", biller: "Minato Gas", amount: 9_000, due: "2026-11-20", repeatUnit: "month", repeatDay: 20, amountVaries: true })]);
    const real = proposal({ name: "Minato Gas", amountMinor: 9_500, date: "2026-12-20", repeat: null, category: "utilities" });
    assert.equal(only(checksFor(real, state), "already_saved"), undefined);
    assert.equal(only(checksFor({ ...real, amountMinor: 9_000 }, state), "already_saved"), undefined);
  });

  await check("already saved: a USD reading in a JPY household skips the amount comparison", () => {
    const state = stateWith([stored({ id: "gym", biller: "Kawa Gym", amount: 6_000, due: "2026-12-27" })]);
    assert.equal(only(checksFor(proposal({ currency: "USD" }), state), "already_saved"), undefined);
    const far = stateWith([stored({ id: "h1", biller: "Kawa Gym", amount: 6_000, due: "2026-10-27" })]);
    assert.equal(only(checksFor(proposal({ currency: "USD", amountMinor: 900_000 }), far), "far_from_usual"), undefined);
  });

  await check("already saved: a charge matches a charge with the same amount, and the same card when both are known", () => {
    const withCharge: MoneyState = { ...base, charges: [...base.charges, { id: "ch1", cardId: base.cards[0].id, merchant: "Noodle shop", amount: 3_800, date: "2026-11-12", category: "food", businessBp: 0, source: "manual", status: "confirmed" }] };
    const p = proposal({ kind: "charge", name: "Noodle shop", amountMinor: 3_800, date: "2026-11-13", repeat: null, cardId: base.cards[0].id });
    assert.equal(only(checksFor(p, withCharge), "already_saved")!.words, "Already saved: Noodle shop, ¥3,800 on Nov 12.");
    assert.equal(only(checksFor({ ...p, cardId: "other-card" }, withCharge), "already_saved"), undefined);
    assert.equal(only(checksFor({ ...p, cardId: null }, withCharge), "already_saved")!.kind, "already_saved");
    assert.equal(only(checksFor({ ...p, amountMinor: 3_900 }, withCharge), "already_saved"), undefined);
    assert.equal(only(checksFor({ ...p, name: "Another shop" }, withCharge), "already_saved"), undefined);
  });

  await check("past due: a bill whose date is before today; not today, not a charge", () => {
    const c = only(checksFor(proposal({ date: "2026-11-10" }), base), "past_due")!;
    assert.equal(c.words, "The due date, Nov 10, has passed.");
    assert.deepEqual(c.choices.map(x => x.label), ["Paid already", "Not paid yet, count it today", "Fix the date"]);
    assert.deepEqual(c.choices[1].step, { do: "date", date: TODAY });
    assert.equal(only(checksFor(proposal({ date: TODAY }), base), "past_due"), undefined);
    assert.equal(only(checksFor(proposal({ date: "2026-11-10", kind: "charge", repeat: null }), base), "past_due"), undefined);
    assert.equal(only(checksFor(proposal({ date: null }), base), "past_due"), undefined);
  });

  await check("far from the usual: exactly +30% of the highest is not flagged, one minor unit more is; the low side the same; 2-3 bills", () => {
    const state = stateWith([
      stored({ id: "e1", biller: "Aoba Denki", amount: 8_640, due: "2026-09-12" }),
      stored({ id: "e2", biller: "Aoba Denki", amount: 10_020, due: "2026-10-12" }),
    ]);
    const p = (amountMinor: number) => proposal({ name: "Aoba Denki", amountMinor, date: "2026-11-12", repeat: "month", category: "utilities" });
    assert.equal(only(checksFor(p(13_026), state), "far_from_usual"), undefined, "10,020 x 1.3 = 13,026");
    const high = only(checksFor(p(13_027), state), "far_from_usual")!;
    assert.equal(high.words, "Aoba Denki is usually ¥8,640–¥10,020 (your last 2 bills). This one is ¥13,027.");
    assert.deepEqual(high.choices.map(c => c.label), ["That's right", "Fix the amount", "Don't add it"]);
    assert.equal(only(checksFor(p(6_048), state), "far_from_usual"), undefined, "8,640 x 0.7 = 6,048");
    assert.equal(only(checksFor(p(6_047), state), "far_from_usual")!.kind, "far_from_usual");
    // a bill dated before the proposal's date only; three bills count, the oldest of four does not
    const four = stateWith([
      stored({ id: "e0", biller: "Aoba Denki", amount: 1_000, due: "2026-08-12" }),
      stored({ id: "e1", biller: "Aoba Denki", amount: 8_640, due: "2026-09-12" }),
      stored({ id: "e2", biller: "Aoba Denki", amount: 10_020, due: "2026-10-12" }),
      stored({ id: "e3", biller: "Aoba Denki", amount: 9_000, due: "2026-10-30" }),
    ]);
    assert.equal(only(checksFor(p(20_000), four), "far_from_usual")!.words, "Aoba Denki is usually ¥8,640–¥10,020 (your last 3 bills). This one is ¥20,000.");
  });

  await check("far from the usual: one bill, a repeating bill, and no history", () => {
    const one = stateWith([stored({ id: "e2", biller: "Aoba Denki", amount: 10_020, due: "2026-10-12" })]);
    const p = (amountMinor: number, name = "Aoba Denki") => proposal({ name, amountMinor, date: "2026-11-12", category: "utilities" });
    assert.equal(only(checksFor(p(21_220), one), "far_from_usual")!.words, "Your last Aoba Denki bill was ¥10,020. This one is ¥21,220.");
    assert.equal(only(checksFor(p(120_000, "Rent"), base), "far_from_usual")!.words, "Rent is ¥82,000 every month. This one is ¥120,000.");
    assert.equal(only(checksFor(p(82_000, "Rent"), base), "far_from_usual"), undefined);
    assert.equal(only(checksFor(p(999_999, "Unseen Co"), base), "far_from_usual"), undefined);
    assert.equal(only(checksFor({ ...p(21_220), kind: "charge" }, one), "far_from_usual"), undefined, "bills only");
  });

  await check("repeat not known: asked for a bill with no repeat; not for a charge; not when the name is a regular cost or a repeating bill", () => {
    const c = only(checksFor(proposal({ repeat: null }), base), "repeat_unknown")!;
    assert.equal(c.words, "Does Kawa Gym come again?");
    assert.deepEqual(c.choices.map(x => x.label), ["Just this once", "Every month", "Every year", "Not sure"]);
    assert.deepEqual(c.choices.map(x => x.step), [{ do: "repeat", repeat: null }, { do: "repeat", repeat: "month" }, { do: "repeat", repeat: "year" }, { do: "repeat", repeat: null }]);
    assert.equal(only(checksFor(proposal(), base), "repeat_unknown"), undefined, "it repeats");
    assert.equal(only(checksFor(proposal({ kind: "charge", repeat: null }), base), "repeat_unknown"), undefined);
    assert.equal(only(checksFor(proposal({ repeat: null, name: "Hikari Denki", date: "2026-12-25" }), base), "repeat_unknown"), undefined, "a regular cost (two months of bills)");
    assert.equal(only(checksFor(proposal({ repeat: null, name: "CloudBox Plus", date: "2026-12-10" }), base), "repeat_unknown"), undefined, "a repeating bill");
    assert.equal(only(checksFor(proposal({ repeat: null, name: null }), base), "repeat_unknown"), undefined);
    const yearly = stateWith([stored({ id: "dom", biller: "Domain Co", amount: 2_000, due: "2026-11-30", repeatUnit: "year" })]);
    assert.equal(only(checksFor(proposal({ repeat: null, name: "Domain Co", date: "2026-12-02" }), yearly), "repeat_unknown"), undefined, "a yearly bill too");
  });

  await check("order follows CHECK_ORDER; every check has 2 to 4 choices with labels of at most 40 characters", () => {
    const state = stateWith([
      stored({ id: "e1", biller: "Aoba Denki", amount: 10_020, due: "2026-07-12" }),
      stored({ id: "e9", biller: "Aoba Denki", amount: 60_000, due: "2026-11-10" }),
    ]);
    const aoba = proposal({ name: "Aoba Denki", amountMinor: 200_000, date: "2026-11-11", repeat: null, category: "utilities" });
    const all = checksFor(aoba, state, [{ ...aoba, id: "r2", date: "2026-11-12" }]);
    assert.deepEqual(kinds(all), ["already_saved", "past_due", "far_from_usual", "repeat_unknown"]);
    const withMissing = checksFor(proposal({ name: "Aoba Denki", amountMinor: null, currency: null, date: "2026-11-11", repeat: null }), state);
    assert.deepEqual(kinds(withMissing), ["missing", "past_due", "repeat_unknown"]);
    for (const c of [...all, ...withMissing]) {
      assert.ok(c.choices.length >= 2 && c.choices.length <= 4, c.kind);
      for (const choice of c.choices) assert.ok(choice.label.length <= 40, choice.label);
    }
    assert.deepEqual(kinds(all), CHECK_ORDER.filter(k => kinds(all).includes(k)));
  });

  await check("Ben's Try it To check has no checks", () => {
    const proposals = pendingProposals(benMoney);
    assert.ok(proposals.length >= 1);
    assert.ok(proposals.some(p => p.name === "Hikari Denki" && p.amountMinor === 11_220));
    for (const p of proposals) assert.deepEqual(checksFor(p, benMoney), [], p.name ?? p.id);
  });

  await check("readingProposal carries a reading's fields", () => {
    const value = extractSchema.parse({ kind: "bill", name: "Kawa Gym", date: "2026-12-27", amountMinor: 6_000, currency: "JPY", category: "health", cardId: null });
    assert.deepEqual(readingProposal({ id: "x", value }), { source: "reading", id: "x", kind: "bill", name: "Kawa Gym", amountMinor: 6_000, currency: "JPY", date: "2026-12-27", repeat: null, category: "health", cardId: null });
  });

  // ---------------------------------------------------------------- the to_check tool (PGlite)
  const pg = new PGlite({ extensions: { pg_trgm } });
  const db = drizzle(pg, { schema });
  try {
    await migrate(db, { migrationsFolder: "./drizzle" });
    const a = await seedBen(db, { isDemo: true }), b = await seedBen(db, { isDemo: true });
    const tool = checkTools.find(t => t.name === "to_check")!;
    const ctxOf = (hid: string): ToolContext => ({ madeBy: "mcp", db, householdId: hid, state: async () => loadMoneyState(db, hid, await householdDate(db, hid)), appUrl: new URL("http://127.0.0.1:3123") });
    const run = async (hid: string) => JSON.parse(await tool.run(ctxOf(hid), {} as never)) as {
      currency: string; items: { source: string; id: string; what: string; name: string | null; amountMinor: number | null; from: string; documentId?: string; checks: { kind: string; words: string; choices: string[] }[] }[];
      reading: { documentId: string; status: string; error: string | null }[];
    };
    const addReading = async (hid: string, proposed: unknown, kind: "upload" | "email" = "upload") => {
      const [doc] = await db.insert(schema.documents).values({ householdId: hid, kind, storagePath: `${hid}/${crypto.randomUUID()}.pdf`, mime: "application/pdf", status: "read" }).returning();
      await db.insert(schema.readings).values({ householdId: hid, documentId: doc.id, extracted: { original: proposed, proposed }, target: "bill" });
      return doc.id;
    };

    await check("to_check: scope read, an empty input schema, Ben's draft with no checks", async () => {
      assert.equal(tool.scope, "read");
      const schemaOut = toolInputSchema(tool) as { type: string; properties: object };
      assert.equal(schemaOut.type, "object");
      assert.deepEqual(schemaOut.properties, {});
      const out = await run(a);
      assert.equal(out.currency, "JPY");
      const hikari = out.items.find(i => i.name === "Hikari Denki")!;
      assert.equal(hikari.source, "bill");
      assert.equal(hikari.what, "bill");
      assert.equal(hikari.amountMinor, 11_220);
      assert.deepEqual(hikari.checks, []);
      assert.deepEqual(out.reading, []);
    });

    await check("to_check: a reading comes back with its checks, its source and its document; another household's items never appear", async () => {
      const documentId = await addReading(a, { kind: "bill", name: "Rent", date: "2026-12-27", amountMinor: 92_000, currency: "JPY", category: "housing", cardId: null });
      const emailId = await addReading(a, { kind: "bill", name: "Kawa Gym", date: "2026-12-20", amountMinor: 6_000, currency: "JPY", category: "health", cardId: null }, "email");
      await addReading(b, { kind: "bill", name: "ZZ Secret Landlord", date: "2026-12-20", amountMinor: 6_000, currency: "JPY", category: "housing", cardId: null });
      const out = await run(a);
      const rent = out.items.find(i => i.source === "reading" && i.name === "Rent")!;
      assert.equal(rent.documentId, documentId);
      assert.equal(rent.from, "upload");
      assert.deepEqual(rent.checks.map(c => c.kind), ["already_saved"], "Rent is a regular cost, so no repeat question");
      assert.match(rent.checks[0].words, /^Rent is already counted on Dec 27: ¥82,000, every month\. This one is ¥92,000\.$/);
      assert.deepEqual(rent.checks[0].choices, ["Same one, don't add it", "A different one, add it"]);
      const gym = out.items.find(i => i.name === "Kawa Gym")!;
      assert.equal(gym.from, "email");
      assert.equal(gym.documentId, emailId);
      assert.deepEqual(gym.checks.map(c => c.kind), ["repeat_unknown"]);
      assert.equal(out.items.some(i => i.name === "ZZ Secret Landlord"), false);
      assert.equal(JSON.stringify(out).includes("ZZ Secret"), false);
      const other = await run(b);
      assert.ok(other.items.some(i => i.name === "ZZ Secret Landlord"));
      assert.equal(other.items.some(i => i.name === "Kawa Gym"), false);
    });

    await check("to_check: a draft saved through MCP carries its source; documents being read are listed", async () => {
      const [queued] = await db.insert(schema.documents).values({ householdId: a, kind: "upload", storagePath: `${a}/${crypto.randomUUID()}.pdf`, mime: "application/pdf", status: "queued" }).returning();
      const [failed] = await db.insert(schema.documents).values({ householdId: a, kind: "email", storagePath: `${a}/${crypto.randomUUID()}.eml`, mime: "message/rfc822", status: "failed", error: "Unreadable" }).returning();
      const out = await run(a);
      assert.deepEqual(out.reading.map(r => r.documentId).sort(), [queued.id, failed.id].sort());
      assert.equal(out.reading.find(r => r.documentId === failed.id)!.error, "Unreadable");
      assert.equal(out.reading.find(r => r.documentId === queued.id)!.status, "queued");
      assert.equal(out.items.find(i => i.name === "Hikari Denki")!.from, "form");
      await db.update(schema.bills).set({ madeBy: "ask" }).where(and(eq(schema.bills.householdId, a), eq(schema.bills.status, "pending")));
      assert.equal((await run(a)).items.find(i => i.name === "Hikari Denki")!.from, "ask");
    });

    await check("the plan window (27D): a yearly bill due past the window is seen by already saved and repeat not known", async () => {
      const fresh = await seedBen(db, { isDemo: true });
      const today = await householdDate(db, fresh);
      const dueOn = addDays(today, 240); // about eight months on: far past the window
      await db.insert(schema.bills).values({ householdId: fresh, biller: "Hoshi Insurance", amountMinor: 48_000, currency: "JPY", due: dueOn, category: "insurance", status: "confirmed", repeatUnit: "year" });
      const state = await loadMoneyState(db, fresh, today);
      assert.equal(state.bills.some(bill => bill.biller === "Hoshi Insurance"), false, "no occurrence inside the window");
      assert.ok(state.storedBills.some(bill => bill.biller === "Hoshi Insurance"));
      const again = proposal({ name: "Hoshi Insurance", amountMinor: 48_000, date: addDays(dueOn, 2), repeat: null, category: "insurance" });
      const out = checksFor(again, state);
      assert.equal(only(out, "already_saved")!.words, `Already saved: Hoshi Insurance, ¥48,000, due ${dayLabel(dueOn)}.`);
      assert.equal(only(out, "repeat_unknown"), undefined, "a repeating series of that name is known");
      assert.equal(only(checksFor({ ...again, date: addDays(dueOn, 4) }, state), "already_saved"), undefined, "4 days apart");
      assert.equal(only(checksFor({ ...again, date: addDays(dueOn, 365 + 1) }, state), "already_saved")!.kind, "already_saved", "next year's occurrence");
      assert.equal(only(checksFor({ ...again, amountMinor: 20_000, date: dueOn }, state), "already_saved")!.words.startsWith("Hoshi Insurance is already counted on"), true);
      await db.update(schema.bills).set({ repeatUntil: dueOn }).where(and(eq(schema.bills.householdId, fresh), eq(schema.bills.biller, "Hoshi Insurance")));
      const ended = await loadMoneyState(db, fresh, today);
      assert.equal(only(checksFor({ ...again, date: addDays(dueOn, 365) }, ended), "already_saved"), undefined, "no occurrence after the last payment");
    });

    await check("the plan window (27D): the default state is the window as before; a later day is reached by stateThrough", async () => {
      const fresh = await seedBen(db, { isDemo: true });
      const today = await householdDate(db, fresh);
      const dueOn = "2026-12-31";
      await db.insert(schema.bills).values({ householdId: fresh, biller: "Hoshi Insurance", amountMinor: 48_000, currency: "JPY", due: dueOn, category: "insurance", status: "confirmed", repeatUnit: "year" });
      await db.insert(schema.bills).values({ householdId: fresh, biller: "Kawa Gym", amountMinor: 6_000, currency: "JPY", due: "2026-12-27", repeatDay: 27, category: "health", status: "confirmed", repeatUnit: "month" });
      const state = await loadMoneyState(db, fresh, today);
      const end = addDays(today, planWindow(state) - 1);
      assert.ok(state.bills.every(bill => bill.due <= end), "Home's state stops at the plan window");
      assert.equal(state.bills.some(bill => bill.biller === "Hoshi Insurance"), false);
      assert.equal(stateThrough(state, end), state, "inside the window: the same state");
      const view = dayView(state, "worst", dueOn);
      const direct: MoneyState = { ...state, bills: expandBills(state.storedBills, today, dueOn, "JPY") };
      const n = daysBetween(today, dueOn) + 1;
      assert.equal(view.balance, series(direct, "worst", n)[n - 1]);
      assert.deepEqual(view.events.filter(event => event.label === "Hoshi Insurance").map(event => event.amount), [-48_000]);
      assert.throws(() => stateThrough(state, addDays(latestDate(today), 1)), /two years/);
      assert.throws(() => stateThrough(state, addDays(today, -1)), /passed/);
      const far = stateThrough(state, latestDate(today)).bills.filter(bill => bill.biller === "Hoshi Insurance").map(bill => bill.due);
      assert.deepEqual(far, ["2026-12-31", "2027-12-31"], "two years out");
    });
  } finally {
    await pg.close();
  }
  console.log(`Checks tests passed (${passed}).`);
}

main().catch(error => { console.error(error); process.exit(1); });
