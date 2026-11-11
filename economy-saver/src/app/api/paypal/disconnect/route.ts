import { db } from "@/db/client";
import { disconnect } from "@/db/paypal-connection";
import { limited, redirectTo } from "@/lib/door";
import { ownerRequest } from "@/lib/session";

/** Settings → PayPal → Disconnect: fipa forgets the connection (D76). */
export async function POST(request: Request) {
  const householdId = await ownerRequest(request);
  if (householdId instanceof Response) return householdId;
  const connection = db();
  const busy = await limited(householdId, "paypal-connect", 20, "Too many tries. Try again in a minute.", connection);
  if (busy) return busy;
  await disconnect(connection, householdId);
  return redirectTo("/settings/paypal", request);
}
