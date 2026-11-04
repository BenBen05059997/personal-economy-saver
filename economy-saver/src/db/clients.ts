import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { InputError } from "./input-error";
import { recordEvent, requireHousehold, type Db } from "./household";
import { clients, households } from "./schema";

export const clientInput = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(254),
  termsDays: z.coerce.number().int().min(0).max(120),
});

/** Adds a client. Idempotent on `id`: the same id with the same fields returns it again, different fields throw. */
export async function insertClient(db: Db, householdId: string, input: z.infer<typeof clientInput>): Promise<string> {
  const hid = requireHousehold(householdId);
  const data = clientInput.parse(input);
  return db.transaction(async tx => {
    const [household] = await tx.select({ id: households.id }).from(households).where(eq(households.id, hid)).for("update");
    if (!household) throw new InputError("Household not found");
    const [existing] = await tx.select().from(clients).where(and(eq(clients.householdId, hid), eq(clients.id, data.id)));
    if (existing) {
      if (existing.name !== data.name || existing.email !== data.email || existing.termsDays !== data.termsDays) {
        throw new InputError("This client identifier is already in use");
      }
      return data.id;
    }
    await tx.insert(clients).values({ id: data.id, householdId: hid, name: data.name, email: data.email, termsDays: data.termsDays });
    await recordEvent(tx, hid, { madeBy: "form", kind: "client_added", title: `${data.name} added as a client`, ref: { type: "client", id: data.id } });
    return data.id;
  });
}
