// Own categories (D75): the name rules and the cap, every function in src/db/own-categories.ts, the database walls (another kind, remove clears only the link), the writes that file an item, the loaders and the month view. PGlite, no credentials.
// Run from the project root: npx tsx --tsconfig ./tsconfig.json scripts/own-categories-test.ts
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "@/db/schema";
import { billEditInput, billInput, insertBill, updateBill } from "@/db/bills";
import { chargeInput, insertCharge } from "@/db/charges";
import { DEMO_DATE } from "@/db/clock";
import { loadMoneyState, withHousehold } from "@/db/household";
import { importCharges } from "@/db/import-charges";
import { InputError } from "@/db/input-error";
import {
  OWN_CAP_WORDS, addOwnCategory, findOwnCategory, fileOwnCategory, groupOwnCategories, guessOwnCategory, listOwnCategories, listOwnCategoriesGrouped,
  mergeOwnCategories, ownCategoryRefs, ownChoices, removeOwnCategory, resolveOwnCategory, saveOwnCategory,
} from "@/db/own-categories";
import { seedBen } from "@/db/seed";
import { loadSettings } from "@/db/settings";
import { loadSpending } from "@/db/spending";
import { monthByCategory, monthText } from "@/lib/money/month";
import { nameKey } from "@/lib/money/name-key";
import { ownLabel } from "@/lib/money/own-category";
import { searchLine, searchSpending, spendingItems } from "@/lib/money/spending";
import { toCheck } from "@/lib/money/to-check";

const form = { madeBy: "form" } as const;
const refused = (words: RegExp | string) => (e: unknown) => e instanceof InputError && (typeof words === "string" ? e.message === words : words.test(e.message));

async function main() {
  const pg = new PGlite({ extensions: { pg_trgm } });
  const db = drizzle(pg, { schema });
  let passed = 0;
  async function check(name: string, run: () => void | Promise<void>) { await run(); passed++; console.log(`✓ ${name}`); }
  try {
    await migrate(db, { migrationsFolder: "./drizzle" });
    const a = await seedBen(db, { isDemo: true });
    const names = async (hid: string) => (await listOwnCategories(db, hid)).map(o => `${o.kind}/${o.name}/${o.items}`);
    const idOf = async (hid: string, name: string) => (await listOwnCategories(db, hid)).find(o => o.name === name)!.id;
    const card = async (hid: string) => (await db.select().from(schema.cards).where(eq(schema.cards.householdId, hid)).orderBy(schema.cards.createdAt))[0].id;
    const chargeRow = async (hid: string, id: string) => (await db.select().from(schema.charges).where(and(eq(schema.charges.householdId, hid), eq(schema.charges.id, id))))[0];
    const charge = (hid: string, over: Record<string, unknown>) => card(hid).then(cardId => chargeInput.parse({ id: randomUUID(), cardId, merchant: "Fictional Shop", amount: "500", date: "2026-11-13", category: "food", ...over }));

    await check("Ben's sample has Coffee under Food (3 items), Gear (2) and Books & films (2) under Other, listed in the order of the fourteen, flat and grouped", async () => {
      assert.deepEqual(await names(a), ["food/Coffee/3", "other/Books & films/2", "other/Gear/2"]);
      const grouped = await listOwnCategoriesGrouped(db, a);
      assert.deepEqual(grouped.map(g => [g.kind, g.label, g.categories.map(c => c.name)]), [["food", "Food", ["Coffee"]], ["other", "Other", ["Books & films", "Gear"]]]);
      assert.deepEqual(groupOwnCategories([]), []);
      assert.equal((await ownCategoryRefs(db, a)).size, 3);
    });

    await check("add: trims, keeps an optional default share, refuses the name rules in the spec's words", async () => {
      const tea = await addOwnCategory(db, a, { kind: "food", name: "  Tea  ", businessBp: 2500 });
      assert.deepEqual([tea.kind, tea.name, tea.businessBp, tea.items], ["food", "Tea", 2500, 0]);
      await assert.rejects(addOwnCategory(db, a, { kind: "food", name: "   " }), refused("Give your category a name of 1 to 40 characters."));
      await assert.rejects(addOwnCategory(db, a, { kind: "food", name: "x".repeat(41) }), refused("Give your category a name of 1 to 40 characters."));
      assert.equal((await addOwnCategory(db, a, { kind: "food", name: "y".repeat(40) })).name.length, 40);
      await assert.rejects(addOwnCategory(db, a, { kind: "food", name: "sk-" + "a".repeat(30) }), refused(/looks like an API key/));
      await assert.rejects(addOwnCategory(db, a, { kind: "travel", name: "Food" }), refused("Food is already a category."));
      await assert.rejects(addOwnCategory(db, a, { kind: "travel", name: " phone & INTERNET " }), refused("Phone & internet is already a category."));
      await assert.rejects(addOwnCategory(db, a, { kind: "food", name: "coffee" }), refused("You already have Coffee under Food."));
      await assert.rejects(addOwnCategory(db, a, { kind: "food", name: "ＣＯＦＦＥＥ" }), refused("You already have Coffee under Food."));
      assert.equal((await addOwnCategory(db, a, { kind: "travel", name: "Coffee" })).kind, "travel", "the same name under another category is allowed");
      await assert.rejects(addOwnCategory(db, a, { kind: "food", name: "Bad", businessBp: 10_001 }), Error);
      await assert.rejects(addOwnCategory(db, "", { kind: "food", name: "Nope" }), /household id is required/);
    });

    await check("the 41st is refused with the cap words, and a new name from a write meets the same cap", async () => {
      const c = await seedBen(db, { isDemo: true });
      for (let i = 0; i < 37; i++) await addOwnCategory(db, c, { kind: "other", name: `Fictional ${i}` });
      assert.equal((await listOwnCategories(db, c)).length, 40);
      await assert.rejects(addOwnCategory(db, c, { kind: "other", name: "One too many" }), refused("You can keep up to 40 of your own categories. Remove one first."));
      assert.equal(OWN_CAP_WORDS, "You can keep up to 40 of your own categories. Remove one first.");
      await assert.rejects(insertCharge(db, c, await charge(c, { ownCategoryNew: "Brand new" }), "confirmed", "manual", form), refused(OWN_CAP_WORDS));
      assert.equal((await listOwnCategories(db, c)).length, 40);
    });

    await check("save: rename, change and clear the default share; the rules apply to a rename", async () => {
      const tea = (await listOwnCategories(db, a)).find(o => o.name === "Tea")!;
      assert.equal((await saveOwnCategory(db, a, { id: tea.id, name: "Green tea" }))!.name, "Green tea");
      assert.equal((await saveOwnCategory(db, a, { id: tea.id }))!.businessBp, 2500, "nothing sent = unchanged");
      assert.equal((await saveOwnCategory(db, a, { id: tea.id, businessBp: 0 }))!.businessBp, 0);
      assert.equal((await saveOwnCategory(db, a, { id: tea.id, businessBp: null }))!.businessBp, null);
      assert.equal((await saveOwnCategory(db, a, { id: tea.id, name: "GREEN TEA" }))!.name, "GREEN TEA", "a rename may change only the case");
      await assert.rejects(saveOwnCategory(db, a, { id: tea.id, name: "Coffee" }), refused("You already have Coffee under Food."));
      await assert.rejects(saveOwnCategory(db, a, { id: tea.id, name: "Other" }), refused("Other is already a category."));
    });

    await check("the database refuses an own category of another kind, and a default share never rewrites saved items", async () => {
      const coffeeA = await idOf(a, "Coffee");
      const [food] = await db.select().from(schema.charges).where(and(eq(schema.charges.householdId, a), eq(schema.charges.category, "food"))).limit(1);
      const [travel] = await db.select().from(schema.charges).where(and(eq(schema.charges.householdId, a), eq(schema.charges.category, "travel"))).limit(1);
      await assert.rejects(db.update(schema.charges).set({ ownCategoryId: coffeeA }).where(eq(schema.charges.id, travel.id)), Error);
      const [bill] = await db.select().from(schema.bills).where(eq(schema.bills.householdId, a)).limit(1);
      await assert.rejects(db.update(schema.bills).set({ ownCategoryId: coffeeA }).where(eq(schema.bills.id, bill.id)), Error, "Coffee is Food's, the bill is not Food");
      const before = (await chargeRow(a, food.id)).businessBp;
      await saveOwnCategory(db, a, { id: coffeeA, businessBp: 10_000 });
      assert.equal((await chargeRow(a, food.id)).businessBp, before);
      await saveOwnCategory(db, a, { id: coffeeA, businessBp: null });
      await assert.rejects(db.update(schema.ownCategories).set({ kind: "travel" }).where(eq(schema.ownCategories.id, coffeeA)), Error, "a kind never moves while items are filed under it");
    });

    await check("a write files an item: an id of its kind, a new name made in the same save, the same name found again, and refusals in words", async () => {
      const coffeeA = await idOf(a, "Coffee");
      const filed = await charge(a, { merchant: "Fictional Roaster", ownCategoryId: coffeeA });
      await insertCharge(db, a, filed, "confirmed", "manual", form);
      assert.equal((await chargeRow(a, filed.id)).ownCategoryId, coffeeA);
      await insertCharge(db, a, filed, "confirmed", "manual", form); // the same write again changes nothing
      const made = await charge(a, { merchant: "Fictional Deli", ownCategoryNew: "Lunch" });
      await insertCharge(db, a, made, "confirmed", "manual", form);
      const lunch = (await listOwnCategories(db, a)).find(o => o.name === "Lunch")!;
      assert.deepEqual([lunch.kind, lunch.items], ["food", 1]);
      const again = await charge(a, { merchant: "Fictional Deli 2", ownCategoryNew: " lunch " });
      await insertCharge(db, a, again, "confirmed", "manual", form);
      assert.deepEqual([(await listOwnCategories(db, a)).filter(o => o.name.toLowerCase() === "lunch").length, (await chargeRow(a, again.id)).ownCategoryId === lunch.id], [1, true]);
      await assert.rejects(insertCharge(db, a, await charge(a, { ownCategoryNew: "Food" }), "confirmed", "manual", form), refused("Food is already a category."));
      await assert.rejects(insertCharge(db, a, await charge(a, { ownCategoryId: await idOf(a, "Gear") }), "confirmed", "manual", form), refused("Gear is a category under Other, not Food."));
      await assert.rejects(insertCharge(db, a, await charge(a, { ownCategoryId: coffeeA, ownCategoryNew: "Both" }), "confirmed", "manual", form), refused("Choose one of your categories or make a new one, not both."));
      assert.equal((await chargeRow(a, (await charge(a, {})).id)), undefined);
      const bare = await charge(a, { merchant: "Fictional Plain" });
      await insertCharge(db, a, bare, "confirmed", "manual", form);
      assert.equal((await chargeRow(a, bare.id)).ownCategoryId, null, "nothing sent = none");
      const bill = billInput.parse({ id: randomUUID(), biller: "Fictional Café Club", amount: "900", due: "2026-12-05", category: "food", ownCategoryId: coffeeA });
      await insertBill(db, a, bill, "confirmed", form);
      assert.equal((await db.select().from(schema.bills).where(eq(schema.bills.id, bill.id)))[0].ownCategoryId, coffeeA);
      await insertBill(db, a, billInput.parse({ ...bill, id: randomUUID(), ownCategoryNew: "Subscriptions I like", category: "subscriptions", ownCategoryId: undefined }), "pending", form);
      assert.ok((await listOwnCategories(db, a)).some(o => o.kind === "subscriptions" && o.name === "Subscriptions I like"));
    });

    await check("editing a bill: changing its category clears the own category unless one of the new kind is sent; the same category keeps it; null clears it", async () => {
      const coffeeA = await idOf(a, "Coffee");
      const id = randomUUID();
      await insertBill(db, a, billInput.parse({ id, biller: "Fictional Beans Box", amount: "1500", due: "2026-12-07", category: "food", ownCategoryId: coffeeA }), "confirmed", form);
      const edit = (over: Record<string, unknown>) => billEditInput.parse({ id, biller: "Fictional Beans Box", amount: "1500", due: "2026-12-07", category: "food", businessBp: 0, ...over });
      const own = async () => (await db.select().from(schema.bills).where(eq(schema.bills.id, id)))[0].ownCategoryId;
      assert.equal(await updateBill(db, a, edit({ amount: "1600" }), form), true);
      assert.equal(await own(), coffeeA, "the same category keeps it");
      assert.equal(await updateBill(db, a, edit({ category: "subscriptions" }), form), true);
      assert.equal(await own(), null, "a new category clears it");
      const events = await db.select().from(schema.events).where(and(eq(schema.events.householdId, a), eq(schema.events.kind, "bill_changed")));
      assert.ok(events.some(e => /Category Food → Subscriptions · Your category Coffee → none/.test(e.body ?? "")));
      assert.equal(await updateBill(db, a, edit({ category: "food", ownCategoryId: coffeeA }), form), true);
      assert.equal(await own(), coffeeA);
      assert.equal(await updateBill(db, a, edit({ category: "subscriptions", ownCategoryNew: "Streaming" }), form), true);
      assert.equal((await listOwnCategories(db, a)).find(o => o.name === "Streaming")!.kind, "subscriptions");
      assert.equal(await updateBill(db, a, edit({ category: "subscriptions", ownCategoryId: null }), form), true);
      assert.equal(await own(), null);
      await assert.rejects(updateBill(db, a, edit({ category: "subscriptions", ownCategoryId: coffeeA }), form), refused(/Coffee is a category under Food, not Subscriptions/));
    });

    await check("the statement import files rows under an id or a new name", async () => {
      const c = await seedBen(db, { isDemo: true });
      const cardId = await card(c);
      const coffee = await idOf(c, "Coffee");
      const result = await importCharges(db, c, cardId, [
        { date: "2026-11-01", merchant: "Fictional Imported Roaster", amountMinor: 700, category: "food", ownCategoryId: coffee },
        { date: "2026-11-02", merchant: "Fictional Imported Deli", amountMinor: 800, category: "food", ownCategoryNew: "Imported lunch" },
        { date: "2026-11-03", merchant: "Fictional Imported Deli", amountMinor: 900, category: "food", ownCategoryNew: "imported lunch" },
        { date: "2026-11-04", merchant: "Fictional Imported Plain", amountMinor: 100, category: "food" },
      ], form);
      assert.equal(result.added, 4);
      assert.deepEqual((await names(c)).filter(n => /Imported|Coffee/.test(n)), ["food/Coffee/4", "food/Imported lunch/2"]);
      await assert.rejects(importCharges(db, c, cardId, [{ date: "2026-11-05", merchant: "Fictional X", amountMinor: 1, category: "travel", ownCategoryId: coffee }], form), refused(/Coffee is a category under Food, not Travel/));
    });

    await check("file: one item, then every bill and charge with the same normalised name and category; none clears; another kind or household is refused", async () => {
      const c = await seedBen(db, { isDemo: true });
      const coffee = await idOf(c, "Coffee");
      const stray = await charge(c, { merchant: "Kissa Midori café 11月分", date: "2026-11-13" });
      await insertCharge(db, c, stray, "confirmed", "manual", form);
      const other = await charge(c, { merchant: "Kissa Midori café", category: "travel" });
      await insertCharge(db, c, other, "confirmed", "manual", form);
      const bill = billInput.parse({ id: randomUUID(), biller: "kissa midori CAFÉ", amount: "100", due: "2026-12-01", category: "food" });
      await insertBill(db, c, bill, "confirmed", form);
      assert.deepEqual(await fileOwnCategory(db, c, { item: "charge", id: stray.id, ownCategoryId: coffee }), { filed: 1 });
      assert.equal((await chargeRow(c, stray.id)).ownCategoryId, coffee);
      assert.equal((await db.select().from(schema.bills).where(eq(schema.bills.id, bill.id)))[0].ownCategoryId, null);
      const lunch = (await addOwnCategory(db, c, { kind: "food", name: "Cafés" })).id;
      const every = await fileOwnCategory(db, c, { item: "charge", id: stray.id, ownCategoryId: lunch, everySame: true });
      assert.deepEqual(every, { filed: 5 }, "the 3 sample café charges, the stray one and the bill; the travel charge keeps its own category");
      assert.equal((await db.select().from(schema.bills).where(eq(schema.bills.id, bill.id)))[0].ownCategoryId, lunch);
      assert.equal((await chargeRow(c, other.id)).ownCategoryId, null);
      assert.deepEqual(await fileOwnCategory(db, c, { item: "bill", id: bill.id, ownCategoryId: null, everySame: true }), { filed: 5 });
      assert.deepEqual((await listOwnCategories(db, c)).find(o => o.id === lunch)!.items, 0);
      await assert.rejects(fileOwnCategory(db, c, { item: "charge", id: other.id, ownCategoryId: coffee }), refused(/Coffee is a category under Food, not Travel/));
      assert.equal(await fileOwnCategory(db, c, { item: "charge", id: randomUUID(), ownCategoryId: null }), null);
    });

    await check("the guess: the own category of the latest confirmed item with the same name key and category, or none", async () => {
      const c = await seedBen(db, { isDemo: true });
      const coffee = await idOf(c, "Coffee");
      assert.deepEqual(await guessOwnCategory(db, c, "food", "Kissa Midori café"), { id: coffee, name: "Coffee", businessBp: null });
      assert.equal((await guessOwnCategory(db, c, "food", "kissa midori CAFÉ 11月分"))!.id, coffee);
      assert.equal(await guessOwnCategory(db, c, "food", "Minato Fresh Market"), null);
      assert.equal(await guessOwnCategory(db, c, "travel", "Kissa Midori café"), null, "another category");
      const roaster = (await addOwnCategory(db, c, { kind: "food", name: "Roasters", businessBp: 5000 })).id;
      const later = await charge(c, { merchant: "Kissa Midori café", ownCategoryId: roaster });
      await insertCharge(db, c, later, "confirmed", "manual", form);
      assert.deepEqual(await guessOwnCategory(db, c, "food", "Kissa Midori café"), { id: roaster, name: "Roasters", businessBp: 5000 }, "the latest wins");
      const pending = await charge(c, { merchant: "Fictional Only Pending", ownCategoryId: coffee });
      await insertCharge(db, c, pending, "pending", "manual", form);
      assert.equal(await guessOwnCategory(db, c, "food", "Fictional Only Pending"), null, "a pending item is not a guide");
    });

    await check("ownChoices: the forms' own categories and the same guess for every name in one read; no pending item", async () => {
      const c = await seedBen(db, { isDemo: true });
      const coffee = await idOf(c, "Coffee");
      const choices = await ownChoices(db, c);
      assert.deepEqual(choices.categories.map(o => `${o.kind}|${o.name}`), ["food|Coffee", "other|Books & films", "other|Gear"], "ordered by the fourteen, then by name");
      assert.equal(choices.guesses[`food|${nameKey("Kissa Midori café")}`], coffee);
      assert.equal(choices.guesses[`food|${nameKey("Minato Fresh Market")}`], undefined);
      const roaster = (await addOwnCategory(db, c, { kind: "food", name: "Roasters", businessBp: 5000 })).id;
      await insertCharge(db, c, await charge(c, { merchant: "Kissa Midori café", ownCategoryId: roaster }), "confirmed", "manual", form);
      await insertCharge(db, c, await charge(c, { merchant: "Fictional Only Pending", ownCategoryId: coffee }), "pending", "manual", form);
      const later = await ownChoices(db, c);
      assert.equal(later.guesses[`food|${nameKey("Kissa Midori café")}`], roaster, "the latest wins, as guessOwnCategory does");
      assert.equal(later.guesses[`food|${nameKey("Fictional Only Pending")}`], undefined);
      assert.equal(later.categories.find(o => o.id === roaster)?.businessBp, 5000);
    });

    await check("find by name: the matching own category and the names of that category's own categories", async () => {
      assert.deepEqual((await findOwnCategory(db, a, "other", " gear ")).match?.name, "Gear");
      assert.deepEqual((await findOwnCategory(db, a, "other", "Hobbies")).names, ["Books & films", "Gear"]);
      assert.equal((await findOwnCategory(db, a, "other", "Hobbies")).match, null);
      assert.deepEqual(await findOwnCategory(db, a, "debt", "Gear"), { match: null, names: [] });
    });

    await check("merge: same category only; the items move and the source is removed", async () => {
      const c = await seedBen(db, { isDemo: true });
      const [coffee, gear, books] = await Promise.all([idOf(c, "Coffee"), idOf(c, "Gear"), idOf(c, "Books & films")]);
      await assert.rejects(mergeOwnCategories(db, c, { id: coffee, into: gear }), refused(/under Food; it can only merge into another category under Food/));
      await assert.rejects(mergeOwnCategories(db, c, { id: gear, into: gear }), refused("Choose a different category to merge into."));
      await assert.rejects(mergeOwnCategories(db, c, { id: gear, into: await idOf(a, "Gear") }), refused("Choose one of your categories."));
      assert.deepEqual(await mergeOwnCategories(db, c, { id: books, into: gear }), { moved: 2 });
      assert.deepEqual(await names(c), ["food/Coffee/3", "other/Gear/4"]);
      const [row] = await db.select().from(schema.charges).where(and(eq(schema.charges.householdId, c), eq(schema.charges.merchant, "Page & Lantern Books")));
      assert.deepEqual([row.ownCategoryId, row.category], [gear, "other"]);
    });

    await check("remove: the items go back to the category alone, with household and category unchanged; the count says how many", async () => {
      const c = await seedBen(db, { isDemo: true });
      const coffee = await idOf(c, "Coffee");
      const before = (await db.select().from(schema.charges).where(and(eq(schema.charges.householdId, c), eq(schema.charges.ownCategoryId, coffee)))).map(r => r.id).sort();
      assert.equal(before.length, 3);
      assert.deepEqual(await removeOwnCategory(db, c, { id: coffee }), { cleared: 3 });
      const after = await db.select().from(schema.charges).where(and(eq(schema.charges.householdId, c), eq(schema.charges.merchant, "Kissa Midori café")));
      assert.deepEqual(after.map(r => r.id).sort(), before);
      assert.ok(after.every(r => r.ownCategoryId === null && r.householdId === c && r.category === "food"));
      assert.deepEqual(await names(c), ["other/Books & films/2", "other/Gear/2"]);
      assert.equal(await removeOwnCategory(db, c, { id: coffee }), null);
    });

    await check("deleting a household takes its own categories with it", async () => {
      const c = await seedBen(db, { isDemo: true });
      const { deleteHousehold } = await import("@/db/household");
      await deleteHousehold(db, c);
      assert.equal((await db.select().from(schema.ownCategories).where(eq(schema.ownCategories.householdId, c))).length, 0);
    });

    await check("the loaders carry the own category: the money state, the spending rows and Settings", async () => {
      const c = await seedBen(db, { isDemo: true });
      const state = await loadMoneyState(db, c, DEMO_DATE);
      assert.deepEqual(state.charges.filter(x => x.merchant === "Kissa Midori café").map(x => x.own?.name), ["Coffee", "Coffee", "Coffee"]);
      assert.equal(state.charges.find(x => x.merchant === "Minato Fresh Market")!.own, undefined);
      assert.deepEqual(state.charges.filter(x => x.own).map(x => x.own!.name).sort(), ["Books & films", "Books & films", "Coffee", "Coffee", "Coffee", "Gear", "Gear"].sort());
      const spending = await loadSpending(db, c, { from: "2026-09-01", to: "2026-11-30" });
      assert.equal(spending.charges.filter(x => x.own?.name === "Gear").length, 2);
      const items = spendingItems(spending, "2026-11-01", "2026-11-30");
      assert.ok(items.every(i => i.own === null || typeof i.own.id === "string"));
      assert.equal(items.filter(i => i.own?.name === "Gear").length, 2);
      const settings = await loadSettings(db, c);
      assert.deepEqual(settings.ownCategories.map(o => o.name), ["Coffee", "Books & films", "Gear"]);
      assert.ok(settings.bills.every(x => x.ownCategoryId === null));
    });

    await check("November: Food ¥10,700 with Coffee ¥1,880, Other ¥48,900 with Gear ¥24,600; totals, the sentence and the words about money do not move", async () => {
      const c = await seedBen(db, { isDemo: true });
      const spending = await loadSpending(db, c, { from: "2026-08-01", to: "2026-12-31" });
      const view = monthByCategory(spending, DEMO_DATE, "2026-11");
      const food = view.categories.find(x => x.category === "food")!, other = view.categories.find(x => x.category === "other")!;
      assert.deepEqual([food.totalMinor, other.totalMinor, view.totalMinor], [10_700, 48_900, 152_230]);
      assert.deepEqual(food.ownCategories.map(o => [o.name, o.totalMinor, o.items.length]), [["Coffee", 1_880, 1]]);
      assert.equal(food.withoutOwn!.totalMinor, 8_820);
      assert.equal(food.ownCategories[0].personalMinor + food.ownCategories[0].businessMinor, 1_880);
      assert.deepEqual(other.ownCategories.map(o => [o.name, o.totalMinor]), [["Gear", 24_600]]);
      assert.equal(other.withoutOwn!.totalMinor, 24_300);
      assert.equal(view.categories.find(x => x.category === "housing")!.ownCategories.length, 0);
      assert.equal(view.categories.find(x => x.category === "housing")!.withoutOwn, null);
      assert.ok(food.items.some(i => i.own?.name === "Coffee") && food.items.some(i => i.own === null));
      const text = monthText(view);
      assert.match(text, /In Food: Food › Coffee ¥1,880; Food without a category of your own ¥8,820\./);
      assert.match(text, /In Other: Other › Gear ¥24,600; Other without a category of your own ¥24,300\./);
      const october = monthByCategory(spending, DEMO_DATE, "2026-10");
      assert.deepEqual(october.categories.find(x => x.category === "other")!.ownCategories.map(o => [o.name, o.totalMinor]), [["Books & films", 7_480]]);
    });

    await check("search: an own category's name matches, and a query that names one exactly totals it by month and says so", async () => {
      const c = await seedBen(db, { isDemo: true });
      const spending = await loadSpending(db, c, { from: "2026-08-01", to: "2026-12-31" });
      const items = spendingItems(spending, "2026-08-01", "2026-11-30");
      const found = searchSpending(items, "Gear", "JPY", { from: "2026-09-01", to: "2026-11-30" });
      assert.deepEqual(found.own, { id: found.own!.id, name: "Gear", category: "other" });
      assert.equal(found.category, null);
      assert.equal(found.totalMinor, 24_600);
      assert.deepEqual(found.months.filter(m => m.totalMinor > 0).map(m => [m.month, m.totalMinor]), [["2026-11", 24_600]]);
      assert.deepEqual(found.months[0].byOwn.map(o => [o.name, o.totalMinor]), [["Gear", 24_600]]);
      assert.match(searchLine(found), /^Other › Gear: ¥24,600 in November \(2 items\)/);
      const books = searchSpending(items, "books & films", "JPY", { from: "2026-09-01", to: "2026-11-30" });
      assert.deepEqual([books.own?.name, books.totalMinor], ["Books & films", 7_480]);
      const coffee = searchSpending(items, "coffee", "JPY", { from: "2026-09-01", to: "2026-11-30" });
      assert.deepEqual(coffee.months.filter(m => m.totalMinor > 0).map(m => [m.month, m.totalMinor]), [["2026-11", 1_880], ["2026-10", 2_800]]);
      assert.equal(searchSpending(items, "Food", "JPY", { from: "2026-09-01", to: "2026-11-30" }).own, null, "a category name is a category, not an own one");
      assert.equal(searchSpending(items, "kissa", "JPY", { from: "2026-09-01", to: "2026-11-30" }).own, null);
    });

    await check("To check names the own category of a waiting charge: \"Food › Coffee\"", async () => {
      const c = await seedBen(db, { isDemo: true });
      const waiting = await charge(c, { merchant: "Fictional Pending Roaster", ownCategoryId: await idOf(c, "Coffee") });
      await insertCharge(db, c, waiting, "pending", "manual", form);
      const state = await loadMoneyState(db, c, DEMO_DATE);
      const line = toCheck(state).find(x => x.id === waiting.id)!;
      assert.match(line.detail, /· Food › Coffee ·/);
      assert.equal(ownLabel("food", null), "Food");
      assert.equal(ownLabel("food", { name: "Coffee" }), "Food › Coffee");
    });

    await check("resolveOwnCategory inside a household transaction: undefined when nothing is said, null for none", async () => {
      const coffee = await idOf(a, "Coffee");
      await withHousehold(db, a, async tx => {
        assert.equal(await resolveOwnCategory(tx, a, "food", {}), undefined);
        assert.equal(await resolveOwnCategory(tx, a, "food", { ownCategoryId: null }), null);
        assert.equal(await resolveOwnCategory(tx, a, "food", { ownCategoryNew: "  " }), undefined, "a blank new name is not said");
        assert.equal(await resolveOwnCategory(tx, a, "food", { ownCategoryId: coffee }), coffee);
      });
    });

    console.log(`Own categories checks passed (${passed}).`);
  } finally {
    await pg.close();
  }
}
main().catch(error => { console.error("Own categories checks failed", error instanceof Error ? error.stack?.split("\n").slice(0, 10).join("\n") : error); process.exitCode = 1; });
