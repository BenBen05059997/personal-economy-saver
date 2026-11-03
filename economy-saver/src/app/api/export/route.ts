import { db } from "@/db/client";
import { consumeRequest } from "@/db/rate-limit";
import { loadHouseholdSnapshot } from "@/db/snapshot";
import { NO_STORE, failure, text } from "@/lib/door";
import { householdRequest } from "@/lib/session";

// Export my data (D44): the household's snapshot with its events, as a download. A POST form, so nothing is in a URL.
export async function POST(request: Request) {
  const hid = await householdRequest(request);
  if (hid instanceof Response) return hid;
  try {
    if (!await consumeRequest(db(), hid, "export", 6)) return text("Export limit reached. Try again in a minute.", 429, { "Retry-After": "60" });
    const snapshot = await loadHouseholdSnapshot(db(), hid, { events: true });
    return new Response(JSON.stringify(snapshot, null, 2) + "\n", {
      headers: {
        ...NO_STORE,
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="personal-economy-saver-${snapshot.household.today}.json"`,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return failure(error);
  }
}
