import { db } from "@/db/client";
import { ConnectError, startConnect } from "@/db/paypal-connection";
import { limited, redirectTo, text } from "@/lib/door";
import { PayPalError, paypalRead } from "@/lib/paypal/client";
import { ownerRequest } from "@/lib/session";

/** Settings → PayPal → Connect: the owner starts PayPal's partner sign-up and is sent to PayPal (D76). */
export async function POST(request: Request) {
  const householdId = await ownerRequest(request);
  if (householdId instanceof Response) return householdId;
  const connection = db();
  const busy = await limited(householdId, "paypal-connect", 5, "Too many tries. Try again in a minute.", connection);
  if (busy) return busy;
  try {
    return redirectTo(await startConnect(connection, householdId, paypalRead));
  } catch (error) {
    if (error instanceof ConnectError) return text(error.message, error.status);
    if (error instanceof PayPalError || (error instanceof Error && error.name === "TimeoutError")) return text("PayPal did not answer. Try again in a moment.", 502);
    throw error;
  }
}
