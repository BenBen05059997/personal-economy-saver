// Categories and the business share (D46): the category list and keyword table, the month view's maths, the migration of
// the old free-text categories, the forms' and tools' validation, the snapshot and household scope. PGlite, no credentials.
// Run from the project root: npx tsx --tsconfig ./tsconfig.json scripts/category-test.ts
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "@/db/schema";
import { householdDate } from "@/db/account";
import { billEditInput, billInput, insertBill, updateBill } from "@/db/bills";
import { InputError } from "@/db/input-error";
import { chargeInput, insertCharge } from "@/db/charges";
import { confirmPending } from "@/db/confirm";
import { loadMoneyState } from "@/db/household";
import { seedBen } from "@/db/seed";
import { loadHouseholdSnapshot } from "@/db/snapshot";
import { toolInputSchema, tools, type ToolContext } from "@/lib/agent/tools";
import { cardSummary } from "@/components/home/card-summary";
import { BusinessBp, CATEGORIES, CATEGORY_KEYS, businessBpFromForm, businessPart, categoryLabel, CategoryKeySchema, shareLabel } from "@/lib/money/categories";
import { guessCategory, guessRepeat } from "@/lib/money/categorise";
import { businessLine, monthByCategory, monthText, monthWhen, splitLine } from "@/lib/money/month";
import { expandBills } from "@/lib/money/repeat";
import { addDays, cycle, low, safeToSpend, series, statementItems } from "@/lib/money/runway";
import { monthlyRoom } from "@/lib/money/plan";
import { homeSentence } from "@/lib/money/sentence";
import { toCheck } from "@/lib/money/to-check";
import { sharedBillsComing } from "@/lib/money/family";
import { aboutMoney, majorMoney } from "@/lib/money/format";
import { fundingOptions } from "@/lib/money/options";
import type { Bill, Charge, MoneyState } from "@/lib/money/types";
import { benMoney, benStoredBills } from "@/lib/sample/ben";
import { HouseholdSnapshot } from "@/lib/schema/household";

const summary = (state: MoneyState) => monthByCategory(state, state.today).categories.map(c =>
  [c.category, c.totalMinor, c.businessMinor, c.personalMinor] as const);

async function main() {
  const pg = new PGlite({ extensions: { pg_trgm } });
  const db = drizzle(pg, { schema });
  let passed = 0;
  async function check(name: string, run: () => void | Promise<void>) { await run(); passed++; console.log(`✓ ${name}`); }
  try {
    // ------------------------------------------------------------ the list and the keyword table
    await check("the list: fourteen keys (travel since D53) with their labels in order; the zod enum takes exactly those", () => {
      assert.deepEqual(CATEGORY_KEYS, ["housing", "utilities", "phone_internet", "subscriptions", "food", "transport", "travel", "health", "insurance", "family_shared", "government_tax", "business_tools", "debt", "other"]);
      assert.deepEqual(CATEGORIES.map(c => c.label), ["Housing", "Utilities", "Phone & internet", "Subscriptions", "Food", "Transport", "Travel", "Health", "Insurance", "Family", "Government & tax", "Business tools", "Debt", "Other"]);
      for (const key of CATEGORY_KEYS) assert.equal(CategoryKeySchema.safeParse(key).success, true);
      for (const bad of ["pets", "Housing", "", " housing", "phone", null, undefined, 3]) assert.equal(CategoryKeySchema.safeParse(bad).success, false, String(bad));
      assert.equal(CategoryKeySchema.safeParse("pets").error!.issues[0].message, "Choose a category from the list.");
      assert.equal(categoryLabel("phone_internet"), "Phone & internet");
    });

    await check("the business share: basis points 0 to 10000, business plus personal always add up, the form's three choices", () => {
      for (const bad of [-1, 10_001, 1.5, NaN, "3000"]) assert.equal(BusinessBp.safeParse(bad).success, false, String(bad));
      for (const ok of [0, 1, 3000, 10_000]) assert.equal(BusinessBp.safeParse(ok).success, true);
      let seed = 11;
      const next = () => (seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648);
      for (let i = 0; i < 500; i++) {
        const amount = next() % 3_000_000, bp = next() % 10_001, business = businessPart(amount, bp);
        assert.ok(business >= 0 && business <= amount && Math.abs(business - amount * bp / 10_000) <= 0.5, `${amount} at ${bp}`);
      }
      assert.equal(businessPart(82_000, 3000), 24_600);
      assert.equal(businessPart(5, 5000), 3, "round half up");
      assert.deepEqual([null, "personal", "business", "mixed"].map(c => businessBpFromForm(c, "30")), [0, 0, 10_000, 3000]);
      assert.deepEqual(["12.5", "0", "100", "33.33", " 30 "].map(p => businessBpFromForm("mixed", p)), [1250, 0, 10_000, 3333, 3000]);
      for (const bad of ["101", "-5", "abc", "", "1.234", "30%"]) assert.equal(businessBpFromForm("mixed", bad), null, bad);
      assert.equal(businessBpFromForm("everything", "30"), null);
      assert.deepEqual([0, 10_000, 3000, 1250].map(shareLabel), ["Personal", "Business", "30% business", "12.5% business"]);
    });

    await check("the keyword table: every biller and merchant in Ben's sample, with the expected category and sureness", () => {
      const expected: [string, string, boolean][] = [
        ["Rent", "housing", true], ["Hikari Denki", "utilities", true], ["Mobaile Tsushin", "phone_internet", true],
        ["CloudBox Plus", "subscriptions", true], ["Sora Cloud Hosting", "business_tools", true],
        ["Minato Fresh Market", "food", true], ["Kissa Midori café", "food", true], ["Metro Line commuter pass", "transport", true],
        ["Page & Lantern Books", "other", false], ["Tsuki Electronics", "other", false], ["Yamabiko Outdoor", "other", false], ["Kumo Goods Online", "other", false],
        ["Kumokaze Air flight", "travel", true], ["Hotel Kazemachi Hakone", "travel", true], ["Kaze Taxi", "transport", true], ["Hoshizora Cinema", "other", false],
      ];
      for (const [name, category, sure] of expected) assert.deepEqual(guessCategory(name), { category, sure }, name);
      const names = new Set([...benStoredBills.map(b => b.biller), ...benMoney.charges.map(c => c.merchant)]);
      assert.deepEqual([...names].filter(n => !expected.some(e => e[0] === n)), [], "every sample name is covered by this test");
    });

    await check("the keyword table: common international names, case and plurals, and unknown names", () => {
      const cases: [string, string][] = [
        ["Monthly mortgage", "housing"], ["Electric company", "utilities"], ["Fictional power", "utilities"], ["Green Energy Co", "utilities"], ["City WATER bureau", "utilities"], ["Gas", "utilities"], ["Mobile plan", "phone_internet"],
        ["Fibre internet", "phone_internet"], ["Netflix", "subscriptions"], ["Spotify Premium", "subscriptions"], ["Corner grocery", "food"], ["Farmers Market", "food"],
        ["Café Luna", "food"], ["Uber trip", "transport"], ["Taxi", "transport"], ["Night pharmacy", "health"], ["Dental clinic", "health"],
        ["Car insurance", "insurance"], ["Property tax", "government_tax"], ["Adobe", "business_tools"], ["GitHub", "business_tools"], ["Web hosting", "business_tools"],
        ["Student loan", "debt"], ["Loan repayment", "debt"], ["家賃", "housing"], ["電気代", "utilities"], ["携帯料金", "phone_internet"],
      ];
      for (const [name, category] of cases) assert.deepEqual(guessCategory(name), { category, sure: true }, name);
      for (const name of ["", "   ", "Zebra Supplies", "Marketing agency", "Business class seat", "Brenton Ltd"]) assert.deepEqual(guessCategory(name), { category: "other", sure: false }, `"${name}" matches nothing`);
    });

    await check("the keyword table (Nov 5 walk): Tokyo food, transport, work and pharmacy names", () => {
      const cases: [string, string][] = [
        ["Noodle shop", "food"], ["Udon Taro", "food"], ["Soba house", "food"], ["Curry house", "food"], ["Bento box", "food"], ["Sushi bar", "food"],
        ["Konbini", "food"], ["Cafe Mori", "food"], ["Corner bakery", "food"], ["Ramen Ichi", "food"], ["Izakaya Kaze", "food"], ["Fictional takeout", "food"],
        ["Noodles", "food"], ["駅前ラーメン", "food"], ["のり弁当", "food"], ["コンビニ", "food"],
        ["Pasmo charge", "transport"], ["Shinkansen ticket", "transport"], ["東京フィクション地下鉄 定期", "transport"], ["定期券", "transport"], ["地下鉄", "transport"], ["Design software", "business_tools"], ["Coworking space", "business_tools"], ["駅前薬局", "health"],
      ];
      for (const [name, category] of cases) assert.deepEqual(guessCategory(name), { category, sure: true }, name);
    });

    await check("the keyword table (D53): hotels, inns, flights and booking sites are Travel; commuting stays Transport", () => {
      const cases: [string, string][] = [
        ["Hakone Yumoto Hotel", "travel"], ["Fictional hotels group", "travel"], ["箱根ホテル", "travel"], ["Ryokan Kawasemi", "travel"], ["旅館みどり", "travel"],
        ["Airbnb stay", "travel"], ["Harbour Hostel", "travel"], ["Flight to Sapporo", "travel"], ["Fictional Airline", "travel"], ["ANA domestic", "travel"],
        ["JAL ticket", "travel"], ["Peach Aviation", "travel"], ["Jetstar Japan", "travel"], ["Skymark", "travel"], ["Expedia", "travel"],
        ["Booking.com reservation", "travel"], ["BOOKING.COM", "travel"], ["Agoda", "travel"], ["日本航空", "travel"],
        ["Shinkansen ticket", "transport"], ["Pasmo charge", "transport"], ["Suica top-up", "transport"],
      ];
      for (const [name, category] of cases) assert.deepEqual(guessCategory(name), { category, sure: true }, name);
      for (const name of ["Banana stand", "Booking fee", "Hotelier supplies"]) assert.notEqual(guessCategory(name).category, "travel", `${name} is not travel: whole words only`);
    });

    await check("guessRepeat (D51 prefill): rent, phone and subscriptions every month, insurance and domains every year, the rest one-off", () => {
      for (const name of ["Rent", "家賃", "Phone bill", "Hikari internet", "City Gym", "Netflix", "Fictional Cloud subscription"]) assert.equal(guessRepeat(name), "month", name);
      for (const name of ["Car insurance", "Domain renewal", "Annual fee", "自動車保険"]) assert.equal(guessRepeat(name), "year", name);
      for (const name of ["", "Fictional power", "Zebra Supplies", "Rental car"]) assert.equal(guessRepeat(name), "", name);
    });

    // ------------------------------------------------------------ the month view, pure
    await check("Ben on Nov 14 (pure): six categories, their business parts, October charges and the pending Hikari bill left out", () => {
      const view = monthByCategory(benMoney, benMoney.today);
      assert.deepEqual([view.month, view.name, view.currency], ["2026-11", "November", "JPY"]);
      assert.deepEqual(summary(benMoney), [
        ["housing", 82_000, 24_600, 57_400], ["phone_internet", 4_800, 2_400, 2_400], ["subscriptions", 1_980, 1_980, 0],
        ["food", 10_700, 0, 10_700], ["business_tools", 3_850, 3_850, 0], ["other", 48_900, 0, 48_900],
      ]);
      assert.deepEqual([view.totalMinor, view.businessMinor, view.personalMinor], [152_230, 32_830, 119_400]);
      assert.equal(businessLine(view), "Business ¥32,830 of ¥152,230 this month");
      assert.equal(businessLine(view, monthWhen("October")), "Business ¥32,830 of ¥152,230 in October");
      assert.equal(monthWhen(), "this month");
      const food = view.categories.find(c => c.category === "food")!;
      assert.deepEqual(food.items.map(i => [i.label, i.date, i.amountMinor]), [["Minato Fresh Market", "2026-11-08", 7_420], ["Kissa Midori café", "2026-11-12", 1_880], ["Minato Fresh Market", "2026-11-13", 1_400]]);
      assert.equal(view.categories.find(c => c.category === "housing")!.items[0].date, "2026-11-27");
      assert.equal(splitLine(view, view.categories[0]), "business ¥24,600 · personal ¥57,400");
      assert.equal(splitLine(view, view.categories.find(c => c.category === "food")!), null);
      assert.equal(splitLine(view, view.categories.find(c => c.category === "subscriptions")!), null);
      assert.ok(!view.categories.some(c => c.category === "utilities" || c.category === "transport"), "no Utilities while Hikari is pending, no Transport (October)");
      assert.match(monthText(view), /^November: ¥152,230 in total\. Business ¥32,830 of ¥152,230 this month\.\nHousing ¥82,000 \(business ¥24,600 · personal ¥57,400\): Rent Nov 27 ¥82,000 at 30% business\.\n/);
    });

    await check("whose (D52): one person's household has everything on them or Shared and the parts add up; the business numbers are unchanged", () => {
      const view = monthByCategory(benMoney, benMoney.today);
      assert.equal(view.byMember.length, benMoney.split.members.length);
      for (const c of [...view.categories, view]) assert.equal(c.sharedMinor + c.byMember.reduce((s, m) => s + m.minor, 0), c.totalMinor);
      const ids = benMoney.split.members.map(m => m.id);
      for (const i of view.categories.flatMap(c => c.items)) assert.ok(i.ownerId === null || ids.includes(i.ownerId), "an item is Shared or a member's");
    });

    await check("month maths: a mixed share rounds per item and the parts add up; every category total is the sum of its items", () => {
      const charge = (over: Partial<Charge>): Charge => ({ id: randomUUID(), cardId: "card-a", merchant: "M", amount: 1, date: "2026-11-05", category: "other", businessBp: 0, source: "manual", status: "confirmed", ...over });
      const state: MoneyState = { ...benMoney, bills: [], charges: [
        charge({ merchant: "A", amount: 1_001, businessBp: 3333, category: "food" }), charge({ merchant: "B", amount: 1_001, businessBp: 3333, category: "food" }),
        charge({ merchant: "C", amount: 5, businessBp: 5000, category: "food" }), charge({ merchant: "D", amount: 7, businessBp: 10_000, category: "debt" }),
      ] };
      const view = monthByCategory(state, state.today);
      const food = view.categories[0], debt = view.categories[1];
      assert.deepEqual([food.category, food.totalMinor, food.businessMinor, food.personalMinor], ["food", 2_007, 334 + 334 + 3, 2_007 - 671]);
      assert.deepEqual([debt.category, debt.totalMinor, debt.businessMinor, debt.personalMinor], ["debt", 7, 7, 0]);
      for (const c of view.categories) {
        assert.equal(c.totalMinor, c.items.reduce((s, i) => s + i.amountMinor, 0));
        assert.equal(c.businessMinor + c.personalMinor, c.totalMinor);
      }
      assert.equal(view.businessMinor + view.personalMinor, view.totalMinor);
      assert.deepEqual(monthByCategory({ ...state, charges: [] }, state.today).categories, []);
      assert.match(monthText(monthByCategory({ ...state, charges: [] }, state.today)), /nothing confirmed yet/);
    });

    await check("month maths: a monthly bill counts once, at its occurrence, even when that day has passed; pending bills and charges, other months and statements stay out", () => {
      const stored: Bill[] = [
        { id: "early", biller: "Early monthly", amount: 1_000, due: "2026-08-03", category: "subscriptions", businessBp: 0, status: "confirmed", repeatUnit: "month", repeatDay: 3 },
        { id: "later", biller: "Later monthly", amount: 2_000, due: "2026-09-20", category: "utilities", businessBp: 5000, status: "confirmed", repeatUnit: "month", repeatDay: 20 },
        { id: "future", biller: "Starts in December", amount: 3_000, due: "2026-12-05", category: "debt", businessBp: 0, status: "confirmed", repeatUnit: "month", repeatDay: 5 },
        { id: "oneoff", biller: "One-off in month", amount: 4_000, due: "2026-11-30", category: "health", businessBp: 0, status: "confirmed" },
        { id: "oldoff", biller: "One-off in October", amount: 5_000, due: "2026-10-30", category: "health", businessBp: 0, status: "confirmed" },
        { id: "pending", biller: "Pending monthly", amount: 6_000, due: "2026-11-25", category: "debt", businessBp: 0, status: "pending", repeatUnit: "month", repeatDay: 25 },
      ];
      const today = benMoney.today;
      const charge = (merchant: string, date: string, status: Charge["status"]): Charge => ({ id: merchant, cardId: "card-a", merchant, amount: 100, date, category: "food", businessBp: 0, source: "manual", status });
      const state: MoneyState = { ...benMoney, bills: expandBills(stored, today, addDays(today, 59)),
        charges: [charge("In November", "2026-11-01", "confirmed"), charge("Pending one", "2026-11-14", "pending"), charge("October", "2026-10-31", "confirmed"), charge("December", "2026-12-01", "confirmed")] };
      assert.ok(!state.bills.some(b => b.id.startsWith("early@2026-11")), "the engine's list has dropped the passed Nov 3 occurrence");
      const view = monthByCategory(state, today);
      assert.deepEqual(view.categories.map(c => [c.category, c.items.map(i => [i.label, i.date])]), [
        ["utilities", [["Later monthly", "2026-11-20"]]], ["subscriptions", [["Early monthly", "2026-11-03"]]], ["food", [["In November", "2026-11-01"]]], ["health", [["One-off in month", "2026-11-30"]]],
      ]);
      assert.deepEqual([view.totalMinor, view.businessMinor], [1_000 + 2_000 + 100 + 4_000, 1_000]);
      assert.equal(state.statements.length, 1, "a closed statement exists in the state and is not read");
      // The same series in December and in a month that does not have day 31.
      const dec = monthByCategory(state, "2026-12-14");
      assert.deepEqual(dec.categories.map(c => c.items.map(i => i.label)).flat().sort(), ["December", "Early monthly", "Later monthly", "Starts in December"]);
      const short = expandBills([{ ...stored[0], id: "thirty-one", due: "2026-01-31", repeatUnit: "month", repeatDay: 31 }], "2026-02-10", "2026-03-31");
      assert.deepEqual(monthByCategory({ ...benMoney, bills: short, charges: [] }, "2026-02-10").categories[0].items.map(i => i.date), ["2026-02-28"]);
    });

    await check("month maths (D48): a yearly bill counts once in its anniversary month; a changed amount counts at the amount of the occurrence in that month, including the months before today", () => {
      const base = { biller: "", amount: 1_000, due: "", category: "subscriptions" as const, businessBp: 0, status: "confirmed" as const };
      const stored = [
        { ...base, id: "gym", biller: "Fictional gym", due: "2026-08-03", repeatUnit: "month" as const, repeatDay: 3, nextAmount: 1_500, nextAmountFrom: "2026-11-03" },
        { ...base, id: "cloud", biller: "Fictional Cloud", amount: 12_000, due: "2025-11-20", repeatUnit: "year" as const, nextAmount: 13_000, nextAmountFrom: "2027-11-20" },
      ];
      const month = (today: string) => {
        const state = { ...benMoney, today, bills: expandBills(stored, today, addDays(today, 60)), charges: [], cancelNotices: [] };
        return monthByCategory(state, today).categories.flatMap(c => c.items.map(i => [i.label, i.date, i.amountMinor]));
      };
      assert.deepEqual(month("2026-11-14"), [["Fictional gym", "2026-11-03", 1_500], ["Fictional Cloud", "2026-11-20", 12_000]], "Nov 3 is the boundary date: the new amount, though it has passed; the yearly bill is in its month");
      assert.deepEqual(month("2026-10-14"), [["Fictional gym", "2026-10-03", 1_000]], "October: the old amount, and the yearly bill is not due");
      assert.deepEqual(month("2027-11-14"), [["Fictional gym", "2027-11-03", 1_500], ["Fictional Cloud", "2027-11-20", 13_000]], "a year on: the new yearly amount applies from its date");
      assert.deepEqual(month("2027-03-14").map(row => row[0]), ["Fictional gym"], "no yearly bill in March");
    });

    await check("US household: cents, not dollars", () => {
      const usd: MoneyState = { ...benMoney, homeCurrency: "USD", fxPerUsd: 1, bills: [{ ...benMoney.bills[0], amount: 19.99, startAmount: 19.99, due: "2026-11-18", businessBp: 5000 }], charges: [] };
      const view = monthByCategory(usd, usd.today);
      assert.deepEqual([view.currency, view.totalMinor, view.businessMinor, view.personalMinor], ["USD", 1_999, 1_000, 999]);
      assert.equal(businessLine(view), "Business $10 of $19.99 this month");
      const personal = monthByCategory({ ...usd, bills: usd.bills.map(b => ({ ...b, businessBp: 0 })), charges: usd.charges.map(c => ({ ...c, businessBp: 0 })) }, usd.today);
      assert.ok(personal.totalMinor > 0 && personal.businessMinor === 0);
      assert.equal(businessLine(personal), "All personal this month", "no business share this month: no 'Business $0 of …'");
    });

    await check("US household: every dollar-to-cents factor (To check, options, the pot and family rows) keeps $12.50 as 1250", () => {
      const usd: MoneyState = { ...benMoney, homeCurrency: "USD", fxPerUsd: 1, paypal: 0, bank: 1_200, cards: [], charges: [], statements: [], cancelNotices: [], pots: [], pendingPots: [], balanceUpdates: [{ id: "u", amount: 1_250.5, madeBy: "form" } as never], bills: [] };
      const pending: Bill = { ...benMoney.bills[0], id: "pb", biller: "Fictional rent", amount: 900, due: "2026-11-20", status: "pending", repeatUnit: "month", repeatDay: 20, nextAmount: 12.5, nextAmountFrom: "2027-01-20", cancelBy: undefined, businessBp: 0 };
      const rows = toCheck({ ...usd, bills: [pending] });
      assert.equal(rows.find(r => r.kind === "balance")!.title, "Bank balance → $1,250.50", "a USD balance update keeps its cents");
      assert.match(rows.find(r => r.kind === "bill")!.detail!, /· every month · \$12\.50 from Jan 20/, "a USD bill's next amount keeps its cents");
      const discount = fundingOptions({ ...usd, bank: 0, invoices: [{ ...benMoney.invoices.find(i => i.status === "sent")!, amountUsd: 250.1 }], bills: [{ ...pending, status: "confirmed", due: "2026-11-20", amount: 400, repeatUnit: undefined, nextAmount: undefined, nextAmountFrom: undefined }] }).rows.find(r => r.id === "discount");
      assert.ok(discount, "a sent invoice and a gap give the early-payment option");
      assert.equal(discount.cost, 5, "2% of $250.10 is $5.002: cents, so $5");
      assert.equal(fundingOptions({ ...usd, bank: 0, invoices: [{ ...benMoney.invoices.find(i => i.status === "sent")!, amountUsd: 252.6 }], bills: [{ ...pending, status: "confirmed", due: "2026-11-20", amount: 400, repeatUnit: undefined, nextAmount: undefined, nextAmountFrom: undefined }] }).rows.find(r => r.id === "discount")!.cost, 5.05, "2% of $252.60 is $5.05, not a whole dollar");
      assert.equal(majorMoney(12.5, "USD"), "$12.50");
      assert.equal(majorMoney(1200, "JPY"), "¥1,200");
      assert.equal(aboutMoney(1_250, "USD"), "about $12.50");
      assert.equal(aboutMoney(6_000, "JPY"), "about ¥6,000");
      const shared: MoneyState = { ...usd, bills: [{ ...pending, status: "confirmed", repeatUnit: undefined, nextAmount: undefined, nextAmountFrom: undefined, amount: 12.5, due: addDays(usd.today, 3) }] };
      assert.deepEqual(sharedBillsComing(shared).map(row => [row.biller, row.amountMinor]), [["Fictional rent", 1_250]], "a shared $12.50 bill is 1250 cents in the family list");
    });

    // ------------------------------------------------------------ the database
    await migrate(db, { migrationsFolder: "./drizzle" });
    const a = await seedBen(db, { isDemo: true }), b = await seedBen(db, { isDemo: true });
    const stateOf = async (hid: string) => loadMoneyState(db, hid, await householdDate(db, hid));

    await check("a seeded Try it household shows the same month as the sample; the runway numbers are the demo's", async () => {
      const state = await stateOf(a);
      assert.deepEqual(summary(state), summary(benMoney));
      assert.equal(homeSentence(state).emphasis, "¥18,780 short on the 27th.");
      assert.equal(safeToSpend(state, 0).amount, 0);
      const [cardA, cardB] = ["Card A", "Card B"].map(label => cardSummary(state, state.cards.find(c => c.label === label)!.id));
      assert.deepEqual([cardA.owed, cardA.limitLeft, cardB.owed, cardB.limitLeft], [86_450, 413_550, 61_000, 239_000]);
      assert.equal(monthlyRoom(state), 92_220);
      const rows = await db.select().from(schema.bills).where(eq(schema.bills.householdId, a));
      assert.deepEqual(rows.map(r => [r.biller, r.category, r.businessBp]).sort(), [["CloudBox Plus", "subscriptions", 10_000], ["Hikari Denki", "utilities", 3000], ["Hikari Denki", "utilities", 3000], ["Hikari Denki", "utilities", 3000], ["Mobaile Tsushin", "phone_internet", 5000], ["Rent", "housing", 3000]]);
    });

    await check("confirming Hikari Denki from To check adds Utilities ¥11,220 at 30% and changes nothing else in the month", async () => {
      const before = await stateOf(a);
      const row = toCheck(before).find(r => r.kind === "bill")!;
      assert.equal(row.detail, "Utilities · 30% business · due Nov 27");
      assert.equal(await confirmPending(db, a, "bill", row.id), true);
      const after = await stateOf(a);
      const utilities = monthByCategory(after, after.today).categories.find(c => c.category === "utilities")!;
      assert.deepEqual([utilities.totalMinor, utilities.businessMinor, utilities.personalMinor, utilities.items.map(i => [i.label, i.date])], [11_220, 3_366, 7_854, [["Hikari Denki", "2026-11-27"]]]);
      assert.deepEqual(summary(after).map(r => r[0]), ["housing", "utilities", "phone_internet", "subscriptions", "food", "business_tools", "other"], "categories.ts order");
      const view = monthByCategory(after, after.today);
      assert.deepEqual([view.totalMinor, view.businessMinor], [163_450, 36_196]);
      assert.equal(homeSentence(after).emphasis, "¥30,000 short on the 27th.", "the runway moved because the bill counts, not because of its category");
    });

    await check("moving Card A's closing day from 31 to 10 keeps what is owed: the Nov 4 and Nov 9 charges fall into a computed closed statement", async () => {
      const c = await seedBen(db, { isDemo: true });
      const [cardA] = await db.select().from(schema.cards).where(and(eq(schema.cards.householdId, c), eq(schema.cards.label, "Card A")));
      const before = await stateOf(c);
      const sentence = homeSentence(before).emphasis, safeBefore = safeToSpend(before, 0).amount;
      assert.equal(cardSummary(before, cardA.id).owed, 86_450);
      await db.update(schema.cards).set({ closingDay: 10 }).where(and(eq(schema.cards.householdId, c), eq(schema.cards.id, cardA.id)));
      const state = await stateOf(c);
      const summaryA = cardSummary(state, cardA.id);
      assert.deepEqual([summaryA.owed, summaryA.limitLeft], [86_450, 413_550], "owed now and limit left do not move");
      const items = statementItems(state).filter(item => item.cardId === cardA.id);
      assert.deepEqual(items.map(item => [item.amount, item.closedOn ?? null, item.closesOn, item.dueOn, item.open]), [
        [58_000, "2026-10-31", "2026-10-31", "2026-11-26", false], // the stored October statement
        [22_050, "2026-11-10", "2026-11-10", "2026-12-26", false], // Nov 4 ¥3,850 + Nov 9 ¥18,200: closed on the 10th, no stored row, computed
        [6_400, null, "2026-12-10", "2027-01-26", true], // Nov 12 is in the open cycle
      ]);
      assert.equal(cycle(state, cardA.id).openTotal, 6_400);
      assert.equal(homeSentence(state).emphasis, sentence, "the sentence keeps its number");
      assert.equal(safeToSpend(state, 0).amount, safeBefore);
      assert.equal(state.statements.length, 1, "the closed statement is computed, not stored");
      // The same cycle, closed and stored (a charge confirmed into it, or the daily job), is the same money.
      await db.insert(schema.cardStatements).values({ householdId: c, cardId: cardA.id, closedOn: "2026-11-10", dueOn: "2026-12-26", currency: "JPY", amountMinor: 22_050 });
      const stored = await stateOf(c);
      assert.deepEqual(statementItems(stored).filter(item => item.cardId === cardA.id).map(item => [item.amount, item.closesOn, item.open]), [[58_000, "2026-10-31", false], [22_050, "2026-11-10", false], [6_400, "2026-12-10", true]]);
      assert.equal(cardSummary(stored, cardA.id).owed, 86_450);
    });

    await check("the migration: the four old free-text values map to keys, anything else to other; charges default to other; shares default to 0", async () => {
      const old = new PGlite({ extensions: { pg_trgm } });
      try {
        const files = readdirSync("./drizzle").filter(f => /^\d{4}_.*\.sql$/.test(f)).sort();
        const last = files.find(f => f.startsWith("0012_"))!; // this suite tests migration 0012 on the database as 0011 left it
        files.splice(files.indexOf(last));
        const statements = (file: string) => readFileSync(`./drizzle/${file}`, "utf8").split("--> statement-breakpoint").map(s => s.trim()).filter(Boolean);
        for (const file of files) for (const statement of statements(file)) await old.exec(statement);
        const household = (await old.query<{ id: string }>("insert into households (name, home_currency) values ('Old', 'JPY') returning id")).rows[0].id;
        const values = ["Housing", "Phone", "Subscriptions", "Utilities · Electricity", "Food", "rent", "", "housing"];
        for (const [i, category] of values.entries()) {
          await old.query("insert into bills (household_id, biller, amount_minor, currency, due, category) values ($1, $2, 100, 'JPY', '2026-11-27', $3)", [household, `Old ${i}`, category]);
        }
        const card = (await old.query<{ id: string }>("insert into cards (household_id, label, closing_day, due_day, currency) values ($1, 'Old card', 31, 26, 'JPY') returning id", [household])).rows[0].id;
        await old.query("insert into charges (household_id, card_id, merchant, amount_minor, currency, date, source) values ($1, $2, 'Old shop', 100, 'JPY', '2026-11-05', 'manual')", [household, card]);
        for (const statement of statements(last)) await old.exec(statement);
        const mapped = (await old.query<{ biller: string; category: string; business_bp: number }>("select biller, category, business_bp from bills order by biller")).rows;
        assert.deepEqual(mapped.map(r => r.category), ["housing", "phone_internet", "subscriptions", "utilities", "other", "other", "other", "other"]);
        assert.ok(mapped.every(r => r.business_bp === 0));
        assert.deepEqual((await old.query<{ category: string; business_bp: number }>("select category, business_bp from charges")).rows, [{ category: "other", business_bp: 0 }]);
      } finally {
        await old.close();
      }
    });

    await check("a wrong key or a share outside 0 to 10000 is refused by the input schema, the data layer and the database", async () => {
      const hid = await seedBen(db, { isDemo: true });
      const card = (await db.select().from(schema.cards).where(eq(schema.cards.householdId, hid)))[0];
      assert.equal(billInput.safeParse({ id: randomUUID(), biller: "X", amount: "1", due: "2026-11-20", category: "pets" }).success, false);
      assert.equal(billInput.safeParse({ id: randomUUID(), biller: "X", amount: "1", due: "2026-11-20", category: "other", businessBp: 10_001 }).success, false);
      assert.equal(billInput.safeParse({ id: randomUUID(), biller: "X", amount: "1", due: "2026-11-20" }).success, false, "a bill needs a category");
      assert.equal(billInput.parse({ id: randomUUID(), biller: "X", amount: "1", due: "2026-11-20", category: "other" }).businessBp, 0, "the share defaults to personal");
      assert.equal(chargeInput.safeParse({ id: randomUUID(), cardId: card.id, merchant: "X", amount: "1", date: "2026-11-14", category: "pets" }).success, false);
      await assert.rejects(insertBill(db, hid, { id: randomUUID(), biller: "X", amount: "1", due: "2026-11-20", category: "pets", businessBp: 0, memberId: null, paidByMemberId: null, repeat: null } as never, "confirmed", { madeBy: "form" }));
      await assert.rejects(insertCharge(db, hid, { id: randomUUID(), cardId: card.id, merchant: "X", amount: "1", date: "2026-11-14", category: "other", businessBp: -1, shared: false } as never, "confirmed", "manual", { madeBy: "form" }));
      const row = { householdId: hid, biller: "Raw", amountMinor: 1, currency: "JPY", due: "2026-11-20" };
      await assert.rejects(db.insert(schema.bills).values({ ...row, category: "pets" }), "bills_category_valid");
      await assert.rejects(db.insert(schema.bills).values({ ...row, category: "Housing" }), "keys only, not labels");
      await assert.rejects(db.insert(schema.bills).values({ ...row, category: "other", businessBp: 10_001 }), "bills_business_valid");
      const charge = { householdId: hid, cardId: card.id, merchant: "Raw", amountMinor: 1, currency: "JPY", date: "2026-11-14", source: "manual" as const };
      await assert.rejects(db.insert(schema.charges).values({ ...charge, category: "pets" }), "charges_category_valid");
      await assert.rejects(db.insert(schema.charges).values({ ...charge, businessBp: -1 }), "charges_business_valid");
      assert.equal((await db.insert(schema.charges).values(charge).returning())[0].category, "other", "a charge without a category is Other");
    });

    await check("typed-in bills and charges keep their category and share, are idempotent on them, and a different one under the same id is refused", async () => {
      const hid = await seedBen(db, { isDemo: true });
      const card = (await db.select().from(schema.cards).where(eq(schema.cards.householdId, hid)))[0];
      const rent = billInput.parse({ id: randomUUID(), biller: "Fictional studio", amount: "50000", due: "2026-11-25", category: "housing", businessBp: 4000, repeat: "month" });
      await insertBill(db, hid, rent, "confirmed", { madeBy: "form" });
      await insertBill(db, hid, rent, "confirmed", { madeBy: "form" });
      await assert.rejects(insertBill(db, hid, { ...rent, businessBp: 5000 }, "confirmed", { madeBy: "form" }), /already in use/);
      await assert.rejects(insertBill(db, hid, { ...rent, category: "other" }, "confirmed", { madeBy: "form" }), /already in use/);
      const lunch = chargeInput.parse({ id: randomUUID(), cardId: card.id, merchant: "Fictional bento", amount: "900", date: "2026-11-14", category: "food", businessBp: 10_000 });
      await insertCharge(db, hid, lunch, "confirmed", "manual", { madeBy: "form" });
      await insertCharge(db, hid, lunch, "confirmed", "manual", { madeBy: "form" });
      await assert.rejects(insertCharge(db, hid, { ...lunch, category: "other" }, "confirmed", "manual", { madeBy: "form" }), /already in use/);
      const state = await stateOf(hid);
      const view = monthByCategory(state, state.today);
      assert.deepEqual(view.categories.find(c => c.category === "housing")!.items.map(i => [i.label, i.amountMinor, i.businessBp]).sort(), [["Fictional studio", 50_000, 4000], ["Rent", 82_000, 3000]]);
      assert.deepEqual(view.categories.find(c => c.category === "food")!.items.find(i => i.label === "Fictional bento"), { label: "Fictional bento", date: "2026-11-14", amountMinor: 900, businessBp: 10_000, own: null, ownerId: state.cards.find(c => c.id === lunch.cardId)?.ownerId ?? null });
      assert.equal(view.categories.find(c => c.category === "food")!.items.filter(i => i.label === "Fictional bento").length, 1);
    });

    await check("Kumo Water has a sure Utilities guess and the bill save preserves an explicit Other", async () => {
      const hid = await seedBen(db, { isDemo: true });
      for (const name of ["Kumo Water", "kumo WATER", "Kumo　Water"]) {
        assert.deepEqual(guessCategory(name), { category: "utilities", sure: true });
      }
      const form = { biller: "Kumo Water", amount: "2500", due: "2026-11-17" };
      const guessed = randomUUID(), overridden = randomUUID();
      await insertBill(db, hid, billInput.parse({ ...form, id: guessed, category: guessCategory(form.biller).category }), "confirmed", { madeBy: "form" });
      await insertBill(db, hid, billInput.parse({ ...form, id: overridden, category: "other" }), "confirmed", { madeBy: "form" });
      const water = (await db.select({ id: schema.bills.id, category: schema.bills.category }).from(schema.bills)
        .where(and(eq(schema.bills.householdId, hid), eq(schema.bills.biller, form.biller))));
      assert.deepEqual(new Map(water.map(row => [row.id, row.category])), new Map([[guessed, "utilities"], [overridden, "other"]]));
    });

    // ------------------------------------------------------------ the agent and MCP tools
    await check("tools: add_bill and log_charge take category and business_bp, guess from the name when none is given and say so, and keep both through To check", async () => {
      const hid = await seedBen(db, { isDemo: true });
      const ctx: ToolContext = { madeBy: "ask", db, householdId: hid, state: () => stateOf(hid), appUrl: new URL("http://127.0.0.1:3123") };
      const tool = (name: string) => tools.find(t => t.name === name)!;
      const run = (name: string, input: unknown) => tool(name).run(ctx, tool(name).input.parse(input) as never);
      const card = (await db.select().from(schema.cards).where(eq(schema.cards.householdId, hid)))[0];
      for (const name of ["add_bill", "log_charge"]) {
        const schemaOf = toolInputSchema(tool(name)) as unknown as { required: string[]; properties: Record<string, { anyOf: { enum?: string[]; type: string }[]; description?: string }> };
        assert.ok(schemaOf.required.includes("category") && schemaOf.required.includes("business_bp"), `${name} lists both`);
        assert.ok(CATEGORY_KEYS.every(key => JSON.stringify(schemaOf.properties.category).includes(key)), `${name}'s schema lists all fourteen keys`);
        assert.equal(tool(name).scope, "draft");
      }
      assert.throws(() => tool("add_bill").input.parse({ id: randomUUID(), biller: "X", amount: "1", due: "2026-11-20", category: "pets", memberId: null, repeat: null, shared: null, paidBy: null }));
      assert.throws(() => tool("log_charge").input.parse({ id: randomUUID(), cardId: card.id, merchant: "X", amount: "1", date: "2026-11-14", category: "other", business_bp: 10_001 }));

      const given = randomUUID(), guessed = randomUUID(), unsure = randomUUID();
      const bill = (id: string, biller: string, extra: object) => ({ id, biller, amount: "3000", due: "2026-11-25", memberId: null, repeat: null, shared: null, paidBy: null, category: null, business_bp: null, ...extra });
      assert.equal(await run("add_bill", bill(given, "Fictional gym", { category: "health", business_bp: 2500 })), "Fictional gym is waiting in To check for the user to confirm. Category: Health.");
      assert.equal(await run("add_bill", bill(guessed, "Fictional electric co", {})), "Fictional electric co is waiting in To check for the user to confirm. No category was given, so it was guessed from the name: Utilities. The user can change it in To check.");
      assert.match(await run("add_bill", bill(unsure, "Zebra Supplies", {})), /No category was given and the name matched none, so it is Other\. The user can choose one in To check\.$/);
      const rows = Object.fromEntries((await db.select().from(schema.bills).where(eq(schema.bills.householdId, hid))).map(r => [r.id, r]));
      assert.deepEqual([given, guessed, unsure].map(id => [rows[id].status, rows[id].category, rows[id].businessBp]), [["pending", "health", 2500], ["pending", "utilities", 0], ["pending", "other", 0]]);

      const chargeId = randomUUID(), guessedCharge = randomUUID();
      const log = (id: string, merchant: string, extra: object) => ({ id, cardId: card.id, merchant, amount: "1200", date: "2026-11-14", category: null, business_bp: null, ...extra });
      assert.match(await run("log_charge", log(chargeId, "Fictional ramen shop", { business_bp: 10_000 })), /^Fictional ramen shop is waiting in To check for the user to confirm\. No category was given, so it was guessed from the name: Food\./);
      assert.match(await run("log_charge", log(guessedCharge, "Zebra Supplies", { category: "business_tools" })), /Category: Business tools\.$/);
      const charges = Object.fromEntries((await db.select().from(schema.charges).where(eq(schema.charges.householdId, hid))).map(r => [r.id, r]));
      assert.deepEqual([charges[chargeId], charges[guessedCharge]].map(r => [r.status, r.category, r.businessBp]), [["pending", "food", 10_000], ["pending", "business_tools", 0]]);

      let state = await stateOf(hid);
      const pendingRows = toCheck(state);
      assert.equal(pendingRows.find(r => r.id === given)!.detail, "Health · 25% business · due Nov 25");
      assert.equal(pendingRows.find(r => r.id === chargeId)!.detail, `${card.label} · Nov 14 · Food · Business · Manual entry`);
      const before = monthByCategory(state, state.today);
      assert.ok(!before.categories.some(c => c.category === "health"), "pending rows are not in the month");
      assert.equal(await confirmPending(db, hid, "bill", given), true);
      assert.equal(await confirmPending(db, hid, "charge", chargeId), true);
      state = await stateOf(hid);
      const after = monthByCategory(state, state.today);
      assert.deepEqual(after.categories.find(c => c.category === "health")!.items, [{ label: "Fictional gym", date: "2026-11-25", amountMinor: 3000, businessBp: 2500, own: null, ownerId: null }]);
      assert.equal(after.categories.find(c => c.category === "food")!.items.find(i => i.label === "Fictional ramen shop")!.businessBp, 10_000);

      const text = await run("month_by_category", {});
      assert.equal(text, monthText(after));
      assert.match(text, /Health ¥3,000 \(business ¥750 · personal ¥2,250\): Fictional gym Nov 25 ¥3,000 at 25% business\./);
      assert.equal(tool("month_by_category").scope, "read");
    });

    // ------------------------------------------------------------ the snapshot and household scope
    await check("the snapshot carries category on charges and bills and businessBp on both, and refuses a bad key", async () => {
      const snap = await loadHouseholdSnapshot(db, b, { events: false });
      assert.deepEqual(snap.bills.map(x => [x.biller, x.category, x.businessBp]).sort(), [["CloudBox Plus", "subscriptions", 10_000], ["Hikari Denki", "utilities", 3000], ["Hikari Denki", "utilities", 3000], ["Hikari Denki", "utilities", 3000], ["Mobaile Tsushin", "phone_internet", 5000], ["Rent", "housing", 3000]]);
      assert.deepEqual(snap.charges.find(x => x.merchant === "Sora Cloud Hosting"), { ...snap.charges.find(x => x.merchant === "Sora Cloud Hosting")!, category: "business_tools", businessBp: 10_000 });
      assert.equal(snap.charges.find(x => x.merchant === "Tsuki Electronics")!.category, "other");
      assert.throws(() => HouseholdSnapshot.parse({ ...snap, bills: [{ ...snap.bills[0], category: "pets" }] }));
      assert.throws(() => HouseholdSnapshot.parse({ ...snap, charges: [{ ...snap.charges[0], businessBp: 10_001 }] }));
      assert.throws(() => HouseholdSnapshot.parse({ ...snap, charges: [{ ...snap.charges[0], category: undefined }] }));
    });

    await check("Settings edit (Nov 5 walk): a one-off bill's amount and category, one bill_changed event, the same values record nothing, another household's bill and a pending one are refused", async () => {
      const one = await seedBen(db, { isDemo: true }), two = await seedBen(db, { isDemo: true });
      const id = randomUUID();
      await insertBill(db, one, billInput.parse({ id, biller: "Noodle shop", amount: "1200", due: "2026-11-20", category: "other" }), "confirmed", { madeBy: "form" });
      const edit = (over: Partial<Parameters<typeof billEditInput.parse>[0]> = {}) => billEditInput.parse({ id, biller: "Noodle shop", amount: "980", due: "2026-11-20", category: "food", ...over });
      const changed = () => db.select().from(schema.events).where(and(eq(schema.events.householdId, one), eq(schema.events.kind, "bill_changed")));
      assert.equal(await updateBill(db, two, edit(), { madeBy: "form" }), false, "another household's bill is not found");
      assert.equal(await updateBill(db, one, edit(), { madeBy: "form" }), true);
      const [row] = await db.select().from(schema.bills).where(eq(schema.bills.id, id));
      assert.deepEqual([row.amountMinor, row.category, row.biller], [980, "food", "Noodle shop"]);
      assert.deepEqual((await changed()).map(e => [e.title, e.body, e.madeBy]), [["Noodle shop bill changed", "Amount ¥1,200 → ¥980 · Category Other → Food", "form"]]);
      assert.equal(await updateBill(db, one, edit(), { madeBy: "form" }), true);
      assert.equal((await changed()).length, 1, "saving the same values records nothing");
      await assert.rejects(updateBill(db, one, edit({ amount: "abc" }), { madeBy: "form" }), InputError);
      await assert.rejects(updateBill(db, one, edit({ due: "2099-01-01" }), { madeBy: "form" }), InputError, "the two-year limit");
      const pending = randomUUID();
      await insertBill(db, one, billInput.parse({ id: pending, biller: "Fictional pending", amount: "100", due: "2026-11-20", category: "other" }), "pending", { madeBy: "ask" });
      await assert.rejects(updateBill(db, one, billEditInput.parse({ id: pending, biller: "X", amount: "1", due: "2026-11-20", category: "food" }), { madeBy: "form" }), /To check/);
      assert.equal((await db.select().from(schema.events).where(and(eq(schema.events.householdId, two), eq(schema.events.kind, "bill_changed")))).length, 0);
    });

    await check("Settings edit (D48): a repeating bill's amount changes from an occurrence on; the first due date corrects every one; a second scheduled change is refused", async () => {
      const one = await seedBen(db, { isDemo: true });
      const id = randomUUID();
      await insertBill(db, one, billInput.parse({ id, biller: "Fictional gym", amount: "8000", due: "2026-11-20", category: "health", repeat: "month" }), "confirmed", { madeBy: "form" });
      const edit = (over: Partial<Parameters<typeof billEditInput.parse>[0]>) => billEditInput.parse({ id, biller: "Fictional gym", amount: "8000", due: "2026-11-20", category: "health", ...over });
      const amounts = async () => (await stateOf(one)).bills.filter(b => b.biller.startsWith("Fictional gym")).map(b => [b.due, b.amount]);
      await updateBill(db, one, edit({ amount: "9000" }), { madeBy: "form" }); // empty from = the next due date, here the first one: every occurrence
      const [row] = await db.select().from(schema.bills).where(eq(schema.bills.id, id));
      assert.deepEqual([row.amountMinor, row.nextAmountMinor, row.nextAmountFrom], [9000, null, null]);
      await updateBill(db, one, edit({ amount: "9500", amountFrom: "2026-12-20" }), { madeBy: "form" });
      assert.deepEqual((await amounts()).slice(0, 2), [["2026-11-20", 9000], ["2026-12-20", 9500]]);
      await assert.rejects(updateBill(db, one, edit({ amount: "10000", amountFrom: "2027-01-20" }), { madeBy: "form" }), /already changes to ¥9,500 from Dec 20/);
      await updateBill(db, one, edit({ biller: "Fictional gym plus", amount: "9500", amountFrom: "2026-12-20" }), { madeBy: "form" });
      const bodies = (await db.select().from(schema.events).where(and(eq(schema.events.householdId, one), eq(schema.events.kind, "bill_changed"))).orderBy(schema.events.occurredAt, schema.events.id)).map(e => e.body);
      assert.deepEqual(bodies, ["Amount ¥8,000 → ¥9,000 from the first due date", "Amount ¥9,000 → ¥9,500 from Dec 20", "Name Fictional gym → Fictional gym plus"]);
      const [renamed] = await db.select().from(schema.bills).where(eq(schema.bills.id, id));
      assert.deepEqual([renamed.biller, renamed.amountMinor, renamed.nextAmountMinor, renamed.nextAmountFrom, renamed.repeatDay], ["Fictional gym plus", 9000, 9500, "2026-12-20", 20], "a rename changes the series and keeps its amounts");
    });

    await check("Settings edit (D48): the last day to cancel is set, changed and removed from Edit, each said once in Activity; absent leaves it alone; a date on or after the next charge is refused", async () => {
      const one = await seedBen(db, { isDemo: true });
      const id = randomUUID();
      await insertBill(db, one, billInput.parse({ id, biller: "Fictional Cloud", amount: "12000", due: "2026-12-01", category: "subscriptions", repeat: "year" }), "confirmed", { madeBy: "form" });
      const edit = (over: Partial<Parameters<typeof billEditInput.parse>[0]> = {}) => billEditInput.parse({ id, biller: "Fictional Cloud", amount: "12000", due: "2026-12-01", category: "subscriptions", ...over });
      const bodies = async () => (await db.select().from(schema.events).where(and(eq(schema.events.householdId, one), eq(schema.events.kind, "bill_changed"))).orderBy(schema.events.occurredAt, schema.events.id)).map(e => e.body);
      const cancelBy = async () => (await db.select().from(schema.bills).where(eq(schema.bills.id, id)))[0].cancelBy;
      await updateBill(db, one, edit({ cancelBy: "2026-11-20" }), { madeBy: "form" });
      assert.equal(await cancelBy(), "2026-11-20");
      assert.equal((await stateOf(one)).cancelNotices.find(n => n.billId === id)?.cancelBy, "2026-11-20");
      await updateBill(db, one, edit(), { madeBy: "form" });
      assert.equal(await cancelBy(), "2026-11-20", "absent = unchanged");
      await updateBill(db, one, edit({ cancelBy: "2026-11-20" }), { madeBy: "form" });
      await updateBill(db, one, edit({ cancelBy: "2026-11-25" }), { madeBy: "form" });
      await assert.rejects(updateBill(db, one, edit({ cancelBy: "2026-12-01" }), { madeBy: "form" }), /before the bill is next charged/);
      assert.equal(await cancelBy(), "2026-11-25");
      await updateBill(db, one, edit({ cancelBy: null }), { madeBy: "form" });
      assert.equal(await cancelBy(), null);
      assert.deepEqual(await bodies(), ["Last day to cancel Nov 20", "Last day to cancel Nov 20 → Nov 25", "No last day to cancel"]);
    });

    await check("engine rounding and statements: USD cents never drift below zero; a later stored statement keeps an earlier unpaid computed one; a paid stored statement is not counted twice", () => {
      const bill = (id: string, amount: number, due: string): Bill => ({ id, biller: id, amount, due, category: "other", businessBp: 0, status: "confirmed" });
      const usd: MoneyState = { ...benMoney, homeCurrency: "USD", fxPerUsd: 1, today: "2026-11-10", bank: 0.3, paypal: 0, bills: [bill("a", 0.1, "2026-11-12"), bill("b", 0.2, "2026-11-13")], charges: [], statements: [], pots: [], invoices: [], cancelNotices: [], storedBills: [] };
      const expected = series(usd, "expected");
      assert.equal(expected[3], 0, "bank $0.30 less $0.10 and $0.20 is exactly zero");
      assert.equal(low(expected).amount, 0);
      assert.equal(safeToSpend(usd, 0).verdict === "hold", false);
      assert.ok(!homeSentence(usd).short, "not short by float noise");

      const charge = (date: string, amount: number): Charge => ({ id: randomUUID(), cardId: "card-a", merchant: "M", amount, date, category: "other", businessBp: 0, source: "manual", status: "confirmed" });
      const card = { id: "card-a", label: "Card A", closingDay: 5, dueDay: 27, limit: 500_000, revolving: false, ownerId: "m-ben" };
      const base: MoneyState = { ...benMoney, today: "2026-11-10", cards: [card], bills: [], storedBills: [], charges: [charge("2026-09-20", 30_000)], statements: [] };
      const nov = { cardId: "card-a", amount: 5_000, closedOn: "2026-11-05", dueOn: "2026-12-27" };
      const items = (statements: MoneyState["statements"], charges = base.charges) => statementItems({ ...base, charges, statements }).map(i => [i.amount, i.closesOn, i.dueOn]);
      assert.deepEqual(items([nov]), [[30_000, "2026-10-05", "2026-11-27"], [5_000, "2026-11-05", "2026-12-27"]], "the Oct 5 cycle has no stored statement, so it stays");
      assert.deepEqual(items([{ ...nov, closedOn: "2026-10-05", dueOn: "2026-11-27", amount: 30_000 }]), [[30_000, "2026-10-05", "2026-11-27"]], "a stored statement for that exact close covers its charges once");
      assert.deepEqual(items([{ ...nov, closedOn: "2026-10-05", dueOn: "2026-11-27", amount: 30_000, paid: true }]), [], "a paid stored statement covers its charges and is not an out-flow");
    });

    await check("household scope: one household's items, categories and shares never appear in another's month", async () => {
      const one = await seedBen(db, { isDemo: true }), two = await seedBen(db, { isDemo: true });
      const card = (await db.select().from(schema.cards).where(eq(schema.cards.householdId, one)))[0];
      await insertCharge(db, one, chargeInput.parse({ id: randomUUID(), cardId: card.id, merchant: "ZZ Only In One", amount: "777", date: "2026-11-14", category: "debt", businessBp: 10_000 }), "confirmed", "manual", { madeBy: "form" });
      const stateOne = await stateOf(one), stateTwo = await stateOf(two);
      assert.ok(monthByCategory(stateOne, stateOne.today).categories.some(c => c.category === "debt" && c.items[0].label === "ZZ Only In One"));
      assert.deepEqual(summary(stateTwo), summary(benMoney), "the other household still has exactly Ben's month");
      assert.ok(!JSON.stringify(await loadHouseholdSnapshot(db, two, { events: false })).includes("ZZ Only In One"));
    });

    console.log(`Category checks passed (${passed}).`);
  } finally {
    await pg.close();
  }
}

main().catch(error => {
  console.error("Category tests failed", error);
  process.exit(1);
});
