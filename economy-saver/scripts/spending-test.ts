// Where did the money go (D53): the one item rule, the month view built on it, the search over months, the loader and the
// travel category in the database. Fictional data only; PGlite, no credentials.
// Run from the project root: npx tsx --tsconfig ./tsconfig.json scripts/spending-test.ts
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "@/db/schema";
import { householdDate } from "@/db/account";
import { chargeInput, insertCharge } from "@/db/charges";
import { confirmPending } from "@/db/confirm";
import { loadMoneyState } from "@/db/household";
import { convertMinor, fromMinor } from "@/db/money";
import { seedBen } from "@/db/seed";
import { loadSpending } from "@/db/spending";
import { businessLine, monthByCategory } from "@/lib/money/month";
import { monthlyRoom } from "@/lib/money/plan";
import { datesIn, expandBills, nextAmountOf } from "@/lib/money/repeat";
import { HISTORY_MONTHS, monthBounds, monthName, monthsBack, nameKey, normalise, searchLine, searchSpending, spendingItems, type SpendingInput } from "@/lib/money/spending";
import type { Bill, Charge } from "@/lib/money/types";
import { benMoney } from "@/lib/sample/ben";

const TODAY = "2026-11-14";
const bill = (over: Partial<Bill> & Pick<Bill, "id" | "biller" | "amount" | "due" | "category">): Bill => ({ businessBp: 0, status: "confirmed", ...over });
const charge = (over: Partial<Charge> & Pick<Charge, "id" | "merchant" | "amount" | "date" | "category">): Charge =>
  ({ cardId: "card-mio", businessBp: 0, source: "manual", status: "confirmed", ...over });

// A two-person Tokyo household: Mio (owner, Card M) and Ren; a shared rent that rises on Oct 25 (D48), a Hakone inn and a flight.
const stored: Bill[] = [
  bill({ id: "rent", biller: "Fictional Heights rent", amount: 90_000, due: "2026-06-25", category: "housing", businessBp: 3000, repeatUnit: "month", repeatDay: 25, nextAmount: 95_000, nextAmountFrom: "2026-10-25" }),
  bill({ id: "cover", biller: "Fictional trip cover", amount: 8_000, due: "2025-10-01", category: "insurance", repeatUnit: "year", ownerId: "ren" }),
  bill({ id: "tax", biller: "Fictional ward tax", amount: 12_000, due: "2026-08-31", category: "government_tax", ownerId: "ren" }),
  bill({ id: "old", biller: "Fictional old bill", amount: 1_000, due: "2026-07-31", category: "other" }),
  bill({ id: "wait", biller: "Fictional pending rent", amount: 5_000, due: "2026-09-10", category: "housing", status: "pending", repeatUnit: "month", repeatDay: 10 }),
];
const charges: Charge[] = [
  charge({ id: "inn", merchant: "Hakone Yumoto Hotel", amount: 32_000, date: "2026-10-10", category: "travel" }),
  charge({ id: "flight", merchant: "Fictional Air flight to Sapporo", amount: 14_800, date: "2026-09-02", category: "travel", cardId: "card-house" }),
  charge({ id: "bakery", merchant: "Minato bakery", amount: 2_000, date: "2026-11-03", category: "food", shared: true }),
  charge({ id: "lunch", merchant: "Fictional soba lunch", amount: 1_100, date: "2026-11-12", category: "food", businessBp: 10_000 }),
  charge({ id: "held", merchant: "Fictional hostel", amount: 4_000, date: "2026-11-01", category: "travel", status: "pending" }),
  charge({ id: "later", merchant: "Fictional hotel next month", amount: 9_000, date: "2026-12-02", category: "travel" }),
];
const mio: SpendingInput = {
  homeCurrency: "JPY", bills: stored, charges,
  cards: [{ id: "card-mio", ownerId: "mio" }, { id: "card-house" }],
  split: { members: [{ id: "mio" }, { id: "ren" }] },
};
/** A database error naming the constraint (drizzle wraps the driver's error in `cause`). */
const violates = (constraint: string) => (error: unknown) => String((error as { cause?: { message?: string } }).cause?.message ?? "").includes(constraint);
const RANGE = { from: "2026-09-01", to: TODAY };
const rows = (items: ReturnType<typeof spendingItems>) => items.map(i => [i.kind, i.id, i.label, i.date, i.amountMinor, i.ownerId]);

async function main() {
  let passed = 0;
  async function check(name: string, run: () => void | Promise<void>) { await run(); passed++; console.log(`✓ ${name}`); }

  // ------------------------------------------------------------ months
  await check("month helpers: bounds, names, months back across a year, and a bad month refused", () => {
    assert.deepEqual(monthBounds("2026-02"), { first: "2026-02-01", last: "2026-02-28" });
    assert.deepEqual(monthBounds("2028-02"), { first: "2028-02-01", last: "2028-02-29" });
    assert.equal(monthName("2026-11"), "November");
    assert.deepEqual([monthsBack("2026-11", 1), monthsBack("2026-11", 3), monthsBack("2026-02", 3), monthsBack("2026-11", 12)], ["2026-11", "2026-09", "2025-12", "2025-12"]);
    for (const bad of ["2026-13", "2026-1", "26-11", "2026-11-01", ""]) assert.throws(() => monthBounds(bad), /YYYY-MM/, bad);
  });

  // ------------------------------------------------------------ the item rule
  await check("spendingItems: each repeating occurrence at its day's amount (D48), one-offs and charges in range, pending and out-of-range rows left out, whose by D52", () => {
    assert.deepEqual(rows(spendingItems(mio, RANGE.from, RANGE.to)), [
      ["charge", "flight", "Fictional Air flight to Sapporo", "2026-09-02", 14_800, null],
      ["bill", "rent", "Fictional Heights rent", "2026-09-25", 90_000, null],
      ["bill", "cover", "Fictional trip cover", "2026-10-01", 8_000, "ren"],
      ["charge", "inn", "Hakone Yumoto Hotel", "2026-10-10", 32_000, "mio"],
      ["bill", "rent", "Fictional Heights rent", "2026-10-25", 95_000, null],
      ["charge", "bakery", "Minato bakery", "2026-11-03", 2_000, null],
      ["charge", "lunch", "Fictional soba lunch", "2026-11-12", 1_100, "mio"],
    ]);
    const august = spendingItems(mio, "2026-08-01", "2026-08-31");
    assert.deepEqual(rows(august), [["bill", "rent", "Fictional Heights rent", "2026-08-25", 90_000, null], ["bill", "tax", "Fictional ward tax", "2026-08-31", 12_000, "ren"]]);
    assert.deepEqual(spendingItems(mio, "2026-11-01", "2026-11-30").find(i => i.id === "rent")!.date, "2026-11-25", "the rest of the month is in when the range says so");
    const inn = spendingItems(mio, "2026-10-10", "2026-10-10")[0];
    assert.deepEqual(inn, { kind: "charge", id: "inn", label: "Hakone Yumoto Hotel", repeat: null, date: "2026-10-10", amountMinor: 32_000, category: "travel", businessBp: 0, ownerId: "mio", documentId: null, cardId: "card-mio" });
    assert.equal(spendingItems(mio, "2026-08-25", "2026-08-25")[0].cardId, null, "a bill has no card");
    assert.deepEqual(spendingItems(mio, "2026-08-01", "2026-10-31").map(i => [i.id, i.repeat]),
      [["rent", "month"], ["tax", null], ["flight", null], ["rent", "month"], ["cover", "year"], ["inn", null], ["rent", "month"]], "D54: the bill's repeat unit; null for one-offs and charges");
    assert.deepEqual(spendingItems(mio, "2025-01-01", "2025-06-30"), [], "nothing before the series start");
  });

  await check("spendingItems: the engine's expanded occurrences give the same items as the stored rows (startsOn, ids <id>@<date>)", () => {
    const expanded: SpendingInput = { ...mio, bills: expandBills(stored, TODAY, "2027-12-31") };
    assert.ok(expanded.bills.some(b => b.id === "rent@2026-11-25") && !expanded.bills.some(b => b.id.startsWith("rent@2026-10")), "the engine's list starts today");
    for (const [from, to] of [["2026-06-01", "2026-12-31"], ["2026-10-01", "2026-10-31"], ["2027-01-01", "2027-12-31"]]) {
      assert.deepEqual(spendingItems(expanded, from, to), spendingItems(mio, from, to), `${from}..${to}`);
    }
    assert.equal(spendingItems(mio, "2027-10-01", "2027-10-31").find(i => i.id === "cover")!.amountMinor, 8_000, "a yearly bill in its month a year on");
  });

  await check("spendingItems: a USD household counts cents; a document id is carried", () => {
    const usd: SpendingInput = { homeCurrency: "USD", cards: [{ id: "card-us" }], split: { members: [{ id: "lee" }] },
      bills: [bill({ id: "studio", biller: "Fictional studio rent", amount: 1_250.5, due: "2026-09-01", category: "housing", repeatUnit: "month", repeatDay: 1, nextAmount: 1_300, nextAmountFrom: "2026-11-01" })],
      charges: [{ ...charge({ id: "motel", merchant: "Fictional Lakeside Motel hotel", amount: 89.99, date: "2026-10-03", category: "travel", cardId: "card-us" }), documentId: "doc-1" }] };
    assert.deepEqual(spendingItems(usd, "2026-09-01", "2026-11-14").map(i => [i.label, i.date, i.amountMinor, i.documentId]), [
      ["Fictional studio rent", "2026-09-01", 125_050, null], ["Fictional studio rent", "2026-10-01", 125_050, null],
      ["Fictional Lakeside Motel hotel", "2026-10-03", 8_999, "doc-1"], ["Fictional studio rent", "2026-11-01", 130_000, null],
    ]);
    const travel = searchSpending(spendingItems(usd, "2026-09-01", "2026-11-14"), "travel", "USD", { from: "2026-09-01", to: "2026-11-14" });
    assert.equal(searchLine(travel), "Travel: $89.99 in October (1 item); nothing in the other 2 months. $89.99 in all.");
    const rent = searchSpending(spendingItems(usd, "2026-09-01", "2026-11-14"), "rent", "USD", { from: "2026-09-01", to: "2026-11-14" });
    assert.equal(searchLine(rent), `"rent": $1,300 in November (1 item), $1,250.50 in October (1 item), $1,250.50 in September (1 item). $3,801 in all.`);
  });

  // ------------------------------------------------------------ the month view on the one rule
  await check("monthByCategory: built from spendingItems for any month; today's month by default; Ben's November unchanged", () => {
    const oct = monthByCategory(mio, TODAY, "2026-10");
    assert.deepEqual([oct.month, oct.name, oct.totalMinor], ["2026-10", "October", 8_000 + 32_000 + 95_000]);
    assert.deepEqual(oct.categories.map(c => [c.category, c.totalMinor, c.businessMinor]), [["housing", 95_000, 28_500], ["travel", 32_000, 0], ["insurance", 8_000, 0]]);
    assert.deepEqual([oct.sharedMinor, oct.byMember], [95_000, [{ id: "mio", minor: 32_000 }, { id: "ren", minor: 8_000 }]]);
    const nov = monthByCategory(mio, TODAY);
    assert.equal(nov.month, "2026-11");
    assert.deepEqual(nov.categories.flatMap(c => c.items.map(i => [i.label, i.date])), [["Fictional Heights rent", "2026-11-25"], ["Minato bakery", "2026-11-03"], ["Fictional soba lunch", "2026-11-12"]]);
    for (const month of ["2026-08", "2026-09", "2026-10", "2026-11", "2026-12"]) {
      const { first, last } = monthBounds(month);
      const view = monthByCategory(mio, TODAY, month);
      assert.equal(view.totalMinor, spendingItems(mio, first, last).reduce((s, i) => s + i.amountMinor, 0), `${month}: one rule`);
    }
    assert.throws(() => monthByCategory(mio, TODAY, "2026-13"), /YYYY-MM/);
    assert.deepEqual(monthByCategory(benMoney, benMoney.today).totalMinor, 152_230, "Ben's November (category-test) is the same");
  });

  // ------------------------------------------------------------ search
  const items = spendingItems(mio, RANGE.from, RANGE.to);
  const search = (query: string) => searchSpending(items, query, "JPY", RANGE);

  await check("search: a hotel is found by its name and by Travel; NFKC and case are ignored; every word must match", () => {
    const labels = (q: string) => search(q).months.flatMap(m => m.items.map(i => i.label));
    assert.deepEqual(labels("hotel"), ["Hakone Yumoto Hotel"]);
    assert.deepEqual(labels("travel"), ["Hakone Yumoto Hotel", "Fictional Air flight to Sapporo"], "the category key, newest first; the pending hostel and December are out");
    for (const q of ["TRAVEL", "Ｔｒａｖｅｌ", "  travel  "]) assert.deepEqual(labels(q), labels("travel"), q);
    assert.equal(search("  Ｈａｋｏｎｅ \u3000 HOTEL ").query, normalise("hakone hotel"), "the query goes through the one normaliser (D54) that nameKey uses");
    assert.equal(nameKey("Hakone Yumoto Hotel 10月分"), normalise("Hakone Yumoto Hotel"));
    assert.deepEqual(labels("hakone hotel"), ["Hakone Yumoto Hotel"]);
    assert.deepEqual(labels("hakone flight"), []);
    assert.deepEqual(labels("phone & internet"), []);
    assert.deepEqual(labels("government"), [], "the ward tax is in August, outside the range");
    assert.deepEqual(labels("insurance"), ["Fictional trip cover"], "a category label");
    assert.deepEqual(labels("food"), ["Fictional soba lunch", "Minato bakery"], "a bare category");
    assert.deepEqual([search("travel").category, search("Food").category, search("hotel").category, search("").category], ["travel", "food", null, null]);
  });

  await check("search: grouped by month newest first, every month of the range listed, totals by month and category", () => {
    const rent = search("rent");
    assert.equal(rent.query, "rent");
    assert.deepEqual(rent.months.map(m => [m.month, m.name, m.totalMinor, m.items.map(i => i.date)]), [
      ["2026-11", "November", 0, []], ["2026-10", "October", 95_000, ["2026-10-25"]], ["2026-09", "September", 90_000, ["2026-09-25"]],
    ]);
    assert.equal(rent.totalMinor, 185_000);
    assert.equal(searchLine(rent), `"rent": ¥95,000 in October (1 item), ¥90,000 in September (1 item); nothing in the other 1 month. ¥185,000 in all.`);
    const all = search("");
    assert.equal(all.totalMinor, items.reduce((s, i) => s + i.amountMinor, 0));
    assert.deepEqual(all.months[1].byCategory, [{ category: "housing", label: "Housing", totalMinor: 95_000 }, { category: "travel", label: "Travel", totalMinor: 32_000 }, { category: "insurance", label: "Insurance", totalMinor: 8_000 }]);
    assert.deepEqual(all.months[1].items.map(i => i.date), ["2026-10-25", "2026-10-10", "2026-10-01"], "newest first in a month");
    for (const m of all.months) assert.equal(m.totalMinor, m.byCategory.reduce((s, c) => s + c.totalMinor, 0));
    assert.equal(searchLine(search("travel")), "Travel: ¥32,000 in October (1 item), ¥14,800 in September (1 item); nothing in the other 1 month. ¥46,800 in all.");
    assert.equal(searchLine(all), "Everything: ¥3,100 in November (2 items), ¥135,000 in October (3 items), ¥104,800 in September (2 items). ¥242,900 in all.");
    const none = search("zebra");
    assert.deepEqual([none.totalMinor, none.months.length, none.months.every(m => m.items.length === 0 && m.byCategory.length === 0)], [0, 3, true]);
    assert.equal(searchLine(none), `"zebra": ¥0 in November, ¥0 in October, ¥0 in September. ¥0 in all.`);
  });

  await check("search: a range across the new year names the older year; items outside the range are ignored", () => {
    const range = { from: "2025-12-01", to: "2026-01-31" };
    const winter = searchSpending([...spendingItems(mio, range.from, range.to), ...items], "", "JPY", range);
    assert.deepEqual(winter.months.map(m => m.month), ["2026-01", "2025-12"]);
    assert.equal(searchLine(winter), "Everything: ¥0 in January, ¥0 in December 2025. ¥0 in all.");
  });

  // ------------------------------------------------------------ the database
  const pg = new PGlite();
  const db = drizzle(pg, { schema });
  try {
    await migrate(db, { migrationsFolder: "./drizzle" });
    const a = await seedBen(db, { isDemo: true }), b = await seedBen(db, { isDemo: true });
    const [card] = await db.select().from(schema.cards).where(eq(schema.cards.householdId, a));

    await check("migration 0017: travel is a stored category on bills and charges; an unknown key is still refused", async () => {
      const [owner] = await db.select().from(schema.members).where(and(eq(schema.members.householdId, a), eq(schema.members.role, "owner")));
      await db.insert(schema.bills).values({ householdId: a, biller: "Fictional Hakone ryokan deposit", amountMinor: 20_000, currency: "JPY", due: "2026-09-12", category: "travel", memberId: owner.id });
      await db.insert(schema.bills).values({ householdId: a, biller: "Fictional rent from summer", amountMinor: 70_000, currency: "JPY", due: "2026-07-05", category: "housing", repeatUnit: "month", repeatDay: 5, nextAmountMinor: 72_000, nextAmountFrom: "2026-10-05" });
      await db.insert(schema.bills).values({ householdId: a, biller: "Fictional pending bill", amountMinor: 1_000, currency: "JPY", due: "2026-10-05", category: "travel", status: "pending" });
      await db.insert(schema.bills).values({ householdId: a, biller: "Fictional bill next year", amountMinor: 3_000, currency: "JPY", due: "2027-01-05", category: "other", repeatUnit: "month", repeatDay: 5 });
      await db.insert(schema.charges).values({ householdId: a, cardId: card.id, merchant: "Fictional Peach flight", amountMinor: 11_900, currency: "JPY", date: "2026-10-02", category: "travel", source: "manual" });
      await db.insert(schema.charges).values({ householdId: a, cardId: card.id, merchant: "Fictional USD hotel", amountMinor: 10_000, currency: "USD", date: "2026-11-01", category: "travel", source: "manual" });
      await db.insert(schema.charges).values({ householdId: a, cardId: card.id, merchant: "Fictional summer kiosk", amountMinor: 500, currency: "JPY", date: "2026-06-30", category: "food", source: "manual" });
      await assert.rejects(db.insert(schema.charges).values({ householdId: a, cardId: card.id, merchant: "X", amountMinor: 1, currency: "JPY", date: "2026-10-02", category: "trips", source: "manual" }), violates("charges_category_valid"));
      await assert.rejects(db.insert(schema.bills).values({ householdId: a, biller: "X", amountMinor: 1, currency: "JPY", due: "2026-10-02", category: "trips" }), violates("bills_category_valid"));
    });

    await check("loadSpending: confirmed rows that can fall in the range, a repeating series whole, a USD row converted, nothing of another household", async () => {
      const input = await loadSpending(db, a, { from: "2026-09-01", to: TODAY });
      assert.equal(input.homeCurrency, "JPY");
      const names = input.bills.map(x => x.biller);
      assert.ok(names.includes("Fictional rent from summer"), "a series that started before the range is loaded whole");
      assert.ok(names.includes("Fictional Hakone ryokan deposit"));
      assert.ok(!names.includes("Fictional pending bill") && !names.includes("Fictional bill next year") && names.filter(n => n === "Hikari Denki").length === 2, "pending, after the range (Hikari Denki's September and October bills only)");
      assert.ok(!input.charges.some(c => c.merchant === "Fictional summer kiosk"), "a charge before the range");
      const usd = input.charges.find(c => c.merchant === "Fictional USD hotel")!;
      const usdYen = fromMinor(convertMinor(10_000, "USD", "JPY", benMoney.fxPerUsd), "JPY");
      assert.equal(usd.amount, usdYen, "$100 at the household's rate");
      const found = searchSpending(spendingItems(input, "2026-09-01", TODAY), "rent", "JPY", { from: "2026-09-01", to: TODAY });
      assert.deepEqual(found.months.flatMap(m => m.items.map(i => [i.label, i.date, i.amountMinor])), [
        ["Fictional rent from summer", "2026-11-05", 72_000], ["Rent", "2026-10-27", 82_000], ["Fictional rent from summer", "2026-10-05", 72_000],
        ["Rent", "2026-09-27", 82_000], ["Fictional rent from summer", "2026-09-05", 70_000],
      ]);
      const travel = searchSpending(spendingItems(input, "2026-09-01", TODAY), "travel", "JPY", { from: "2026-09-01", to: TODAY });
      assert.deepEqual(travel.months.map(m => m.totalMinor), [usdYen, 11_900, 20_000 + 47_000]); // Ben's September: the Hakone hotel and the flight
      const other = await loadSpending(db, b, { from: "2026-09-01", to: TODAY });
      assert.ok(!JSON.stringify(other).includes("Fictional"), "household b sees none of a's rows");
      await assert.rejects(loadSpending(db, "", { from: "2026-09-01", to: TODAY }), /household id/);
      await assert.rejects(loadSpending(db, a, { from: TODAY, to: "2026-09-01" }), /spending range/);
      await assert.rejects(loadSpending(db, a, { from: "2026-9-1", to: TODAY }), /spending range/);
    });

    await check("one rule across loaders: Ben's month from loadSpending equals the month from loadMoneyState", async () => {
      const today = await householdDate(db, b);
      const { first, last } = monthBounds(today.slice(0, 7));
      const fromState = monthByCategory(await loadMoneyState(db, b, today), today);
      assert.deepEqual(monthByCategory(await loadSpending(db, b, { from: first, to: last }), today), fromState);
      assert.equal(fromState.totalMinor, 152_230);
      const october = monthByCategory(await loadSpending(db, b, monthBoundsRange("2026-10")), today, "2026-10");
      assert.deepEqual(october.categories.map(c => [c.category, c.totalMinor]), [["housing", 82_000], ["utilities", 10_020], ["phone_internet", 4_800], ["subscriptions", 1_980], ["food", 11_440], ["transport", 14_340], ["other", 7_480]]);
      assert.deepEqual([october.totalMinor, october.businessMinor], [132_060, 31_986], "with October's Hikari Denki bill");
    });

    await check("BROWSER-CHECKS M, S, T: the hand-checked sums of Ben's months, searches, whose lines and the Confirm and charge steps", async () => {
      const today = "2026-11-14", current = today.slice(0, 7), oldest = monthsBack(current, HISTORY_MONTHS);
      const ben = await seedBen(db, { isDemo: true });
      const read = (hid: string) => loadSpending(db, hid, { from: monthBounds(oldest).first, to: monthBounds(current).last });
      const rows = (view: ReturnType<typeof monthByCategory>) => view.categories.map(c => [c.category, c.totalMinor, c.businessMinor, c.items.map(i => `${i.label} ${i.date.slice(5)} ${i.amountMinor}`)]);
      const spending = await read(ben);
      // M1: November
      const november = monthByCategory(spending, today);
      assert.equal(businessLine(november), "Business ¥32,830 of ¥152,230 this month");
      assert.deepEqual(rows(november), [
        ["housing", 82_000, 24_600, ["Rent 11-27 82000"]], ["phone_internet", 4_800, 2_400, ["Mobaile Tsushin 11-20 4800"]], ["subscriptions", 1_980, 1_980, ["CloudBox Plus 11-18 1980"]],
        ["food", 10_700, 0, ["Minato Fresh Market 11-08 7420", "Kissa Midori café 11-12 1880", "Minato Fresh Market 11-13 1400"]],
        ["business_tools", 3_850, 3_850, ["Sora Cloud Hosting 11-04 3850"]],
        ["other", 48_900, 0, ["Kumo Goods Online 11-02 24300", "Tsuki Electronics 11-09 18200", "Yamabiko Outdoor 11-12 6400"]],
      ]);
      // T-A: October and September
      const october = monthByCategory(spending, today, "2026-10");
      assert.equal(businessLine(october, "in October"), "Business ¥31,986 of ¥132,060 in October");
      assert.deepEqual(rows(october).map(r => r.slice(0, 2)), [["housing", 82_000], ["utilities", 10_020], ["phone_internet", 4_800], ["subscriptions", 1_980], ["food", 11_440], ["transport", 14_340], ["other", 7_480]]);
      assert.deepEqual(rows(october).find(r => r[0] === "food")![3], ["Kissa Midori café 10-10 1320", "Minato Fresh Market 10-17 8640", "Kissa Midori café 10-25 1480"]);
      const september = monthByCategory(spending, today, "2026-09");
      assert.deepEqual([september.totalMinor, september.businessMinor], [150_380, 31_572]);
      assert.deepEqual(rows(september).filter(r => r[0] === "utilities" || r[0] === "travel"), [["utilities", 8_640, 2_592, ["Hikari Denki 09-25 8640"]], ["travel", 47_000, 0, ["Kumokaze Air flight 09-21 18400", "Hotel Kazemachi Hakone 09-22 28600"]]]);
      // T-B: the searches, as Plan runs them (twelve months, today as the last day)
      const find = (query: string) => searchSpending(spendingItems(spending, `${oldest}-01`, today), query, "JPY", { from: `${oldest}-01`, to: today });
      assert.equal(searchLine(find("hotel")), "\"hotel\": ¥28,600 in September (1 item); nothing in the other 11 months. ¥28,600 in all.");
      assert.equal(searchLine(find("travel")), "Travel: ¥47,000 in September (2 items); nothing in the other 11 months. ¥47,000 in all.");
      assert.equal(searchLine(find("food")), "Food: ¥10,700 in November (3 items), ¥11,440 in October (3 items), ¥5,960 in September (1 item); nothing in the other 9 months. ¥28,100 in all.");
      assert.equal(searchLine(find("rent")), "\"rent\": ¥82,000 in October (1 item), ¥82,000 in September (1 item), ¥82,000 in August (1 item); nothing in the other 9 months. ¥246,000 in all.");
      assert.equal(searchLine(find("hikari")), "\"hikari\": ¥10,020 in October (1 item), ¥8,640 in September (1 item); nothing in the other 10 months. ¥18,660 in all.");
      assert.ok(find("zzz").months.every(m => m.items.length === 0) && find("zzz").totalMinor === 0);
      // S-A: a second person, Wife, with nothing of her own: the shared total and Ben's
      const together = monthByCategory({ ...spending, split: { members: [...spending.split.members, { id: "wife" }] } }, today);
      const owner = spending.split.members[0].id;
      assert.deepEqual([together.sharedMinor, together.byMember.find(m => m.id === owner)!.minor, together.byMember.find(m => m.id === "wife")!.minor], [88_780, 63_450, 0], "Together ¥88,780 · Ben ¥63,450 · Wife ¥0");
      assert.deepEqual(together.categories.filter(c => c.category === "housing" || c.category === "food").map(c => [c.category, c.sharedMinor, c.byMember.find(m => m.id === owner)!.minor]), [["housing", 82_000, 0], ["food", 0, 10_700]]);
      // M2: confirming Hikari Denki
      const room = monthlyRoom(await loadMoneyState(db, ben, today));
      assert.equal(room, 92_220);
      const [hikari] = await db.select().from(schema.bills).where(and(eq(schema.bills.householdId, ben), eq(schema.bills.status, "pending")));
      assert.equal(await confirmPending(db, ben, "bill", hikari.id), true);
      const confirmed = monthByCategory(await read(ben), today);
      assert.deepEqual(rows(confirmed).find(r => r[0] === "utilities")!.slice(0, 3), ["utilities", 11_220, 3_366]);
      assert.equal(businessLine(confirmed), "Business ¥36,196 of ¥163,450 this month");
      assert.equal(monthlyRoom(await loadMoneyState(db, ben, today)), 81_000, "Plan's room line falls from ¥92,220 to ¥81,000");
      assert.deepEqual(rows(confirmed).filter(r => r[0] !== "utilities").map(r => r.slice(0, 2)), rows(november).map(r => r.slice(0, 2)), "the other rows do not move");
      // M3: a ¥2,000 Minato Fresh Market charge, 25% work → Food ¥12,700 (business ¥500 · personal ¥12,200)
      const [cardB] = await db.select().from(schema.cards).where(and(eq(schema.cards.householdId, ben), eq(schema.cards.label, "Card B")));
      await insertCharge(db, ben, chargeInput.parse({ id: crypto.randomUUID(), cardId: cardB.id, merchant: "Minato Fresh Market", amount: "2000", date: today, category: "food", businessBp: 2500 }), "confirmed", "manual", { madeBy: "form" });
      const food = monthByCategory(await read(ben), today).categories.find(c => c.category === "food")!;
      assert.deepEqual([food.totalMinor, food.businessMinor, food.personalMinor], [12_700, 500, 12_200]);
    });

    await check("nextAmountOf and datesIn: the change a bill carries, in either spelling, and the dates a one-off or a repeating bill falls on", () => {
      assert.deepEqual(nextAmountOf({ nextAmount: 12.5, nextAmountFrom: "2027-01-20" }), { amount: 12.5, from: "2027-01-20" });
      assert.deepEqual(nextAmountOf({ nextAmountMinor: 1250, nextAmountFrom: "2027-01-20" }), { amount: 1250, from: "2027-01-20" });
      assert.deepEqual(nextAmountOf({ nextAmountMinor: 0, nextAmountFrom: "2027-01-20" }), { amount: 0, from: "2027-01-20" });
      assert.equal(nextAmountOf({}), null);
      assert.equal(nextAmountOf({ nextAmountMinor: null, nextAmountFrom: null }), null);
      assert.equal(nextAmountOf({ nextAmount: 5 }), null, "an amount without its date is no change");
      assert.deepEqual(datesIn({ due: "2026-11-20", repeatUnit: null }, "2026-11-14", "2026-12-14"), ["2026-11-20"]);
      assert.deepEqual(datesIn({ due: "2026-11-20" }, "2026-11-21", "2026-12-14"), []);
      assert.deepEqual(datesIn({ due: "2026-11-20", repeatUnit: "month", repeatDay: 20 }, "2026-11-14", "2027-01-31"), ["2026-11-20", "2026-12-20", "2027-01-20"]);
      assert.deepEqual(datesIn({ due: "2026-11-20", repeatUnit: "year" }, "2026-11-14", "2027-12-31"), ["2026-11-20", "2027-11-20"]);
    });

    console.log(`Spending checks passed (${passed}).`);
  } finally {
    await pg.close();
  }
}

const monthBoundsRange = (month: string) => { const { first, last } = monthBounds(month); return { from: first, to: last }; };

main().catch(error => {
  console.error("Spending tests failed", error);
  process.exit(1);
});
