import { eq } from "drizzle-orm";
import { clockForHousehold } from "@/db/clock";
import { requireHousehold, withHousehold, type Db } from "@/db/household";
import { ownChoices } from "@/db/own-categories";
import { cards, households, members } from "@/db/schema";

/** What the Add forms need: today, the home currency, the people and cards to choose from and the household's own categories (D75). */
export async function loadAddView(db: Db, householdId: string) {
  const hid = requireHousehold(householdId);
  return withHousehold(db, hid, async tx => {
    const [household] = await tx.select().from(households).where(eq(households.id, hid));
    if (!household) return null;
    const [people, cardRows, own] = await Promise.all([
      tx.select({ id: members.id, name: members.displayName }).from(members).where(eq(members.householdId, hid)).orderBy(members.createdAt),
      tx.select({ id: cards.id, label: cards.label }).from(cards).where(eq(cards.householdId, hid)).orderBy(cards.createdAt, cards.label),
      ownChoices(tx, hid),
    ]);
    return { today: clockForHousehold(household).today, homeCurrency: household.homeCurrency.trim(), people, cards: cardRows, own };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}

export type AddView = NonNullable<Awaited<ReturnType<typeof loadAddView>>>;
