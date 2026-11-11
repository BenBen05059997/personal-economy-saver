// Own categories (D75): the person's own names under the fixed fourteen categories ("Food › Coffee"). One function per job, called by
// Spending → Your categories, the bill and charge writes, Spending's File control and the agent's tools. A bill or charge has at most one,
// of its own category's kind; the database refuses another household's or another kind's. A category, an own category and a default
// business share move no money, so nothing here observes the runway and no Activity event is recorded.
import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";
import { InputError } from "./input-error";
import { requireHousehold, withHousehold, type Db } from "./household";
import { bills, charges, households, ownCategories } from "./schema";
import { BusinessBp, CATEGORIES, CategoryKeySchema, categoryLabel, type CategoryKey } from "@/lib/money/categories";
import { nameKey } from "@/lib/money/name-key";
import { OWN_CATEGORY_CAP, OWN_CAP_WORDS, ownNameProblem } from "@/lib/money/own-category";

export { OWN_CATEGORY_CAP, OWN_CAP_WORDS, OWN_NAME_LENGTH_WORDS, OWN_NAME_MAX, ownLabel, ownNameProblem } from "@/lib/money/own-category";

/** One own category with the number of bills and charges filed under it. */
export type OwnCategory = { id: string; kind: CategoryKey; name: string; businessBp: number | null; items: number };
/** The own categories of one category, in the order of the fourteen. */
export type OwnCategoryGroup = { kind: CategoryKey; label: string; categories: OwnCategory[] };

const id = z.string().uuid();
const businessShare = BusinessBp.nullable();
export const addOwnCategoryInput = z.object({ id: id.optional(), kind: CategoryKeySchema, name: z.string(), businessBp: businessShare.optional() });
export const saveOwnCategoryInput = z.object({ id, name: z.string().optional(), businessBp: businessShare.optional() }); // absent = unchanged, null = clear the share
export const mergeOwnCategoryInput = z.object({ id, into: id });
export const removeOwnCategoryInput = z.object({ id });
export const fileOwnCategoryInput = z.object({
  item: z.enum(["bill", "charge"]),
  id,
  ownCategoryId: id.nullable(), // null = none
  everySame: z.boolean().default(false), // also every bill and charge with the same normalised name and the same category
});
/** The two fields a bill or charge write accepts (`billInput`, `chargeInput`, `billEditInput`, the reader's review): an id (null = none) or a new name. Both absent = not said. */
export const ownChoiceFields = {
  ownCategoryId: id.nullable().optional(),
  ownCategoryNew: z.string().optional(), // made, or found when it already exists under the item's category, in the same transaction
};
export type OwnChoice = { ownCategoryId?: string | null; ownCategoryNew?: string };

const KIND_ORDER = new Map<string, number>(CATEGORIES.map((c, i) => [c.key, i]));
const NOT_YOURS = "Choose one of your categories.";

async function rowsOf(tx: Db, hid: string, kind?: CategoryKey) {
  return tx.select().from(ownCategories).where(and(eq(ownCategories.householdId, hid), ...(kind ? [eq(ownCategories.kind, kind)] : [])));
}

async function countsOf(tx: Db, hid: string): Promise<Map<string, number>> {
  const [billCounts, chargeCounts] = await Promise.all([
    tx.select({ own: bills.ownCategoryId, n: sql<number>`count(*)::int` }).from(bills).where(and(eq(bills.householdId, hid), isNotNull(bills.ownCategoryId))).groupBy(bills.ownCategoryId),
    tx.select({ own: charges.ownCategoryId, n: sql<number>`count(*)::int` }).from(charges).where(and(eq(charges.householdId, hid), isNotNull(charges.ownCategoryId))).groupBy(charges.ownCategoryId),
  ]);
  const counts = new Map<string, number>();
  for (const r of [...billCounts, ...chargeCounts]) if (r.own) counts.set(r.own, (counts.get(r.own) ?? 0) + r.n);
  return counts;
}

const toOwn = (r: typeof ownCategories.$inferSelect, counts: Map<string, number>): OwnCategory =>
  ({ id: r.id, kind: CategoryKeySchema.parse(r.kind), name: r.name, businessBp: r.businessBp, items: counts.get(r.id) ?? 0 });

/** The household's own categories by id, as an item carries one (`{ id, name }`): the loaders attach them to bills and charges. */
export async function ownCategoryRefs(db: Db, householdId: string): Promise<Map<string, { id: string; name: string }>> {
  const hid = requireHousehold(householdId);
  const rows = await db.select({ id: ownCategories.id, name: ownCategories.name }).from(ownCategories).where(eq(ownCategories.householdId, hid));
  return new Map(rows.map(r => [r.id, { id: r.id, name: r.name }]));
}

/** This household's own categories, flat: by category in the order of the fourteen, then by name; each with how many bills and charges are filed under it. */
export async function listOwnCategories(db: Db, householdId: string): Promise<OwnCategory[]> {
  const hid = requireHousehold(householdId);
  return withHousehold(db, hid, async tx => {
    const [rows, counts] = await Promise.all([rowsOf(tx, hid), countsOf(tx, hid)]);
    return rows.map(r => toOwn(r, counts)).sort((a, b) => KIND_ORDER.get(a.kind)! - KIND_ORDER.get(b.kind)! || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  });
}

/** The same list grouped by category; only categories that have one. */
export function groupOwnCategories(list: readonly OwnCategory[]): OwnCategoryGroup[] {
  return CATEGORIES.flatMap(c => {
    const categories = list.filter(o => o.kind === c.key);
    return categories.length === 0 ? [] : [{ kind: c.key, label: c.label, categories }];
  });
}

export async function listOwnCategoriesGrouped(db: Db, householdId: string): Promise<OwnCategoryGroup[]> {
  return groupOwnCategories(await listOwnCategories(db, householdId));
}

/** Checks a name for `kind` against the household's rows (a rename leaves its own row out) and returns it trimmed. */
async function checkedName(tx: Db, hid: string, kind: CategoryKey, name: string, except: string | null): Promise<string> {
  const existing = (await rowsOf(tx, hid, kind)).filter(r => r.id !== except);
  const problem = ownNameProblem(name, kind, existing);
  if (problem !== null) throw new InputError(problem);
  return name.trim();
}

/** Makes the row, after the name rules and the cap. Locks the household row so two adds cannot pass the cap together. */
async function createRow(tx: Db, hid: string, kind: CategoryKey, name: string, businessBp: number | null, wantedId?: string): Promise<OwnCategory> {
  await tx.select({ id: households.id }).from(households).where(eq(households.id, hid)).for("update");
  const trimmed = await checkedName(tx, hid, kind, name, null);
  if ((await rowsOf(tx, hid)).length >= OWN_CATEGORY_CAP) throw new InputError(OWN_CAP_WORDS);
  const [row] = await tx.insert(ownCategories).values({ ...(wantedId && { id: wantedId }), householdId: hid, kind, name: trimmed, nameKey: nameKey(trimmed), businessBp }).returning();
  return toOwn(row, new Map());
}

/** Adds an own category under one of the fourteen, with an optional default business share. Refuses in the person's words (name rules, the cap of 40). */
export async function addOwnCategory(db: Db, householdId: string, input: z.input<typeof addOwnCategoryInput>): Promise<OwnCategory> {
  const hid = requireHousehold(householdId);
  const data = addOwnCategoryInput.parse(input);
  return withHousehold(db, hid, tx => createRow(tx, hid, data.kind, data.name, data.businessBp ?? null, data.id));
}

/** Renames an own category and/or changes its default business share (null clears it). Items already saved keep their own share. Null when this household has no such category. */
export async function saveOwnCategory(db: Db, householdId: string, input: z.input<typeof saveOwnCategoryInput>): Promise<OwnCategory | null> {
  const hid = requireHousehold(householdId);
  const data = saveOwnCategoryInput.parse(input);
  return withHousehold(db, hid, async tx => {
    const [row] = await tx.select().from(ownCategories).where(and(eq(ownCategories.householdId, hid), eq(ownCategories.id, data.id))).for("update");
    if (!row) return null;
    const kind = CategoryKeySchema.parse(row.kind);
    const name = data.name === undefined ? row.name : await checkedName(tx, hid, kind, data.name, row.id);
    const businessBp = data.businessBp === undefined ? row.businessBp : data.businessBp;
    const [saved] = await tx.update(ownCategories).set({ name, nameKey: nameKey(name), businessBp }).where(and(eq(ownCategories.householdId, hid), eq(ownCategories.id, row.id))).returning();
    return toOwn(saved, await countsOf(tx, hid));
  });
}

/** Moves every bill and charge of `id` to `into` (the same category only) and removes `id`. Returns how many items moved. */
export async function mergeOwnCategories(db: Db, householdId: string, input: z.input<typeof mergeOwnCategoryInput>): Promise<{ moved: number }> {
  const hid = requireHousehold(householdId);
  const data = mergeOwnCategoryInput.parse(input);
  return withHousehold(db, hid, async tx => {
    if (data.id === data.into) throw new InputError("Choose a different category to merge into.");
    const rows = await tx.select().from(ownCategories).where(and(eq(ownCategories.householdId, hid), inArray(ownCategories.id, [data.id, data.into])));
    const from = rows.find(r => r.id === data.id), to = rows.find(r => r.id === data.into);
    if (!from || !to) throw new InputError(NOT_YOURS);
    if (from.kind !== to.kind) throw new InputError(`${from.name} is under ${categoryLabel(CategoryKeySchema.parse(from.kind))}; it can only merge into another category under ${categoryLabel(CategoryKeySchema.parse(from.kind))}.`);
    const movedBills = await tx.update(bills).set({ ownCategoryId: to.id }).where(and(eq(bills.householdId, hid), eq(bills.ownCategoryId, from.id))).returning({ id: bills.id });
    const movedCharges = await tx.update(charges).set({ ownCategoryId: to.id }).where(and(eq(charges.householdId, hid), eq(charges.ownCategoryId, from.id))).returning({ id: charges.id });
    await tx.delete(ownCategories).where(and(eq(ownCategories.householdId, hid), eq(ownCategories.id, from.id)));
    return { moved: movedBills.length + movedCharges.length };
  });
}

/** Removes an own category; its items go back to the category alone (the database clears only the link). Returns how many items were filed under it, or null when this household has no such category. */
export async function removeOwnCategory(db: Db, householdId: string, input: z.input<typeof removeOwnCategoryInput>): Promise<{ cleared: number } | null> {
  const hid = requireHousehold(householdId);
  const data = removeOwnCategoryInput.parse(input);
  return withHousehold(db, hid, async tx => {
    const [row] = await tx.select({ id: ownCategories.id }).from(ownCategories).where(and(eq(ownCategories.householdId, hid), eq(ownCategories.id, data.id))).for("update");
    if (!row) return null;
    const cleared = (await countsOf(tx, hid)).get(row.id) ?? 0;
    await tx.delete(ownCategories).where(and(eq(ownCategories.householdId, hid), eq(ownCategories.id, row.id)));
    return { cleared };
  });
}

/** Checks `ownId` is one of this household's own categories of `category`'s kind, in words. */
async function requireOwnOfKind(tx: Db, hid: string, category: CategoryKey, ownId: string): Promise<void> {
  const [own] = await tx.select({ kind: ownCategories.kind, name: ownCategories.name }).from(ownCategories).where(and(eq(ownCategories.householdId, hid), eq(ownCategories.id, ownId)));
  if (!own) throw new InputError(NOT_YOURS);
  if (own.kind !== category) throw new InputError(`${own.name} is a category under ${categoryLabel(CategoryKeySchema.parse(own.kind))}, not ${categoryLabel(category)}.`);
}

/**
 * What a bill or charge write files the item under: `string` an own category of this household and `category`'s kind, `null` none,
 * `undefined` nothing said. A new name is made, or found when it already exists under that category, inside the caller's transaction
 * (name rules and the cap apply to a new one). Refuses another kind's or another household's id in words, before the database does.
 */
export async function resolveOwnCategory(tx: Db, householdId: string, category: CategoryKey, choice: OwnChoice): Promise<string | null | undefined> {
  const hid = requireHousehold(householdId);
  const wanted = choice.ownCategoryNew?.trim() ?? "";
  if (wanted !== "") {
    if (choice.ownCategoryId) throw new InputError("Choose one of your categories or make a new one, not both.");
    const [found] = (await rowsOf(tx, hid, category)).filter(r => r.nameKey === nameKey(wanted));
    if (found) return found.id;
    return (await createRow(tx, hid, category, wanted, null)).id;
  }
  if (choice.ownCategoryId === undefined) return undefined;
  if (choice.ownCategoryId === null) return null;
  await requireOwnOfKind(tx, hid, category, choice.ownCategoryId);
  return choice.ownCategoryId;
}

/**
 * Files one bill or charge under an own category of its category's kind, or under none (null). With `everySame`, also every bill and
 * charge of the household with the same `nameKey` and the same category (any status). Returns how many items were filed; null when this
 * household has no such item.
 */
export async function fileOwnCategory(db: Db, householdId: string, input: z.input<typeof fileOwnCategoryInput>): Promise<{ filed: number } | null> {
  const hid = requireHousehold(householdId);
  const data = fileOwnCategoryInput.parse(input);
  return withHousehold(db, hid, async tx => {
    const [item] = data.item === "bill"
      ? await tx.select({ name: bills.biller, category: bills.category }).from(bills).where(and(eq(bills.householdId, hid), eq(bills.id, data.id)))
      : await tx.select({ name: charges.merchant, category: charges.category }).from(charges).where(and(eq(charges.householdId, hid), eq(charges.id, data.id)));
    if (!item) return null;
    const category = CategoryKeySchema.parse(item.category);
    if (data.ownCategoryId !== null) await requireOwnOfKind(tx, hid, category, data.ownCategoryId);
    let billIds = data.item === "bill" ? [data.id] : [], chargeIds = data.item === "charge" ? [data.id] : [];
    if (data.everySame) {
      const key = nameKey(item.name);
      const [sameBills, sameCharges] = await Promise.all([
        tx.select({ id: bills.id, name: bills.biller }).from(bills).where(and(eq(bills.householdId, hid), eq(bills.category, category))),
        tx.select({ id: charges.id, name: charges.merchant }).from(charges).where(and(eq(charges.householdId, hid), eq(charges.category, category))),
      ]);
      billIds = sameBills.filter(r => nameKey(r.name) === key).map(r => r.id);
      chargeIds = sameCharges.filter(r => nameKey(r.name) === key).map(r => r.id);
    }
    if (billIds.length > 0) await tx.update(bills).set({ ownCategoryId: data.ownCategoryId }).where(and(eq(bills.householdId, hid), inArray(bills.id, billIds)));
    if (chargeIds.length > 0) await tx.update(charges).set({ ownCategoryId: data.ownCategoryId }).where(and(eq(charges.householdId, hid), inArray(charges.id, chargeIds)));
    return { filed: billIds.length + chargeIds.length };
  });
}

/**
 * "It files itself": the own category of the latest confirmed bill or charge of `category` whose name has the same `nameKey` as `name`
 * and that has one; null when none. Latest by creation time. Carries the default business share so a form can pre-fill it.
 */
export async function guessOwnCategory(db: Db, householdId: string, category: CategoryKey, name: string): Promise<{ id: string; name: string; businessBp: number | null } | null> {
  const hid = requireHousehold(householdId);
  const cat = CategoryKeySchema.parse(category);
  const key = nameKey(name);
  return withHousehold(db, hid, async tx => {
    const [billRows, chargeRows] = await Promise.all([
      tx.select({ name: bills.biller, own: bills.ownCategoryId, at: bills.createdAt }).from(bills)
        .where(and(eq(bills.householdId, hid), eq(bills.category, cat), eq(bills.status, "confirmed"), isNotNull(bills.ownCategoryId))).orderBy(desc(bills.createdAt)),
      tx.select({ name: charges.merchant, own: charges.ownCategoryId, at: charges.createdAt }).from(charges)
        .where(and(eq(charges.householdId, hid), eq(charges.category, cat), eq(charges.status, "confirmed"), isNotNull(charges.ownCategoryId))).orderBy(desc(charges.createdAt)),
    ]);
    const latest = [...billRows, ...chargeRows].filter(r => r.own !== null && nameKey(r.name) === key).sort((a, b) => b.at.getTime() - a.at.getTime())[0];
    if (!latest) return null;
    const [own] = await tx.select({ id: ownCategories.id, name: ownCategories.name, businessBp: ownCategories.businessBp }).from(ownCategories).where(and(eq(ownCategories.householdId, hid), eq(ownCategories.id, latest.own!)));
    return own ?? null;
  });
}

/**
 * For the agent: the own category of `category` called `name` (matched by `nameKey`), or null, and the names of all of that category's
 * own categories (so a refusal can list them).
 */
export async function findOwnCategory(db: Db, householdId: string, category: CategoryKey, name: string): Promise<{ match: OwnCategory | null; names: string[] }> {
  const hid = requireHousehold(householdId);
  const cat = CategoryKeySchema.parse(category);
  const list = (await listOwnCategories(db, hid)).filter(o => o.kind === cat);
  const key = nameKey(name);
  return { match: list.find(o => nameKey(o.name) === key) ?? null, names: list.map(o => o.name) };
}

/**
 * What the Add forms, Settings → Bills edit and the reader's form need in the browser (one read transaction, three queries): the
 * household's own categories, and for each category and `nameKey` the own category of the latest confirmed bill or charge that has one.
 * The browser matches a typed name against `guesses` ("it files itself"), so no lookup runs per keystroke. Keys are `<category>|<nameKey>`.
 */
export async function ownChoices(db: Db, householdId: string): Promise<{ categories: { id: string; kind: string; name: string; businessBp: number | null }[]; guesses: Record<string, string> }> {
  const hid = requireHousehold(householdId);
  return withHousehold(db, hid, async tx => {
    const [rows, billRows, chargeRows] = await Promise.all([
      rowsOf(tx, hid),
      tx.select({ name: bills.biller, category: bills.category, own: bills.ownCategoryId, at: bills.createdAt }).from(bills)
        .where(and(eq(bills.householdId, hid), eq(bills.status, "confirmed"), isNotNull(bills.ownCategoryId))),
      tx.select({ name: charges.merchant, category: charges.category, own: charges.ownCategoryId, at: charges.createdAt }).from(charges)
        .where(and(eq(charges.householdId, hid), eq(charges.status, "confirmed"), isNotNull(charges.ownCategoryId))),
    ]);
    const categories = rows.map(r => ({ id: r.id, kind: r.kind, name: r.name, businessBp: r.businessBp }))
      .sort((a, b) => KIND_ORDER.get(a.kind)! - KIND_ORDER.get(b.kind)! || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    const guesses: Record<string, string> = {};
    for (const r of [...billRows, ...chargeRows].sort((a, b) => a.at.getTime() - b.at.getTime())) guesses[`${r.category}|${nameKey(r.name)}`] = r.own!; // oldest first, so the latest wins
    return { categories, guesses };
  });
}
