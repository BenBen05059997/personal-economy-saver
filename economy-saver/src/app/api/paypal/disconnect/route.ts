import { db } from "@/db/client";
import { disconnect } from "@/db/paypal-connection";
import { limited, TOO_MANY_TRIES } from "@/lib/door";
import { redirectTo } from "@/lib/form-redirect";
import { ownerRequest } from "@/lib/session";
import { SETTINGS_PAYPAL } from "@/lib/links";

/** Settings → PayPal → Disconnect: fipa forgets the connection (D76). */
export async function POST(request: Request) {
  const householdId = await ownerRequest(request);
  if (householdId instanceof Response) return householdId;
  const connection = db();
  const busy = await limited(householdId, "paypal-connect", 20, TOO_MANY_TRIES, connection);
  if (busy) return busy;
  await disconnect(connection, householdId);
  return redirectTo(SETTINGS_PAYPAL, request);
}
