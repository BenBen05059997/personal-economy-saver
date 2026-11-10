import { db } from "@/db/client";
import { withHousehold } from "@/db/household";
import { loadHouseholdSnapshot } from "@/db/snapshot";
import { NO_STORE, failure, limited } from "@/lib/door";
import { householdRequest } from "@/lib/session";

// Export my data (D44): the household's snapshot with its events, as a download. A POST form, so nothing is in a URL.
export async function POST(request: Request) {
  const hid = await householdRequest(request);
  if (hid instanceof Response) return hid;
  try {
    const busy = await limited(hid, "export", 6, "Export limit reached. Try again in a minute.");
    if (busy) return busy;
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
