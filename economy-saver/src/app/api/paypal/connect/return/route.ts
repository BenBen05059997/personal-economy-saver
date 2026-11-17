import { db } from "@/db/client";
import { ConnectError, confirmConnection } from "@/db/paypal-connection";
import { limited, text, TOO_MANY_TRIES } from "@/lib/door";
import { redirectTo } from "@/lib/form-redirect";
import { didNotAnswer, PAYPAL_DID_NOT_ANSWER, paypalRead } from "@/lib/paypal/client";
import { currentHouseholdId, hasHouseholdOwnerAccess, ownerRequest } from "@/lib/session";
import { SETTINGS_PAYPAL } from "@/lib/links";

/** Where PayPal sends the person back (a cross-site GET). Nothing in the address is believed: PayPal is asked about the tracking id this household stored. */
export async function GET() {
  const householdId = await currentHouseholdId();
  if (!householdId) return redirectTo("/");
  if (!await hasHouseholdOwnerAccess(householdId)) return redirectTo(SETTINGS_PAYPAL);
  const busy = await limited(householdId, "paypal-connect", 20, TOO_MANY_TRIES);
  if (busy) return busy;
  try {
    await confirmConnection(db(), householdId, paypalRead);
  } catch (error) {
    // The tab shows where the connection stands; a refused or failed confirmation just leaves it as it was.
    if (!(error instanceof ConnectError || didNotAnswer(error))) throw error;
  }
  return redirectTo(SETTINGS_PAYPAL);
}

/** "Check again" on the pending tab: confirms the tracking id this household stored. */
export async function POST(request: Request) {
  const householdId = await ownerRequest(request);
  if (householdId instanceof Response) return householdId;
  const connection = db();
  const busy = await limited(householdId, "paypal-connect", 20, TOO_MANY_TRIES, connection);
  if (busy) return busy;
  try {
    await confirmConnection(connection, householdId, paypalRead);
  } catch (error) {
    if (error instanceof ConnectError) return text(error.message, error.status);
    if (didNotAnswer(error)) return text(PAYPAL_DID_NOT_ANSWER, 502);
    throw error;
  }
  return redirectTo(SETTINGS_PAYPAL, request);
}
