import { db } from "@/db/client";
import { ConnectError, confirmConnection } from "@/db/paypal-connection";
import { limited, redirectTo, text } from "@/lib/door";
import { PayPalError, paypalRead } from "@/lib/paypal/client";
import { currentHouseholdId, hasHouseholdOwnerAccess, ownerRequest } from "@/lib/session";

const TAB = "/settings/paypal";

/** Where PayPal sends the person back (a cross-site GET). Nothing in the address is believed: PayPal is asked about the tracking id this household stored. */
export async function GET() {
  const householdId = await currentHouseholdId();
  if (!householdId) return redirectTo("/");
  if (!await hasHouseholdOwnerAccess(householdId)) return redirectTo(TAB);
  const busy = await limited(householdId, "paypal-connect", 20, "Too many tries. Try again in a minute.");
  if (busy) return busy;
  try {
    await confirmConnection(db(), householdId, paypalRead);
  } catch (error) {
    // The tab shows where the connection stands; a refused or failed confirmation just leaves it as it was.
    if (!(error instanceof ConnectError || error instanceof PayPalError || (error instanceof Error && error.name === "TimeoutError"))) throw error;
  }
  return redirectTo(TAB);
}

/** "Check again" on the pending tab: confirms the tracking id this household stored. */
export async function POST(request: Request) {
  const householdId = await ownerRequest(request);
  if (householdId instanceof Response) return householdId;
  const connection = db();
  const busy = await limited(householdId, "paypal-connect", 20, "Too many tries. Try again in a minute.", connection);
  if (busy) return busy;
  try {
    await confirmConnection(connection, householdId, paypalRead);
  } catch (error) {
    if (error instanceof ConnectError) return text(error.message, error.status);
    if (error instanceof PayPalError || (error instanceof Error && error.name === "TimeoutError")) return text("PayPal did not answer. Try again in a moment.", 502);
    throw error;
  }
  return redirectTo(TAB, request);
}
