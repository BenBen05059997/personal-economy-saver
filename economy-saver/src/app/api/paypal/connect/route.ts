import { db } from "@/db/client";
import { ConnectError, startConnect } from "@/db/paypal-connection";
import { limited, text, TOO_MANY_TRIES } from "@/lib/door";
import { redirectTo } from "@/lib/form-fetch";
import { didNotAnswer, PAYPAL_DID_NOT_ANSWER, paypalRead } from "@/lib/paypal/client";
import { ownerRequest } from "@/lib/session";

/** Settings → PayPal → Connect: the owner starts PayPal's partner sign-up and is sent to PayPal (D76). */
export async function POST(request: Request) {
  const householdId = await ownerRequest(request);
  if (householdId instanceof Response) return householdId;
  const connection = db();
  const busy = await limited(householdId, "paypal-connect", 5, TOO_MANY_TRIES, connection);
  if (busy) return busy;
  try {
    return redirectTo(await startConnect(connection, householdId, paypalRead));
  } catch (error) {
    if (error instanceof ConnectError) return text(error.message, error.status);
    if (didNotAnswer(error)) return text(PAYPAL_DID_NOT_ANSWER, 502);
    throw error;
  }
}
