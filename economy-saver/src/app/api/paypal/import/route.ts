import { ZodError } from "zod";
import { db } from "@/db/client";
import { ImportRefused, ImportSetupError, importPayPalHistory } from "@/db/paypal-import";
import { consumeRequest } from "@/db/rate-limit";
import { PayPalError } from "@/lib/paypal/client";
import { redirectTo, text } from "@/lib/door";
import { householdRequest } from "@/lib/session";

export async function POST(request: Request) {
  const hid = await householdRequest(request);
  if (hid instanceof Response) return hid;
  if (!await consumeRequest(db(), hid, "import", 2)) return text("Import limit reached. Try again in a minute.", 429, { "Retry-After": "60" });
  try {
    await importPayPalHistory(db(), hid);
    return redirectTo("/settings");
  } catch (error) {
    if (error instanceof ImportRefused) return text(error.message, 403);
    if (error instanceof ImportSetupError) return text(error.message, 503);
    if (error instanceof PayPalError || error instanceof ZodError || (error instanceof Error && error.name === "TimeoutError")) {
      return text("PayPal did not answer. Try again.", 502);
    }
    return text("The import could not be completed. Try again.", 503);
  }
}
