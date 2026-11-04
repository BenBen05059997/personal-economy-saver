// Household split (D45): the pure maths in lib/money/split.ts, People (add a member, shares), shared bills and charges,
// Mark settled, the agent tools, the snapshot and household scope. PGlite, no credentials.
// Run from the project root: npx tsx --tsconfig ./tsconfig.json scripts/split-test.ts
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "@/db/schema";
import { billInput, insertBill, removeBill } from "@/db/bills";
import { chargeInput, insertCharge, removeCharge } from "@/db/charges";
import { DEMO_DATE } from "@/db/clock";
import { confirmPending } from "@/db/confirm";
import { loadMoneyState } from "@/db/household";
import { InputError } from "@/db/input-error";
import { addMember, equalShares, memberByName, parseShareBp, savePeople } from "@/db/people";
import { settingsInput, SettingsError, updateSettings } from "@/db/settings";
import { seedBen } from "@/db/seed";
import { settleUp } from "@/db/settle";
import { loadHouseholdSnapshot } from "@/db/snapshot";
import { toolInputSchema, tools, type ToolContext } from "@/lib/agent/tools";
import { low, roomOnCard, safeToSpend, series } from "@/lib/money/runway";
import { homeSentence } from "@/lib/money/sentence";
import { allocate, splitBalance, splitSummary, transferLine, transfersFor } from "@/lib/money/split";
import { toCheck } from "@/lib/money/to-check";
import type { SplitState } from "@/lib/money/types";
import { benMoney } from "@/lib/sample/ben";
import { HouseholdSnapshot } from "@/lib/schema/household";

/** The shares-only saves of these tests: every member keeps their current name. */
async function setShares(db: Parameters<typeof savePeople>[0], hid: string, input: { shares: { id: string; percent: string }[] }) {
  const named = await db.select({ id: schema.members.id, name: schema.members.displayName }).from(schema.members).where(eq(schema.members.householdId, hid));
  await savePeople(db, hid, { people: input.shares.map(({ id, percent }) => ({ id, percent, name: named.find(m => m.id === id)?.name ?? "Unknown" })) });
}

const TODAY = DEMO_DATE; // 2026-11-14, every demo household's clock
const mem = (id: string, shareBp: number) => ({ id, name: id.toUpperCase(), shareBp });
const CREATED = "2026-10-01T00:00:00.000Z", LATER = "2099-01-01T00:00:00.000Z";
const state2 = (over: Partial<SplitState> = {}): SplitState => ({
  members: [mem("ben", 6000), mem("aki", 4000)], since: "2026-10-01", settledThrough: null, bills: [], charges: [], ...over,
  settledAt: over.settledAt !== undefined ? over.settledAt : over.settledThrough ? LATER : null, // a settlement is after the items made before it
});
const bill = (over: Partial<SplitState["bills"][number]> = {}) =>
  ({ id: "b", biller: "Rent", amountMinor: 80_000, due: "2026-10-27", repeatDay: null, paidBy: "ben", createdAt: CREATED, ...over });
const charge = (over: Partial<SplitState["charges"][number]> = {}) =>
  ({ id: "c", merchant: "Market", amountMinor: 5_000, date: "2026-11-05", paidBy: "aki", createdAt: CREATED, ...over });
const net = (state: SplitState, today = TODAY) => Object.fromEntries(splitBalance(state, today).members.map(m => [m.id, m.netMinor]));

async function main() {
  const pg = new PGlite();
  const db = drizzle(pg, { schema });
  let passed = 0;
  async function check(name: string, run: () => void | Promise<void>) { await run(); passed++; console.log(`✓ ${name}`); }
  try {
    // ------------------------------------------------------------ pure maths
    await check("allocate: every item splits to exactly its amount, largest remainder first, ties to the earlier member", () => {
      assert.deepEqual(allocate(100, [3334, 3333, 3333]), [34, 33, 33]);
      assert.deepEqual(allocate(1, [3334, 3333, 3333]), [1, 0, 0]);
      assert.deepEqual(allocate(1, [5000, 5000]), [1, 0], "the owner (first) takes the odd yen");
      assert.deepEqual(allocate(2, [3333, 3334, 3333]), [1, 1, 0], "the larger remainder goes first, then the earlier of equals");
      assert.deepEqual(allocate(30_000, [6000, 4000]), [18_000, 12_000]);
      assert.deepEqual(allocate(0, [6000, 4000]), [0, 0]);
      assert.deepEqual(allocate(9_000_000_000_000, [3334, 3333, 3333]).reduce((a, b) => a + b, 0), 9_000_000_000_000, "exact beyond 2^53 intermediates");
      let seed = 7;
      const next = () => (seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648);
      for (let i = 0; i < 300; i++) {
        const cut1 = next() % 10_001, cut2 = next() % 10_001;
        const [lo, hi] = cut1 < cut2 ? [cut1, cut2] : [cut2, cut1];
        const shares = [lo, hi - lo, 10_000 - hi];
        const amount = next() % 5_000_000;
        const parts = allocate(amount, shares);
        assert.equal(parts.reduce((a, b) => a + b, 0), amount, `${amount} by ${shares}`);
        parts.forEach((part, k) => assert.ok(Math.abs(part - (amount * shares[k]) / 10_000) < 1, "within a yen of the exact share"));
      }
      assert.throws(() => allocate(100, [5000, 4000]), /10,000/);
      assert.throws(() => allocate(-1, [10_000]));
      assert.throws(() => allocate(1.5, [10_000]));
    });

    await check("transfersFor: the fewest payments, largest debtor to largest creditor, summing exactly to the balances", () => {
      const people = (...nets: number[]) => nets.map((netMinor, i) => ({ id: `p${i}`, name: `P${i}`, netMinor }));
      assert.deepEqual(transfersFor(people(9_000, -9_000)).map(t => [t.fromId, t.toId, t.amountMinor]), [["p1", "p0", 9_000]]);
      assert.deepEqual(transfersFor(people(0, 0)), []);
      assert.deepEqual(transfersFor(people(30_000, -2_000, -28_000)).map(t => [t.fromId, t.toId, t.amountMinor]), [["p2", "p0", 28_000], ["p1", "p0", 2_000]]);
      // a debtor pays two creditors: 50 owes 30 to p0 and 20 to p1
      assert.deepEqual(transfersFor(people(30, 20, -50)).map(t => [t.fromId, t.toId, t.amountMinor]), [["p2", "p0", 30], ["p2", "p1", 20]]);
      for (const nets of [[100, -30, -30, -40], [70, 30, -40, -60], [-1, -1, 2], [5, -5, 0, 0, 7, -7]]) {
        const ts = transfersFor(people(...nets));
        const settled = nets.map((n, i) => n + ts.filter(t => t.fromId === `p${i}`).reduce((a, t) => a + t.amountMinor, 0) - ts.filter(t => t.toId === `p${i}`).reduce((a, t) => a + t.amountMinor, 0));
        assert.ok(settled.every(v => v === 0), `${nets} ends at zero`);
        assert.ok(ts.length <= nets.filter(n => n !== 0).length - 1, "no more than people minus one");
      }
    });

    await check("a shared bill paid by Ben at 60/40: Aki owes Ben her 40%; the transfers sum to the balances", () => {
      const balance = splitBalance(state2({ bills: [bill({ amountMinor: 30_000, due: "2026-11-01" })] }), TODAY);
      assert.deepEqual(balance.members.map(m => [m.id, m.paidMinor, m.shareMinor, m.netMinor]), [["ben", 30_000, 18_000, 12_000], ["aki", 0, 12_000, -12_000]]);
      assert.deepEqual(balance.transfers, [{ fromId: "aki", fromName: "AKI", toId: "ben", toName: "BEN", amountMinor: 12_000 }]);
      assert.equal(balance.items, 1);
      assert.equal(transferLine(balance.transfers[0], "JPY"), "AKI owes BEN ¥12,000");
      assert.equal(splitSummary(state2(), splitBalance(state2(), TODAY), "JPY"), "Nobody owes anyone anything.");
      const both = state2({ bills: [bill({ amountMinor: 30_000, due: "2026-11-01" })], charges: [charge()] }); // Aki's 5,000 charge paid by Aki
      assert.deepEqual(net(both), { ben: 9_000, aki: -9_000 }, "Ben +12,000 from the bill, -3,000 for 60% of Aki's charge");
      assert.equal(splitSummary(both, splitBalance(both, TODAY), "JPY"), "AKI owes BEN ¥9,000.");
      assert.deepEqual(net(state2({ charges: [charge({ date: "2026-09-30" }), charge({ date: "2026-11-15" })] })), { ben: 0, aki: 0 }, "a charge before the split or after today does not count");
    });

    await check("counting window: after the last settlement, through today, from the day the split began; pending-free, future items wait", () => {
      const items = { bills: [bill({ id: "before", amountMinor: 1_000, due: "2026-09-30" }), bill({ id: "first", amountMinor: 2_000, due: "2026-10-01" }),
        bill({ id: "today", amountMinor: 4_000, due: TODAY }), bill({ id: "later", amountMinor: 8_000, due: "2026-11-15" })] };
      assert.equal(net(state2(items)).ben, 2_400, "2,000 and 4,000 count; 1,000 is before the split and 8,000 is in the future");
      assert.equal(splitBalance(state2(items), TODAY).items, 2);
      assert.equal(net(state2({ ...items, settledThrough: "2026-10-01" })).ben, 1_600, "the settlement day itself is already settled");
      assert.equal(net(state2({ ...items, settledThrough: TODAY })).ben, 0, "settled through today leaves nothing");
      assert.equal(net(state2({ ...items, settledThrough: "2026-09-01" })).ben, 2_400, "a settlement before the split began changes nothing");
      assert.equal(net(state2(items), "2026-11-15").ben, 5_600, "tomorrow the later bill counts");
      assert.deepEqual(splitBalance(state2({ ...items, since: null }), TODAY).transfers, [], "no split until the second member");
      assert.deepEqual(splitBalance({ ...state2(items), members: [mem("ben", 10_000)] }, TODAY).transfers, []);
      assert.throws(() => splitBalance(state2({ bills: [bill({ paidBy: "ghost" })] }), TODAY), /not a member/);
      assert.throws(() => splitBalance(state2({ members: [mem("ben", 6000), mem("aki", 3000)] }), TODAY), /10,000/, "shares that do not total 100% are refused, even with no items");
    });

    await check("the settlement day: an item dated that day counts only if it was created after the settlement", () => {
      const settled = { settledThrough: "2026-11-10", settledAt: "2026-11-10T09:00:00.000Z" };
      const before = bill({ id: "before", amountMinor: 10_000, due: "2026-11-10", createdAt: "2026-11-10T08:59:59.000Z" });
      const after = bill({ id: "after", amountMinor: 5_000, due: "2026-11-10", createdAt: "2026-11-10T09:00:01.000Z" });
      assert.equal(net(state2({ ...settled, bills: [before] })).ben, 0, "made before settling, dated that day: settled");
      assert.equal(net(state2({ ...settled, bills: [after] })).ben, 2_000, "made after settling, dated that day: counts (Ben paid 5,000 and owes 3,000)");
      assert.equal(splitBalance(state2({ ...settled, bills: [before, after] }), TODAY).items, 1);
      assert.equal(splitBalance(state2({ ...settled, charges: [charge({ date: "2026-11-10", createdAt: "2026-11-10T10:00:00.000Z" }), charge({ date: "2026-11-10", createdAt: "2026-11-10T08:00:00.000Z" }), charge({ date: "2026-11-09", createdAt: "2026-11-10T10:00:00.000Z" })] }), TODAY).items, 1, "a charge dated before the settlement day is settled whenever it was made");
      const monthly = (createdAt: string) => bill({ amountMinor: 80_000, due: "2026-09-10", repeatDay: 10, createdAt });
      assert.equal(splitBalance(state2({ since: "2026-09-01", ...settled, bills: [monthly("2026-11-10T08:00:00.000Z")] }), TODAY).items, 0, "the Nov 10 occurrence of a bill made before settling is settled");
      assert.equal(splitBalance(state2({ since: "2026-09-01", ...settled, bills: [monthly("2026-11-10T10:00:00.000Z")] }), TODAY).items, 1, "...and counts when the bill row was made after; Sep 10 and Oct 10 are settled either way");
      assert.equal(splitBalance(state2({ since: "2026-09-01", ...settled, bills: [monthly("2026-11-10T10:00:00.000Z")] }), "2026-12-10").items, 2, "the Dec 10 occurrence is dated after the settlement");
    });

    await check("a monthly shared bill counts every past occurrence from its first due date, clamped to short months", () => {
      const rent = bill({ amountMinor: 80_000, due: "2026-08-27", repeatDay: 27 });
      assert.equal(splitBalance(state2({ since: "2026-08-01", bills: [rent] }), TODAY).items, 3, "Aug 27, Sep 27, Oct 27; Nov 27 has not come");
      assert.equal(splitBalance(state2({ since: "2026-08-01", bills: [rent] }), "2026-11-27").items, 4, "on the day itself it counts");
      assert.equal(splitBalance(state2({ since: "2026-09-28", bills: [rent] }), TODAY).items, 1, "from the split day: only Oct 27");
      assert.equal(splitBalance(state2({ since: "2026-08-01", settledThrough: "2026-09-27", bills: [rent] }), TODAY).items, 1, "after a settlement: only Oct 27");
      assert.equal(net(state2({ since: "2026-08-01", bills: [rent] })).ben, 96_000);
      const month31 = bill({ amountMinor: 1_000, due: "2026-01-31", repeatDay: 31 });
      assert.equal(splitBalance(state2({ since: "2026-01-01", bills: [month31] }), "2026-03-01").items, 2, "Jan 31 and Feb 28");
      assert.equal(splitBalance(state2({ since: "2026-01-01", bills: [month31] }), "2026-02-27").items, 1, "Feb 28 has not come");
      assert.equal(splitBalance(state2({ since: "2026-01-01", bills: [bill({ ...month31, due: "2026-12-31" })] }), "2026-11-30").items, 0, "a first due date in the future counts nothing");
    });

    await check("share parsing and equal shares: whole percent or two decimals; the owner takes the remainder", () => {
      assert.deepEqual(["0", "40", "33.33", "100", "7.5"].map(parseShareBp), [0, 4000, 3333, 10_000, 750]);
      for (const bad of ["", "-1", "100.01", "101", "abc", "12.345", "1,5"]) assert.throws(() => parseShareBp(bad), InputError, bad);
      assert.deepEqual([equalShares(1), equalShares(2), equalShares(3), equalShares(7)], [[10_000], [5000, 5000], [3334, 3333, 3333], [1432, 1428, 1428, 1428, 1428, 1428, 1428]]);
      for (const n of [1, 2, 3, 4, 5, 6, 7, 9, 11]) assert.equal(equalShares(n).reduce((a, b) => a + b, 0), 10_000);
    });

    // ------------------------------------------------------------ database
    await migrate(db, { migrationsFolder: "./drizzle" });
    const a = await seedBen(db, { isDemo: true }), b = await seedBen(db, { isDemo: true, name: "Other" });
    const first = async <T,>(rows: Promise<T[]>) => (await rows)[0];
    const events = (hid: string, kind: string) => db.select().from(schema.events).where(and(eq(schema.events.householdId, hid), eq(schema.events.kind, kind)));
    const stateOf = (hid: string, today = TODAY) => loadMoneyState(db, hid, today);
    const members = (hid: string) => db.select().from(schema.members).where(eq(schema.members.householdId, hid)).orderBy(schema.members.createdAt, schema.members.id);
    const household = (hid: string) => first(db.select().from(schema.households).where(eq(schema.households.id, hid)));
    const sharesOf = async (hid: string) => (await stateOf(hid)).split.members.map(m => [m.name, m.shareBp]);
    const ben = (await members(a))[0].id;
    const benB = (await members(b))[0].id;
    const baseline = async (hid: string) => {
      const s = await stateOf(hid);
      return { sentence: homeSentence(s), safe: safeToSpend(s, 0).amount, bank: s.bank, worst: Array.from(series(s, "worst")), low: low(series(s, "worst")), room: roomOnCard(s, s.cards[0].id).room };
    };

    await check("Ben alone: no split, no transfers, nothing on the screen's inputs, and every demo number is unchanged", async () => {
      const state = await stateOf(a);
      assert.deepEqual(state.split, { members: [{ id: ben, name: "Ben", shareBp: 10_000 }], since: null, settledThrough: null, settledAt: null, bills: [], charges: [] });
      assert.deepEqual(splitBalance(state.split, TODAY).transfers, []);
      assert.equal(splitSummary(state.split, splitBalance(state.split, TODAY), "JPY"), "Only one person is in this household, so there is nothing to split.");
      assert.equal(homeSentence(state).emphasis, "¥18,780 short on the 27th.");
      assert.equal(safeToSpend(state, 0).amount, 0);
      assert.equal(roomOnCard(state, state.cards.find(c => c.label === "Card B")!.id).room, 173_770);
      assert.equal(state.bank, 67_000);
      assert.equal((await household(a)).splitSince, null);
      await assert.rejects(settleUp(db, a), InputError, "settling needs a second person");
      assert.equal((await db.select().from(schema.settlements)).length, 0);
    });

    await check("the SQL refuses bad rows: share range, a payer on an owned bill, another household's member, bad settlements", async () => {
      await assert.rejects(db.update(schema.members).set({ shareBp: 10_001 }).where(eq(schema.members.id, ben)));
      await assert.rejects(db.update(schema.members).set({ shareBp: -1 }).where(eq(schema.members.id, ben)));
      const row = { householdId: a, biller: "Fictional", amountMinor: 100, currency: "JPY", due: TODAY, category: "other" };
      await assert.rejects(db.insert(schema.bills).values({ ...row, memberId: ben, paidByMemberId: ben }), "a bill with an owner has no payer");
      await assert.rejects(db.insert(schema.bills).values({ ...row, paidByMemberId: benB }), "another household's member cannot pay");
      const settlement = { householdId: a, fromMemberId: ben, toMemberId: ben, amountMinor: 100, currency: "JPY", through: TODAY };
      await assert.rejects(db.insert(schema.settlements).values(settlement), "a person cannot pay themselves");
      await assert.rejects(db.insert(schema.settlements).values({ ...settlement, toMemberId: benB }), "another household's member");
      await assert.rejects(db.insert(schema.settlements).values({ ...settlement, toMemberId: benB, fromMemberId: benB, householdId: b, amountMinor: 0 }), "an amount must be positive");
    });

    let aki = "";
    await check("adding the second member starts the split today and divides equally; the event lists the shares", async () => {
      aki = await addMember(db, a, { name: "Aki" });
      assert.deepEqual(await sharesOf(a), [["Ben", 5000], ["Aki", 5000]]);
      assert.equal((await household(a)).splitSince, TODAY);
      const joined = await events(a, "member_added");
      assert.deepEqual([joined.length, joined[0].title, joined[0].body, joined[0].refId], [1, "Aki joined the household", "Shares: Ben 50%, Aki 50%", aki]);
      assert.equal((await members(a)).find(m => m.id === aki)!.role, "member");
      assert.deepEqual(await sharesOf(b), [["Ben", 10_000]], "another household is untouched");
      assert.equal((await household(b)).splitSince, null);
      await assert.rejects(addMember(db, a, { name: "  aki " }), InputError, "names are unique, case aside");
      await assert.rejects(addMember(db, a, { name: "  " }));
    });

    await check("setShares: every person once, total exactly 100%, an event with old and new; another household's member is refused", async () => {
      const set = (shares: [string, string][]) => setShares(db, a, { shares: shares.map(([id, percent]) => ({ id, percent })) });
      await assert.rejects(set([[ben, "60"], [aki, "30"]]), /total 100%; these total 90%/);
      await assert.rejects(set([[ben, "60"], [aki, "41"]]), /101%/);
      await assert.rejects(set([[ben, "100"]]), /every person/);
      await assert.rejects(set([[ben, "60"], [ben, "40"]]), /once/);
      await assert.rejects(set([[ben, "60"], [benB, "40"]]), /every person/, "a member of another household");
      await assert.rejects(set([[ben, "x"], [aki, "40"]]), InputError);
      assert.deepEqual(await sharesOf(a), [["Ben", 5000], ["Aki", 5000]], "nothing changed by the refusals");
      await set([[ben, "60"], [aki, "40"]]);
      assert.deepEqual(await sharesOf(a), [["Ben", 6000], ["Aki", 4000]]);
      const updated = await events(a, "shares_updated");
      assert.deepEqual([updated.length, updated[0].body], [1, "Ben 50% → 60%; Aki 50% → 40%"]);
      await set([[ben, "60"], [aki, "40"]]);
      assert.equal((await events(a, "shares_updated")).length, 1, "the same shares record nothing");
      await assert.rejects(setShares(db, b, { shares: [{ id: ben, percent: "100" }] }), /every person/, "household b has a different Ben");
      assert.deepEqual(await sharesOf(b), [["Ben", 10_000]]);
    });

    const akiCard = randomUUID();
    await check("the browser scenario: Aki at 40%, a shared ¥30,000 bill paid by Ben, a shared ¥5,000 charge on Aki's card", async () => {
      await db.insert(schema.cards).values({ id: akiCard, householdId: a, memberId: aki, label: "Aki Card", closingDay: 31, dueDay: 26, currency: "JPY", limitMinor: 300_000 });
      const rent = billInput.parse({ id: randomUUID(), biller: "Fictional landlord", amount: "30000", due: TODAY, category: "housing", paidByMemberId: ben });
      await insertBill(db, a, rent, "confirmed");
      const dinner = chargeInput.parse({ id: randomUUID(), cardId: akiCard, merchant: "Fictional grocer", amount: "5000", date: TODAY, category: "other", shared: true });
      await insertCharge(db, a, dinner, "confirmed", "manual");
      const state = await stateOf(a);
      const balance = splitBalance(state.split, state.today);
      // Ben paid 30,000 and owes 60% of 35,000 = 21,000 -> +9,000; Aki paid 5,000 and owes 40% of 35,000 = 14,000 -> -9,000.
      assert.deepEqual(balance.members.map(m => [m.name, m.paidMinor, m.shareMinor, m.netMinor]), [["Ben", 30_000, 21_000, 9_000], ["Aki", 5_000, 14_000, -9_000]]);
      assert.deepEqual(balance.transfers.map(t => transferLine(t, "JPY")), ["Aki owes Ben ¥9,000"]);
      assert.equal((await events(a, "bill_added")).find(e => e.refId === rent.id)!.body, "Shared, paid by Ben");
      assert.equal((await events(a, "charge_added")).find(e => e.refId === dinner.id)!.body, "Shared, paid by Aki (Aki Card)");
      assert.deepEqual([state.charges.find(c => c.id === dinner.id)!.shared, state.bills.find(b => b.id === rent.id)!.paidBy], [true, ben]);
    });

    await check("a shared charge and a shared bill are refused where the split cannot work", async () => {
      const bCard = (await first(db.select().from(schema.cards).where(eq(schema.cards.householdId, b)))).id;
      await assert.rejects(insertCharge(db, b, chargeInput.parse({ id: randomUUID(), cardId: bCard, merchant: "X", amount: "100", date: TODAY, category: "other", shared: true }), "confirmed", "manual"), /second person/);
      await assert.rejects(insertBill(db, b, billInput.parse({ id: randomUUID(), biller: "X", amount: "100", due: TODAY, category: "other", paidByMemberId: benB }), "confirmed"), /second person/);
      const homeless = randomUUID();
      await db.insert(schema.cards).values({ id: homeless, householdId: a, label: "Household card", closingDay: 31, dueDay: 26, currency: "JPY" });
      await assert.rejects(insertCharge(db, a, chargeInput.parse({ id: randomUUID(), cardId: homeless, merchant: "X", amount: "100", date: TODAY, category: "other", shared: true }), "confirmed", "manual"), /belongs to a person/);
      await assert.rejects(insertBill(db, a, billInput.parse({ id: randomUUID(), biller: "X", amount: "100", due: TODAY, category: "other", memberId: ben, paidByMemberId: ben }), "confirmed"), /Shared/);
      await assert.rejects(insertBill(db, a, billInput.parse({ id: randomUUID(), biller: "X", amount: "100", due: TODAY, category: "other", paidByMemberId: benB }), "confirmed"), /member of this household/);
      await assert.rejects(insertBill(db, a, billInput.parse({ id: randomUUID(), biller: "X", amount: "100", due: TODAY, category: "other", paidByMemberId: randomUUID() }), "confirmed"), /member of this household/);
      const same = billInput.parse({ id: randomUUID(), biller: "Idem", amount: "100", due: TODAY, category: "other", paidByMemberId: aki });
      await insertBill(db, a, same, "pending");
      await insertBill(db, a, same, "pending");
      await assert.rejects(insertBill(db, a, { ...same, paidByMemberId: ben }, "pending"), /already in use/, "a changed payer is a different bill");
      const noOne = await first(db.select().from(schema.bills).where(eq(schema.bills.id, same.id)));
      assert.equal(noOne.paidByMemberId, aki);
      await db.delete(schema.bills).where(eq(schema.bills.id, same.id));
      await db.delete(schema.cards).where(eq(schema.cards.id, homeless));
    });

    await check("the agent tools: who_owes_whom builds its summary in code; add_bill and log_charge take shared and paid by (by name)", async () => {
      const ctx = (hid: string): ToolContext => ({ db, householdId: hid, state: () => stateOf(hid), appUrl: new URL("http://127.0.0.1:3123") });
      const tool = (name: string) => tools.find(t => t.name === name)!;
      const run = (hid: string, name: string, input: unknown) => tool(name).run(ctx(hid), tool(name).input.parse(input) as never);
      assert.equal(tool("who_owes_whom").scope, "read");
      assert.deepEqual(Object.keys(tool("who_owes_whom").input.shape), []);
      assert.deepEqual([...(toolInputSchema(tool("add_bill")) as unknown as { required: string[] }).required].sort(),
        ["amount", "biller", "business_bp", "category", "due", "id", "memberId", "monthly", "paidBy", "shared"]);
      assert.ok((toolInputSchema(tool("log_charge")) as unknown as { required: string[] }).required.includes("shared"));
      assert.equal(tools.filter(t => t.scope === "read").length, 11);

      const mine = JSON.parse(await run(a, "who_owes_whom", {}));
      assert.deepEqual([mine.summary, mine.currency, mine.split, mine.transfers.length], ["Aki owes Ben ¥9,000.", "JPY", true, 1]);
      const live = JSON.parse(await run(a, "who_owes_whom", {}));
      assert.deepEqual(live.transfers, [{ from: "Aki", to: "Ben", amountMinor: 9_000 }]);
      assert.deepEqual(live.members, [
        { name: "Ben", shareBp: 6000, paidMinor: 30_000, shareMinor: 21_000, netMinor: 9_000 },
        { name: "Aki", shareBp: 4000, paidMinor: 5_000, shareMinor: 14_000, netMinor: -9_000 }]);
      const alone = JSON.parse(await run(b, "who_owes_whom", {}));
      assert.deepEqual([alone.summary, alone.split, alone.transfers], ["Only one person is in this household, so there is nothing to split.", false, []]);

      const id = randomUUID();
      const pending = await run(a, "add_bill", { id, biller: "Fictional gas", amount: "6000", due: "2026-11-25", category: "utilities", memberId: null, monthly: true, shared: true, paidBy: " aki " });
      assert.match(pending, /waiting in To check/);
      const row = await first(db.select().from(schema.bills).where(eq(schema.bills.id, id)));
      assert.deepEqual([row.status, row.memberId, row.paidByMemberId, row.repeatDay], ["pending", null, aki, 25]);
      await assert.rejects(run(a, "add_bill", { id: randomUUID(), biller: "X", amount: "1", due: TODAY, category: "other", memberId: null, monthly: false, shared: true, paidBy: "Nobody" }), /Nobody called Nobody is in this household/);
      await assert.rejects(run(a, "add_bill", { id: randomUUID(), biller: "X", amount: "1", due: TODAY, category: "other", memberId: null, monthly: false, shared: true, paidBy: null }), /Say who pays/);
      await assert.rejects(run(a, "add_bill", { id: randomUUID(), biller: "X", amount: "1", due: TODAY, category: "other", memberId: null, monthly: false, shared: false, paidBy: "Aki" }), /set shared to true/);
      await assert.rejects(run(a, "add_bill", { id: randomUUID(), biller: "X", amount: "1", due: TODAY, category: "other", memberId: ben, monthly: false, shared: true, paidBy: "Aki" }), /leave memberId empty/);
      await assert.rejects(run(b, "add_bill", { id: randomUUID(), biller: "X", amount: "1", due: TODAY, category: "other", memberId: null, monthly: false, shared: true, paidBy: "Ben" }), /second person/);
      await assert.rejects(run(b, "add_bill", { id: randomUUID(), biller: "X", amount: "1", due: TODAY, category: "other", memberId: null, monthly: false, shared: true, paidBy: "Aki" }), /second person/);
      await assert.rejects(memberByName(db, b, "Aki"), /Nobody called Aki/, "a name in another household is unknown");
      const plain = randomUUID();
      await run(b, "add_bill", { id: plain, biller: "Fictional plain", amount: "1", due: TODAY, category: "other", memberId: null, monthly: false, shared: null, paidBy: null });
      assert.equal((await first(db.select().from(schema.bills).where(eq(schema.bills.id, plain)))).paidByMemberId, null, "shared and paidBy are optional");

      const charge = randomUUID();
      await run(a, "log_charge", { id: charge, cardId: akiCard, merchant: "Fictional bakery", amount: "800", date: TODAY, category: "other", shared: true });
      assert.deepEqual((await first(db.select().from(schema.charges).where(eq(schema.charges.id, charge)))).shared, true);
      const unshared = randomUUID();
      await run(a, "log_charge", { id: unshared, cardId: akiCard, merchant: "Fictional kiosk", amount: "300", date: TODAY, shared: false });
      assert.equal((await first(db.select().from(schema.charges).where(eq(schema.charges.id, unshared)))).shared, false);
      await assert.rejects(run(b, "log_charge", { id: randomUUID(), cardId: (await first(db.select().from(schema.cards).where(eq(schema.cards.householdId, b)))).id, merchant: "X", amount: "1", date: TODAY, category: "other", shared: true }), /second person/);
      const pendingCount = (await db.select().from(schema.charges).where(and(eq(schema.charges.householdId, a), eq(schema.charges.status, "pending")))).length;
      assert.ok(pendingCount >= 2, "agent charges wait in To check");
      assert.equal(splitBalance((await stateOf(a)).split, TODAY).items, 2, "pending agent items do not count");
    });

    await check("Mark settled: the transfers are recorded with today's date, the balance goes to zero, the sentence and the runway do not move, a second tap does nothing", async () => {
      const before = await baseline(a);
      const done = await settleUp(db, a);
      assert.deepEqual(done, [{ fromId: aki, toId: ben, amountMinor: 9_000 }]);
      const rows = await db.select().from(schema.settlements).where(eq(schema.settlements.householdId, a));
      assert.deepEqual(rows.map(r => [r.fromMemberId, r.toMemberId, r.amountMinor, r.currency, r.through]), [[aki, ben, 9_000, "JPY", TODAY]]);
      const settled = await events(a, "settled");
      assert.deepEqual([settled.length, settled[0].title, settled[0].amountMinor, settled[0].currency, settled[0].refId], [1, "Aki paid Ben ¥9,000", 9_000, "JPY", rows[0].id]);
      assert.equal(settled[0].body, "Shared costs settled through Nov 14");
      const state = await stateOf(a);
      assert.equal(state.split.settledThrough, TODAY);
      assert.deepEqual(splitBalance(state.split, TODAY).transfers, []);
      assert.deepEqual(await baseline(a), before, "the split moves no money in the engine");
      assert.deepEqual(await settleUp(db, a), []);
      assert.equal((await db.select().from(schema.settlements).where(eq(schema.settlements.householdId, a))).length, 1);
      assert.equal((await events(a, "settled")).length, 1);
      assert.equal(homeSentence(state).lead, before.sentence.lead);
    });

    await check("settle, then a new item: only what is dated after the settlement counts, at the current shares", async () => {
      const dinner = chargeInput.parse({ id: randomUUID(), cardId: akiCard, merchant: "Fictional ramen", amount: "6000", date: "2026-11-16", category: "other", shared: true });
      await insertCharge(db, a, dinner, "confirmed", "manual");
      const later = "2026-11-20";
      const balance = splitBalance((await stateOf(a, later)).split, later);
      assert.deepEqual(balance.transfers.map(t => transferLine(t, "JPY")), ["Ben owes Aki ¥3,600"], "Aki paid 6,000; Ben owes 60%");
      assert.deepEqual(splitBalance((await stateOf(a)).split, TODAY).transfers, [], "dated after today: not yet");
    });

    await check("a share change after settling never rewrites what was settled", async () => {
      await setShares(db, a, { shares: [{ id: ben, percent: "50" }, { id: aki, percent: "50" }] });
      const later = "2026-11-20";
      assert.deepEqual(splitBalance((await stateOf(a, later)).split, later).transfers.map(t => transferLine(t, "JPY")), ["Ben owes Aki ¥3,000"], "the new item is split at the new shares");
      const rows = await db.select().from(schema.settlements).where(eq(schema.settlements.householdId, a));
      assert.deepEqual(rows.map(r => r.amountMinor), [9_000], "the settled row is as it was");
      assert.equal(splitBalance((await stateOf(a, later)).split, later).items, 1, "the settled items are not counted again");
      await setShares(db, a, { shares: [{ id: ben, percent: "60" }, { id: aki, percent: "40" }] });
    });

    await check("a second settlement later settles only the new item, with its own through date", async () => {
      // The demo clock stays on TODAY, so settle through a later day by moving the row's through date back first.
      await db.update(schema.settlements).set({ through: "2026-11-10" }).where(eq(schema.settlements.householdId, a));
      const done = await settleUp(db, a);
      assert.deepEqual(done, [{ fromId: aki, toId: ben, amountMinor: 9_000 }], "with the first settlement back at Nov 10, the Nov 14 items count again");
      const rows = await db.select().from(schema.settlements).where(eq(schema.settlements.householdId, a));
      assert.deepEqual(rows.map(r => r.through).sort(), ["2026-11-10", TODAY]);
      assert.equal((await stateOf(a)).split.settledThrough, TODAY);
    });

    await check("settle today, then add a shared item dated today: it counts; an item dated today made before settling does not", async () => {
      const f = await seedBen(db, { isDemo: true, name: "SameDay" });
      const fBen = (await members(f))[0].id;
      const fAki = await addMember(db, f, { name: "Aki" });
      const fCard = randomUUID();
      await db.insert(schema.cards).values({ id: fCard, householdId: f, memberId: fAki, label: "Aki Card", closingDay: 31, dueDay: 26, currency: "JPY" });
      const owes = async () => splitBalance((await stateOf(f)).split, TODAY).transfers.map(t => transferLine(t, "JPY"));
      await insertBill(db, f, billInput.parse({ id: randomUUID(), biller: "Fictional before", amount: "10000", due: TODAY, category: "other", paidByMemberId: fBen }), "confirmed");
      await insertBill(db, f, billInput.parse({ id: randomUUID(), biller: "Fictional monthly before", amount: "20000", due: TODAY, category: "other", monthly: true, paidByMemberId: fBen }), "confirmed");
      assert.deepEqual(await owes(), ["Aki owes Ben ¥15,000"], "50/50 of 10,000 and 20,000");
      assert.equal((await settleUp(db, f)).length, 1);
      assert.deepEqual(await owes(), [], "dated today, made before settling: settled, including today's occurrence of the monthly bill");
      assert.equal((await stateOf(f)).split.settledThrough, TODAY);
      const [row] = await db.select().from(schema.settlements).where(eq(schema.settlements.householdId, f));
      assert.ok(row.settledAt instanceof Date && (await stateOf(f)).split.settledAt === row.settledAt.toISOString());
      await insertBill(db, f, billInput.parse({ id: randomUUID(), biller: "Fictional after", amount: "4000", due: TODAY, category: "other", paidByMemberId: fBen }), "confirmed");
      assert.deepEqual(await owes(), ["Aki owes Ben ¥2,000"], "dated today, made after settling: counts");
      await insertCharge(db, f, chargeInput.parse({ id: randomUUID(), cardId: fCard, merchant: "Fictional late grocer", amount: "1000", date: TODAY, category: "other", shared: true }), "confirmed", "manual");
      assert.deepEqual(await owes(), ["Aki owes Ben ¥1,500"], "a charge made after settling counts too (Aki paid 1,000: 2,000 - 500)");
      await insertBill(db, f, billInput.parse({ id: randomUUID(), biller: "Fictional monthly after", amount: "6000", due: TODAY, category: "other", monthly: true, paidByMemberId: fBen }), "confirmed");
      assert.deepEqual(await owes(), ["Aki owes Ben ¥4,500"], "today's occurrence of a monthly bill made after settling counts");
      assert.equal((await settleUp(db, f)).length, 1);
      assert.deepEqual(await owes(), [], "a second settlement the same day settles those");
      const rows = await db.select().from(schema.settlements).where(eq(schema.settlements.householdId, f));
      assert.deepEqual(rows.map(r => [r.through, r.amountMinor]).sort(), [[TODAY, 15_000], [TODAY, 4_500]].sort());
      assert.ok(rows.every(r => r.settledAt instanceof Date));
    });

    await check("removing a shared bill and charge from a settled period leaves the settlements as they were; the split recounts from the rows left", async () => {
      const g = await seedBen(db, { isDemo: true, name: "Removal" });
      const gBen = (await members(g))[0].id;
      const gAki = await addMember(db, g, { name: "Aki" });
      const gCard = randomUUID();
      await db.insert(schema.cards).values({ id: gCard, householdId: g, memberId: gAki, label: "Aki Card", closingDay: 31, dueDay: 26, currency: "JPY" });
      const owes = async () => splitBalance((await stateOf(g)).split, TODAY).transfers.map(t => transferLine(t, "JPY"));
      const settled = billInput.parse({ id: randomUUID(), biller: "Fictional settled rent", amount: "20000", due: TODAY, category: "other", paidByMemberId: gBen });
      const settledCharge = chargeInput.parse({ id: randomUUID(), cardId: gCard, merchant: "Fictional settled grocer", amount: "4000", date: TODAY, category: "other", shared: true });
      await insertBill(db, g, settled, "confirmed"); await insertCharge(db, g, settledCharge, "confirmed", "manual");
      assert.deepEqual(await owes(), ["Aki owes Ben ¥8,000"], "Ben paid 20,000, Aki paid 4,000: each owes half of 24,000");
      assert.equal((await settleUp(db, g)).length, 1);
      const settlements = async () => (await db.select().from(schema.settlements).where(eq(schema.settlements.householdId, g))).map(r => [r.through, r.amountMinor, r.fromMemberId, r.toMemberId]);
      const recorded = await settlements();
      assert.deepEqual(recorded, [[TODAY, 8_000, gAki, gBen]]);
      const open = billInput.parse({ id: randomUUID(), biller: "Fictional open bill", amount: "6000", due: TODAY, category: "other", paidByMemberId: gBen });
      await insertBill(db, g, open, "confirmed");
      assert.deepEqual(await owes(), ["Aki owes Ben ¥3,000"]);
      assert.equal(await removeBill(db, g, settled.id), true);
      assert.equal(await removeCharge(db, g, settledCharge.id), true);
      assert.deepEqual(await settlements(), recorded, "what was settled stays as it was");
      assert.deepEqual(await owes(), ["Aki owes Ben ¥3,000"], "the balance counts only what is dated after the settlement, so it does not move");
      assert.equal(await removeBill(db, g, open.id), true);
      assert.deepEqual(await owes(), [], "removing the open item recounts from the rows left");
      assert.deepEqual(await settlements(), recorded);
    });

    await check("pending shared items count for nothing and keep their payer through To check; confirming makes them count", async () => {
      const c = await seedBen(db, { isDemo: true, name: "Pending" });
      const cBen = (await members(c))[0].id;
      const cAki = await addMember(db, c, { name: "Aki" });
      await db.update(schema.households).set({ splitSince: "2026-10-01" }).where(eq(schema.households.id, c));
      const cCard = randomUUID();
      await db.insert(schema.cards).values({ id: cCard, householdId: c, memberId: cAki, label: "Aki Card", closingDay: 31, dueDay: 26, currency: "JPY" });
      const rent = billInput.parse({ id: randomUUID(), biller: "Fictional rent", amount: "80000", due: "2026-10-27", category: "housing", monthly: true, paidByMemberId: cBen });
      const groceries = chargeInput.parse({ id: randomUUID(), cardId: cCard, merchant: "Fictional greens", amount: "2000", date: "2026-11-10", category: "other", shared: true });
      await insertBill(db, c, rent, "pending");
      await insertCharge(db, c, groceries, "pending", "voice");
      let state = await stateOf(c);
      assert.deepEqual(splitBalance(state.split, TODAY).transfers, []);
      const rows = toCheck(state);
      assert.equal(rows.find(r => r.id === rent.id)!.detail, "Housing · Personal · due Oct 27 · every month · shared, paid by Ben");
      assert.equal(rows.find(r => r.id === groceries.id)!.detail, "Aki Card · Nov 10 · Other · Personal · Voice · shared");
      assert.equal(await confirmPending(db, b, "bill", rent.id), false, "another household cannot confirm it");
      assert.equal(await confirmPending(db, c, "bill", rent.id), true);
      assert.equal(await confirmPending(db, c, "charge", groceries.id), true);
      state = await stateOf(c);
      const balance = splitBalance(state.split, TODAY);
      // Rent: Oct 27 only (Nov 27 has not come), 80,000 paid by Ben; groceries 2,000 paid by Aki; all at 50/50.
      assert.equal(balance.items, 2);
      assert.deepEqual(balance.transfers.map(t => transferLine(t, "JPY")), ["Aki owes Ben ¥39,000"]);
      const next = "2026-11-27";
      assert.deepEqual(splitBalance((await stateOf(c, next)).split, next).transfers.map(t => transferLine(t, "JPY")), ["Aki owes Ben ¥79,000"], "the Nov 27 occurrence counts on the day");
      assert.deepEqual(splitBalance((await stateOf(a)).split, TODAY).transfers.map(t => transferLine(t, "JPY")), [], "household a is not affected");
    });

    await check("three members with uneven shares: the owner pays the remainder, two transfers sum to the creditor's balance", async () => {
      const d = await seedBen(db, { isDemo: true, name: "Three" });
      const dBen = (await members(d))[0].id;
      const dAki = await addMember(db, d, { name: "Aki" });
      const dMio = await addMember(db, d, { name: "Mio" });
      assert.deepEqual(await sharesOf(d), [["Ben", 3334], ["Aki", 3333], ["Mio", 3333]]);
      assert.equal((await events(d, "member_added")).length, 2);
      assert.equal((await household(d)).splitSince, TODAY, "the second member set it; the third left it alone");
      await setShares(db, d, { shares: [{ id: dBen, percent: "50" }, { id: dAki, percent: "30" }, { id: dMio, percent: "20" }] });
      const card = randomUUID();
      await db.insert(schema.cards).values({ id: card, householdId: d, memberId: dAki, label: "Aki Card", closingDay: 31, dueDay: 26, currency: "JPY" });
      await insertBill(db, d, billInput.parse({ id: randomUUID(), biller: "Fictional utilities", amount: "100000", due: TODAY, category: "utilities", paidByMemberId: dBen }), "confirmed");
      await insertCharge(db, d, chargeInput.parse({ id: randomUUID(), cardId: card, merchant: "Fictional outing", amount: "40000", date: TODAY, category: "other", shared: true }), "confirmed", "manual");
      const balance = splitBalance((await stateOf(d)).split, TODAY);
      assert.deepEqual(balance.members.map(m => [m.name, m.paidMinor, m.shareMinor, m.netMinor]), [["Ben", 100_000, 70_000, 30_000], ["Aki", 40_000, 42_000, -2_000], ["Mio", 0, 28_000, -28_000]]);
      assert.deepEqual(balance.transfers.map(t => transferLine(t, "JPY")), ["Mio owes Ben ¥28,000", "Aki owes Ben ¥2,000"]);
      assert.equal(balance.transfers.reduce((a, t) => a + t.amountMinor, 0), 30_000);
      assert.equal((await settleUp(db, d)).length, 2);
      assert.equal((await events(d, "settled")).length, 2);
      assert.deepEqual(splitBalance((await stateOf(d)).split, TODAY).transfers, []);
      await assert.rejects(setShares(db, d, { shares: [{ id: dBen, percent: "50" }, { id: dAki, percent: "50" }] }), /every person/, "all three must be named");
    });

    await check("rounding: three equal members and a ¥100 bill lose and create no yen; a USD item is converted at the household's rate", async () => {
      const e = await seedBen(db, { isDemo: true, name: "Rounding" });
      const eBen = (await members(e))[0].id;
      const eAki = await addMember(db, e, { name: "Aki" });
      const eMio = await addMember(db, e, { name: "Mio" });
      await insertBill(db, e, billInput.parse({ id: randomUUID(), biller: "Fictional pack", amount: "100", due: TODAY, category: "other", paidByMemberId: eBen }), "confirmed");
      let balance = splitBalance((await stateOf(e)).split, TODAY);
      assert.deepEqual(balance.members.map(m => [m.name, m.shareMinor, m.netMinor]), [["Ben", 34, 66], ["Aki", 33, -33], ["Mio", 33, -33]]);
      assert.equal(balance.members.reduce((a, m) => a + m.netMinor, 0), 0);
      assert.equal(balance.transfers.reduce((a, t) => a + t.amountMinor, 0), 66);
      // $100.00 at 150 yen a dollar, stored in dollars on a yen household
      await db.insert(schema.bills).values({ householdId: e, paidByMemberId: eAki, biller: "Fictional dollar bill", amountMinor: 10_000, currency: "USD", due: TODAY, category: "other" });
      balance = splitBalance((await stateOf(e)).split, TODAY);
      assert.deepEqual(balance.members.map(m => m.paidMinor), [100, 15_000, 0]);
      assert.equal(balance.members.reduce((a, m) => a + m.shareMinor, 0), 15_100);
      assert.equal(balance.transfers.reduce((a, t) => a + t.amountMinor, 0), balance.members.filter(m => m.netMinor > 0).reduce((a, m) => a + m.netMinor, 0));
      assert.ok(eMio);
    });

    await check("Settings: a shared bill names who pays; an owner drops the payer; names stay unique; a card with shared charges keeps its owner", async () => {
      const gas = await first(db.select().from(schema.bills).where(and(eq(schema.bills.householdId, a), eq(schema.bills.biller, "Fictional landlord"))));
      await updateSettings(db, a, settingsInput.parse({ kind: "bill-owner", id: gas.id, memberId: "", paidByMemberId: aki }));
      assert.equal((await first(db.select().from(schema.bills).where(eq(schema.bills.id, gas.id)))).paidByMemberId, aki);
      await updateSettings(db, a, settingsInput.parse({ kind: "bill-owner", id: gas.id, memberId: ben, paidByMemberId: aki }));
      const owned = await first(db.select().from(schema.bills).where(eq(schema.bills.id, gas.id)));
      assert.deepEqual([owned.memberId, owned.paidByMemberId], [ben, null], "an owner means not shared, so no payer");
      await updateSettings(db, a, settingsInput.parse({ kind: "bill-owner", id: gas.id, memberId: "", paidByMemberId: ben }));
      await assert.rejects(updateSettings(db, a, settingsInput.parse({ kind: "bill-owner", id: gas.id, memberId: "", paidByMemberId: benB })), SettingsError, "another household's member");
      const solo = await first(db.select().from(schema.bills).where(and(eq(schema.bills.householdId, b), eq(schema.bills.biller, "Rent"))));
      await assert.rejects(updateSettings(db, b, settingsInput.parse({ kind: "bill-owner", id: solo.id, memberId: "", paidByMemberId: benB })), /second person/);
      await updateSettings(db, b, settingsInput.parse({ kind: "bill-owner", id: solo.id, memberId: "" }));
      assert.equal((await first(db.select().from(schema.bills).where(eq(schema.bills.id, solo.id)))).paidByMemberId, null);

      const rename = async (id: string, name: string) => {
        const now = await db.select({ id: schema.members.id, name: schema.members.displayName, shareBp: schema.members.shareBp }).from(schema.members).where(eq(schema.members.householdId, a));
        await savePeople(db, a, { people: now.map(m => ({ id: m.id, name: m.id === id ? name : m.name, percent: String(m.shareBp / 100) })) });
      };
      await assert.rejects(rename(aki, "BEN"), /already in this household/);
      await rename(aki, "Akiko");
      assert.deepEqual((await events(a, "member_renamed")).map(e => e.title), ["Aki is now called Akiko"]);
      await rename(aki, "Aki");
      const cardRow = await first(db.select().from(schema.cards).where(eq(schema.cards.id, akiCard)));
      const form = { kind: "card", id: akiCard, label: cardRow.label, closingDay: 31, dueDay: 26, limit: "300000" };
      await assert.rejects(updateSettings(db, a, settingsInput.parse({ ...form, memberId: "" })), /needs an owner/);
      await updateSettings(db, a, settingsInput.parse({ ...form, memberId: ben }));
      assert.equal((await first(db.select().from(schema.cards).where(eq(schema.cards.id, akiCard)))).memberId, ben, "the payer of its shared charges follows the card");
      assert.ok((await events(a, "settings_updated")).some(e => e.title === "Aki Card now belongs to Ben"), "a card owner change names the card and the person");
      await updateSettings(db, a, settingsInput.parse({ ...form, memberId: aki }));
    });

    await check("household scope: another household's settlements, shares and items never reach this one; settling one leaves the other alone", async () => {
      const other = await seedBen(db, { isDemo: true, name: "Scope" });
      const otherAki = await addMember(db, other, { name: "Aki" });
      const otherBen = (await members(other))[0].id;
      await insertBill(db, other, billInput.parse({ id: randomUUID(), biller: "Fictional scope bill", amount: "10000", due: TODAY, category: "other", paidByMemberId: otherBen }), "confirmed");
      const aBefore = JSON.stringify((await stateOf(a)).split);
      assert.deepEqual(splitBalance((await stateOf(other)).split, TODAY).transfers.map(t => transferLine(t, "JPY")), ["Aki owes Ben ¥5,000"]);
      assert.equal(JSON.stringify((await stateOf(a)).split), aBefore);
      assert.equal((await settleUp(db, other)).length, 1);
      assert.equal(JSON.stringify((await stateOf(a)).split), aBefore, "settling the other household did not touch this one");
      assert.deepEqual((await db.select().from(schema.settlements).where(eq(schema.settlements.householdId, other))).map(r => [r.fromMemberId, r.toMemberId]), [[otherAki, otherBen]]);
      assert.equal((await db.select().from(schema.settlements).where(eq(schema.settlements.householdId, a))).every(r => [ben, aki].includes(r.fromMemberId) && [ben, aki].includes(r.toMemberId)), true);
      assert.equal((await db.select().from(schema.settlements).where(eq(schema.settlements.householdId, b))).length, 0);
      const names = (await stateOf(a)).split.members.map(m => m.name);
      assert.deepEqual(names, ["Ben", "Aki"]);
    });

    await check("the snapshot carries shares, split start, payer, shared and the settlements, and still validates", async () => {
      const snap = await loadHouseholdSnapshot(db, a, { events: true });
      HouseholdSnapshot.parse(JSON.parse(JSON.stringify(snap)));
      assert.deepEqual(snap.members.map(m => [m.displayName, m.shareBp]), [["Ben", 6000], ["Aki", 4000]]);
      assert.equal(snap.household.splitSince, TODAY);
      assert.equal(snap.bills.find(x => x.biller === "Fictional landlord")!.paidByMemberId, ben);
      assert.equal(snap.charges.find(x => x.merchant === "Fictional grocer")!.shared, true);
      assert.equal(snap.charges.find(x => x.merchant === "Fictional kiosk")!.shared, false);
      assert.deepEqual(snap.settlements.map(x => [x.fromMemberId, x.toMemberId, x.amountMinor, x.currency, x.through]), [[aki, ben, 9_000, "JPY", "2026-11-10"], [aki, ben, 9_000, "JPY", TODAY]]);
      assert.deepEqual((await loadHouseholdSnapshot(db, b, { events: false })).settlements, []);
      assert.deepEqual((await loadHouseholdSnapshot(db, b, { events: false })).members.map(m => m.shareBp), [10_000]);
      assert.throws(() => HouseholdSnapshot.parse({ ...snap, settlements: [{ ...snap.settlements[0], extra: 1 }] }));
    });

    await check("Ben's seeded household is untouched by all of it: the same numbers as the demo", async () => {
      const fresh = await seedBen(db, { isDemo: true, name: "Fresh" });
      const state = await stateOf(fresh);
      assert.deepEqual(toCheck(state).map(r => r.detail), toCheck(benMoney).map(r => r.detail));
      assert.equal(homeSentence(state).emphasis, "¥18,780 short on the 27th.");
      assert.equal(safeToSpend(state, 0).amount, 0);
      assert.equal(roomOnCard(state, state.cards.find(c => c.label === "Card B")!.id).room, 173_770);
      assert.equal(state.bank, 67_000);
    });

    console.log(`Split checks passed (${passed}).`);
  } finally {
    await pg.close();
  }
}

main().catch(error => {
  console.error("Split tests failed", error);
  process.exit(1);
});
