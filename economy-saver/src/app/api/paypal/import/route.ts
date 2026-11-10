import { ZodError } from "zod";
import { db } from "@/db/client";
import { ImportRefused, ImportSetupError, importPayPalHistory } from "@/db/paypal-import";
import { PayPalError } from "@/lib/paypal/client";
import { limited, redirectTo, text } from "@/lib/door";
import { householdRequest } from "@/lib/session";

export async function POST(request: Request) {
  const hid = await householdRequest(request);
  if (hid instanceof Response) return hid;
  const store = db();
  const busy = await limited(hid, "import", 2, "Import limit reached. Try again in a minute.", store);
  if (busy) return busy;
  try {
    await importPayPalHistory(store, hid);
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
