import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { householdDate } from "./account";
import { loadMoneyState, recordEvent, requireHousehold, type Db } from "./household";
import { cards, charges } from "./schema";
import { interpretQuestion } from "@/lib/money/ask";

export const askInput = z.object({ id: z.string().uuid(), text: z.string().trim().min(1).max(320), source: z.enum(["voice", "manual"]) });
export async function answerQuestion(db: Db, hid: string, input: z.infer<typeof askInput>) {
  const { id, text, source } = askInput.parse(input);
  const householdId = requireHousehold(hid);
  const today = await householdDate(db, householdId);
  const state = await loadMoneyState(db, householdId, today);
  const { answer, charge } = interpretQuestion(state, text);
  if (!charge) return { answer, pending: false };
  await db.transaction(async tx => {
    const [card] = await tx.select({ currency: cards.currency }).from(cards)
      .where(and(eq(cards.householdId, householdId), eq(cards.id, charge.cardId)));
    if (!card || card.currency !== state.homeCurrency) throw new Error("Card billing currency does not match this amount");
    const inserted = await tx.insert(charges).values({ id, householdId, ...charge,
      currency: card.currency, date: today, status: "pending", source })
      .onConflictDoNothing({ target: charges.id }).returning({ id: charges.id });
    if (inserted.length) {
      await recordEvent(tx, householdId, { kind: "to_check", title: `${charge.merchant} charge to check`,
        ref: { type: "charge", id }, notify: true });
    } else {
      const [same] = await tx.select({ id: charges.id }).from(charges).where(and(eq(charges.householdId, householdId),
        eq(charges.id, id), eq(charges.cardId, charge.cardId), eq(charges.amountMinor, charge.amountMinor), eq(charges.merchant, charge.merchant)));
      if (!same) throw new Error("The charge identifier is already in use");
    }
  });
  return { answer, pending: true };
}
