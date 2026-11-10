import { db } from "@/db/client";
import { withHousehold } from "@/db/household";
import { importCharges, importInput } from "@/db/import-charges";
import { badFields, failure, limited, NO_STORE } from "@/lib/door";
import { householdRequest } from "@/lib/session";

/**
 * Settings → Import a statement (D53): one batch of up to 500 rows the browser read from a card or bank CSV, for one card.
 * JSON in, JSON out ({ added, skipped }); a refusal is plain text, as from the form routes.
 */
export async function POST(request: Request) {
  const hid = await householdRequest(request);
  if (hid instanceof Response) return hid;
  const busy = await limited(hid, "statement-import", 10, "Too many imports. Try again in a minute.");
  if (busy) return busy;
  let body: unknown;
  try { body = await request.json(); } catch { return badFields(); }
  const data = importInput.safeParse(body);
  if (!data.success) return badFields();
  try {
    const result = await withHousehold(db(), hid, tx => importCharges(tx, hid, data.data.cardId, data.data.rows, { madeBy: "import" }));
    return Response.json(result, { headers: NO_STORE });
  } catch (error) {
    return failure(error);
  }
}
