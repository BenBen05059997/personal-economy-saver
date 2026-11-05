// Regular costs (D54): the one name key, the regular-cost rule over a short window (up, down, same, started, stopped, not yet),
// the "this month" rule, the what-changed line, and Ben's seeded household through loadSpending. Fictional data only; PGlite.
// Run from the project root: npx tsx --tsconfig ./tsconfig.json scripts/regular-test.ts
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { and, eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { householdDate } from "@/db/account";
import { confirmPending } from "@/db/confirm";
import { seedBen } from "@/db/seed";
import { loadSpending } from "@/db/spending";
import { regularCosts, type RegularCost } from "@/lib/money/regular";
import { monthBounds, nameKey, normalise, spendingItems, type SpendingInput, type SpendItem } from "@/lib/money/spending";
import type { Bill, Charge } from "@/lib/money/types";

const TODAY = "2026-11-14";
const bill = (over: Partial<Bill> & Pick<Bill, "id" | "biller" | "amount" | "due" | "category">): Bill => ({ businessBp: 0, status: "confirmed", ...over });
const charge = (over: Partial<Charge> & Pick<Charge, "id" | "merchant" | "amount" | "date" | "category">): Charge =>
  ({ cardId: "card-k", businessBp: 0, source: "manual", status: "confirmed", ...over });

// Kenji in Osaka: monthly electricity read from each month's bill ("…10月分"), water, gas due at month end, a gym that repeats,
// a streaming plan that starts this month, rent that rises from Nov 25 (D48), a bakery and a climbing gym paid by card.
const kenji: SpendingInput = {
  homeCurrency: "JPY",
  cards: [{ id: "card-k", ownerId: "kenji" }],
  split: { members: [{ id: "kenji" }] },
  bills: [
    bill({ id: "p9", biller: "Fictional Power 9月分", amount: 8_000, due: "2026-09-25", category: "utilities" }),
    bill({ id: "p10", biller: "Fictional Power 10月分", amount: 8_500, due: "2026-10-25", category: "utilities" }),
    bill({ id: "p11", biller: "Fictional Power (2026年11月分)", amount: 9_700, due: "2026-11-25", category: "utilities" }),
    bill({ id: "w9", biller: "Fictional Water Sep 2026", amount: 3_000, due: "2026-09-10", category: "utilities" }),
    bill({ id: "w10", biller: "Fictional Water Oct 2026", amount: 3_000, due: "2026-10-10", category: "utilities" }),
    bill({ id: "w11", biller: "Fictional Water Nov 2026", amount: 2_600, due: "2026-11-10", category: "utilities" }),
    bill({ id: "g9", biller: "Fictional Gas 2026/09", amount: 4_100, due: "2026-09-28", category: "utilities" }),
    bill({ id: "g10", biller: "Fictional Gas 2026/10", amount: 4_300, due: "2026-10-28", category: "utilities" }),
    bill({ id: "gym", biller: "Fictional Gym", amount: 7_000, due: "2026-08-05", category: "health", repeatUnit: "month", repeatDay: 5 }),
    bill({ id: "stream", biller: "Fictional StreamBox", amount: 1_490, due: "2026-11-20", category: "subscriptions", repeatUnit: "month", repeatDay: 20 }),
    bill({ id: "rent", biller: "Fictional Heights rent", amount: 90_000, due: "2026-07-25", category: "housing", repeatUnit: "month", repeatDay: 25, nextAmount: 95_000, nextAmountFrom: "2026-11-25" }),
    bill({ id: "cover", biller: "Fictional home cover", amount: 12_000, due: "2025-10-01", category: "insurance", repeatUnit: "year" }),
    bill({ id: "trip", biller: "Fictional Kinosaki inn", amount: 30_000, due: "2026-10-12", category: "travel" }),
    bill({ id: "waiting", biller: "Fictional Power 12月分", amount: 9_900, due: "2026-11-30", category: "utilities", status: "pending" }),
  ],
  charges: [
    charge({ id: "climb9", merchant: "Fictional Kawa Climbing", amount: 6_000, date: "2026-09-03", category: "health" }),
    charge({ id: "climb10", merchant: "Fictional Kawa Climbing", amount: 6_000, date: "2026-10-03", category: "health" }),
    charge({ id: "bake10", merchant: "Fictional Bakery", amount: 800, date: "2026-10-02", category: "food" }),
    charge({ id: "bake11", merchant: "Fictional Bakery", amount: 600, date: "2026-11-02", category: "food" }),
    charge({ id: "bake11b", merchant: "Fictional Bakery", amount: 900, date: "2026-11-20", category: "food" }), // after today: not yet counted
    charge({ id: "bakeother", merchant: "Fictional Bakery", amount: 500, date: "2026-09-08", category: "other" }), // another category: another cost
  ],
};
const WINDOW = { from: "2026-09-01", to: "2026-11-30" };
const itemsOf = (input: SpendingInput, from = WINDOW.from, to = WINDOW.to) => spendingItems(input, from, to);
const brief = (c: RegularCost) => [c.label, c.status, c.months.map(m => m.amountMinor), c.changeMinor];

async function main() {
  let passed = 0;
  async function check(name: string, run: () => void | Promise<void>) { await run(); passed++; console.log(`✓ ${name}`); }

  await check("nameKey: month and date words go, so each month's bill of one cost shares a key; other names stay apart", () => {
    const hikari = ["Hikari Denki 10月分", "Hikari Denki 11月分", "Hikari Denki", "Hikari Denki (11月分)", "Hikari Denki 2026年11月", "Hikari Denki 令和8年11月分",
      "Hikari Denki - Nov 2026", "HIKARI DENKI November", "Hikari Denki 2026/11", "Hikari Denki 2026-11", "Hikari Denki 11/2026", "Ｈｉｋａｒｉ　Ｄｅｎｋｉ・11月分",
      "【11月分】Hikari Denki", "Hikari Denki Sept. 2026", "Hikari Denki November 25, 2026", "  hikari   denki  "];
    for (const name of hikari) assert.equal(nameKey(name), "hikari denki", name);
    assert.notEqual(nameKey("Rent"), nameKey("Rental car"));
    assert.deepEqual(["Mayfair Bakery", "7-Eleven", "Tokyo Gas 2026-11-25", "11月分", "Kissa Midori café"].map(nameKey), ["mayfair bakery", "7-eleven", "tokyo gas", "11月分", "kissa midori café"],
      "a month name inside a word stays; a name that is only a date keeps its text");
    assert.equal(normalise("  Ｔｒａｖｅｌ 　 Hotel "), "travel hotel", "the one normaliser: NFKC, lower case, spaces made one");
  });

  await check("regularCosts: up, down, same, started, stopped and not yet, with each month's amount oldest first", () => {
    const result = regularCosts(itemsOf(kenji), "JPY", TODAY);
    assert.deepEqual([result.currency, result.month, result.months], ["JPY", "2026-11", ["2026-09", "2026-10", "2026-11"]]);
    assert.deepEqual(result.items.map(brief), [
      ["Fictional Kawa Climbing", "stopped", [6_000, 6_000, 0], -6_000],
      ["Fictional Heights rent", "up", [90_000, 90_000, 95_000], 5_000],
      ["Fictional StreamBox", "started", [0, 0, 1_490], 1_490],
      ["Fictional Power (2026年11月分)", "up", [8_000, 8_500, 9_700], 1_200],
      ["Fictional Water Nov 2026", "down", [3_000, 3_000, 2_600], -400],
      ["Fictional Bakery", "down", [0, 800, 600], -200],
      ["Fictional Gym", "same", [7_000, 7_000, 7_000], 0],
      ["Fictional Gas 2026/10", "not_yet", [4_100, 4_300, 0], null],
    ], "changed first by the size of the change, then the rest by this month; the inn, the yearly cover, the other-category bakery and the pending bill are not regular");
    assert.equal(result.changedLine,
      "Fictional Kawa Climbing stopped · Fictional Heights rent up ¥5,000 · Fictional StreamBox started · Fictional Power (2026年11月分) up ¥1,200 · Fictional Water Nov 2026 down ¥400 · Fictional Bakery down ¥200 so far");
    const power = result.items.find(c => c.category === "utilities" && c.status === "up")!;
    assert.deepEqual([power.key, power.kind, power.categoryLabel, power.thisMinor, power.lastMinor, power.soFar, power.usualDay], ["utilities:fictional power", "bill", "Utilities", 9_700, 8_500, false, null]);
    const gas = result.items.find(c => c.status === "not_yet")!;
    assert.deepEqual([gas.usualDay, gas.thisMinor, gas.lastMinor, gas.soFar], [28, 0, 4_300, false]);
    assert.deepEqual(result.items.find(c => c.label === "Fictional Bakery")!.months.map(m => m.count), [0, 1, 1], "a charge after today is not counted yet");
  });

  await check("this month: a bill due later this month counts, a charge after today does not; a cost not yet due is not stopped", () => {
    const early = regularCosts(itemsOf(kenji), "JPY", "2026-11-02");
    const status = (r: typeof early, label: string) => r.items.find(c => c.label.startsWith(label))!.status;
    assert.equal(status(early, "Fictional Kawa Climbing"), "not_yet", "usually on the 3rd; today is the 2nd");
    assert.equal(status(regularCosts(itemsOf(kenji), "JPY", "2026-11-03"), "Fictional Kawa Climbing"), "not_yet", "on the usual day it may still come");
    assert.equal(status(regularCosts(itemsOf(kenji), "JPY", "2026-11-04"), "Fictional Kawa Climbing"), "stopped");
    assert.equal(status(early, "Fictional Power"), "up", "the Nov 25 bill is known on Nov 2");
    assert.equal(status(early, "Fictional StreamBox"), "started", "the Nov 20 occurrence is known");
    assert.equal(regularCosts(itemsOf(kenji), "JPY", "2026-11-29").items.find(c => c.label.startsWith("Fictional Gas"))!.status, "stopped", "past the 28th and nothing");
    const monthEnd = regularCosts(itemsOf(kenji), "JPY", "2026-11-30");
    const bakery = monthEnd.items.find(c => c.label === "Fictional Bakery")!;
    assert.deepEqual([bakery.status, bakery.thisMinor, bakery.soFar], ["up", 1_500, false], "on the last day the month is complete");
  });

  await check("a monthly repeating bill with no occurrence this month has stopped, whatever the day; a series that started last month is regular", () => {
    const gym = itemsOf(kenji).filter(i => i.id === "gym" && i.date < "2026-11-01");
    const r = regularCosts(gym, "JPY", "2026-11-01");
    assert.deepEqual(r.items.map(brief), [["Fictional Gym", "stopped", [7_000, 7_000, 0], -7_000]]);
    assert.equal(r.changedLine, "Fictional Gym stopped");
    const late: SpendingInput = { ...kenji, charges: [], bills: [bill({ id: "net", biller: "Fictional Net", amount: 5_000, due: "2026-10-15", category: "phone_internet", repeatUnit: "month", repeatDay: 15 })] };
    assert.deepEqual(regularCosts(itemsOf(late), "JPY", TODAY).items.map(brief), [["Fictional Net", "same", [0, 5_000, 5_000], 0]]);
  });

  await check("a D48 amount change on a repeating bill shows as up in the month it applies, same after; a six-month window and a two-month one", () => {
    const december = regularCosts(itemsOf(kenji, "2026-10-01", "2026-12-31"), "JPY", "2026-12-14");
    assert.deepEqual(brief(december.items.find(c => c.label === "Fictional Heights rent")!), ["Fictional Heights rent", "same", [90_000, 95_000, 95_000], 0]);
    const six = regularCosts(itemsOf(kenji, "2026-06-01"), "JPY", TODAY, 6);
    assert.deepEqual(six.months, ["2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11"]);
    assert.deepEqual(six.items.find(c => c.label === "Fictional Heights rent")!.months.map(m => m.amountMinor), [0, 90_000, 90_000, 90_000, 90_000, 95_000]);
    const two = regularCosts(itemsOf(kenji, "2026-10-01"), "JPY", TODAY, 2);
    assert.deepEqual(two.items.map(c => c.label).sort(), ["Fictional Bakery", "Fictional Gym", "Fictional Heights rent", "Fictional Power (2026年11月分)", "Fictional StreamBox", "Fictional Water Nov 2026"].sort(),
      "two months: Kawa Climbing and the gas (October only in the window) are not regular");
    for (const bad of [1, 25, 2.5]) assert.throws(() => regularCosts([], "JPY", TODAY, bad), /2 to 24 months/, String(bad));
    assert.throws(() => regularCosts([], "JPY", "2026-11"), /YYYY-MM-DD/);
  });

  await check("a USD household counts cents; nothing changed says so; an empty history has no regular costs", () => {
    const lee: SpendingInput = { homeCurrency: "USD", cards: [{ id: "card-us" }], split: { members: [{ id: "lee" }] },
      bills: [bill({ id: "studio", biller: "Fictional studio rent", amount: 1_250.5, due: "2026-09-01", category: "housing", repeatUnit: "month", repeatDay: 1 })],
      charges: [
        charge({ id: "c9", merchant: "Fictional Corner Coffee", amount: 18.25, date: "2026-09-04", category: "food", cardId: "card-us" }),
        charge({ id: "c10", merchant: "Fictional Corner Coffee", amount: 12.5, date: "2026-10-04", category: "food", cardId: "card-us" }),
        charge({ id: "c11", merchant: "Fictional Corner Coffee", amount: 25, date: "2026-11-04", category: "food", cardId: "card-us" }),
      ] };
    const r = regularCosts(itemsOf(lee), "USD", TODAY);
    assert.deepEqual(r.items.map(brief), [["Fictional Corner Coffee", "up", [1_825, 1_250, 2_500], 1_250], ["Fictional studio rent", "same", [125_050, 125_050, 125_050], 0]]);
    assert.equal(r.changedLine, "Fictional Corner Coffee up $12.50 so far");
    const still = regularCosts(itemsOf({ ...lee, charges: [] }), "USD", TODAY);
    assert.equal(still.changedLine, "No change in your regular costs this month.");
    assert.deepEqual(regularCosts([], "USD", TODAY).items, []);
    assert.equal(regularCosts([], "USD", TODAY).changedLine, "No change in your regular costs this month.");
  });

  await check("the same name in another category is another cost; the newest item gives the label and the kind", () => {
    const mixed: SpendItem[] = [
      ...itemsOf(kenji).filter(i => i.label.startsWith("Fictional Power")),
      { kind: "charge", id: "x", label: "Fictional Power 11月分", repeat: null, date: "2026-11-26", amountMinor: 100, category: "other", businessBp: 0, ownerId: null, documentId: null, cardId: null },
    ];
    const r = regularCosts(mixed, "JPY", "2026-11-30");
    assert.deepEqual(r.items.map(c => [c.key, c.label, c.kind]), [["utilities:fictional power", "Fictional Power (2026年11月分)", "bill"]]);
  });

  // ------------------------------------------------------------ the database
  const pg = new PGlite();
  const db = drizzle(pg, { schema });
  try {
    await migrate(db, { migrationsFolder: "./drizzle" });
    const ben = await seedBen(db, { isDemo: true });
    const today = await householdDate(db, ben);
    const load = async (hid: string) => {
      const from = "2026-09-01", to = monthBounds(today.slice(0, 7)).last;
      return regularCosts(spendingItems(await loadSpending(db, hid, { from, to }), from, to), "JPY", today);
    };

    await check("Ben's seeded household through loadSpending: the café and the market changed; rent, phone and CloudBox the same; Hikari Denki not in yet (November's is pending)", async () => {
      assert.equal(today, "2026-11-14");
      const r = await load(ben);
      assert.deepEqual(r.items.map(brief), [
        ["Kissa Midori café", "down", [0, 2_800, 1_880], -920],
        ["Minato Fresh Market", "up", [5_960, 8_640, 8_820], 180],
        ["Rent", "same", [82_000, 82_000, 82_000], 0],
        ["Mobaile Tsushin", "same", [4_800, 4_800, 4_800], 0],
        ["CloudBox Plus", "same", [1_980, 1_980, 1_980], 0],
        ["Hikari Denki", "not_yet", [8_640, 10_020, 0], null],
      ]);
      assert.equal(r.items.find(c => c.label === "Hikari Denki")!.usualDay, 25, "September's and October's bills were due on the 25th");
      assert.equal(r.changedLine, "Kissa Midori café down ¥920 so far · Minato Fresh Market up ¥180 so far");
      const confirmed = await seedBen(db, { isDemo: true });
      const [hikari] = await db.select().from(schema.bills).where(and(eq(schema.bills.householdId, confirmed), eq(schema.bills.status, "pending")));
      assert.equal(await confirmPending(db, confirmed, "bill", hikari.id), true);
      const after = await load(confirmed);
      assert.deepEqual(after.items.map(brief), [["Hikari Denki", "up", [8_640, 10_020, 11_220], 1_200], ...r.items.slice(0, -1).map(brief)],
        "confirmed, November's Hikari Denki bill (due Nov 27) is a known bill this month: up ¥1,200 on October");
      assert.equal(after.changedLine, "Hikari Denki up ¥1,200 · Kissa Midori café down ¥920 so far · Minato Fresh Market up ¥180 so far");
    });

    await check("bills named by month in the database share one cost through the name key", async () => {
      const other = await seedBen(db, { isDemo: true });
      for (const [biller, amountMinor, due] of [["Fictional Denki 9月分", 8_640, "2026-09-25"], ["Fictional Denki 10月分", 9_100, "2026-10-25"], ["Fictional Denki 11月分", 11_220, "2026-11-27"]] as const) {
        await db.insert(schema.bills).values({ householdId: other, biller, amountMinor, currency: "JPY", due, category: "utilities", businessBp: 3000 });
      }
      const denki = (await load(other)).items.find(c => c.key === "utilities:fictional denki")!;
      assert.deepEqual(brief(denki), ["Fictional Denki 11月分", "up", [8_640, 9_100, 11_220], 2_120]);
      assert.ok(!(await load(ben)).items.some(c => c.label.startsWith("Fictional")), "the other household's bills are not Ben's");
    });

    console.log(`Regular cost checks passed (${passed}).`);
  } finally {
    await pg.close();
  }
}

main().catch(error => {
  console.error("Regular cost tests failed", error);
  process.exit(1);
});
