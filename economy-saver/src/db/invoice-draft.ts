import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { parseAmountMinor } from "./money";
import { recordEvent, requireHousehold, type Db, type Maker } from "./household";
import { clients, invoices } from "./schema";

export const draftInput = z.object({
  id: z.string().uuid(),
  clientId: z.string().uuid(),
  item: z.string().trim().min(1).max(200),
  amount: z.string().trim().min(1).max(20),
  note: z.string().trim().max(3900).default(""),
});

export async function saveInvoiceDraft(db: Db, householdId: string, input: z.infer<typeof draftInput>, by: Maker) {
  const data = draftInput.parse(input);
  const hid = requireHousehold(householdId);
  const amountMinor = parseAmountMinor(data.amount, "USD");
  return db.transaction(async tx => {
    const [client] = await tx.select({ name: clients.name }).from(clients)
      .where(and(eq(clients.householdId, hid), eq(clients.id, data.clientId)));
    if (!client) throw new Error("Client not found");
    const inserted = await tx.insert(invoices).values({
      id: data.id, householdId: hid, clientId: data.clientId, status: "draft", item: data.item,
      currency: "USD", amountMinor, note: data.note || null, madeBy: by.madeBy, askId: by.askId ?? null,
    }).onConflictDoNothing({ target: invoices.id }).returning({ id: invoices.id });
    if (inserted.length) {
      await recordEvent(tx, hid, { ...by, kind: "invoice_drafted", title: `Invoice drafted for ${client.name}`,
        ref: { type: "invoice", id: data.id } });
    } else {
      const [existing] = await tx.select({ id: invoices.id }).from(invoices)
        .where(and(eq(invoices.householdId, hid), eq(invoices.id, data.id), eq(invoices.clientId, data.clientId),
          eq(invoices.amountMinor, amountMinor), eq(invoices.item, data.item)));
      if (!existing) throw new Error("Draft identifier already in use");
    }
    return data.id;
  });
}
