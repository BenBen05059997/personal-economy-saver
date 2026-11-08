import { db } from "@/db/client";
import { withHousehold } from "@/db/household";
import { consumeRequest } from "@/db/rate-limit";
import { loadHouseholdSnapshot } from "@/db/snapshot";
import { failure, NO_STORE, tooMany } from "@/lib/door";
import { householdRequest } from "@/lib/session";

// Export my data (D44): the household's snapshot with its events, as a download. A POST form, so nothing is in a URL.
export async function POST(request: Request) {
  const hid = await householdRequest(request);
  if (hid instanceof Response) return hid;
  try {
    if (!await withHousehold(db(), hid, tx => consumeRequest(tx, hid, "export", 6))) return tooMany("Export limit reached. Try again in a minute.");
    const snapshot = await withHousehold(db(), hid, tx => loadHouseholdSnapshot(tx, hid, { events: true, stored: true }),
      { isolationLevel: "repeatable read", accessMode: "read only" });
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
