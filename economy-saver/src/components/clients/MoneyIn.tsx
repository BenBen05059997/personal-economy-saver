import { StackedColumns } from "@/components/views/forms/StackedColumns";
import { Strip } from "@/components/views/forms/Strip";
import { ViewPanel } from "@/components/views/ViewPanel";
import { db } from "@/db/client";
import { withHousehold } from "@/db/household";
import { readPlaces } from "@/db/place";
import { currentHouseholdId } from "@/lib/session";
import type { MoneyState } from "@/lib/money/types";
import { loadViewContext } from "@/lib/views/load";
import type { ViewResult } from "@/lib/views/types";
import { clientPaceView, incomeMonthsView } from "@/lib/views/v/income";

/** Clients → Money in (D77): one panel above the list, two questions: what came in by month, and how fast each client pays. Reads the last twelve months of paid invoices. */
export async function MoneyIn({ state }: { state: MoneyState }) {
  const hid = await currentHouseholdId();
  if (!hid) throw new Error("Money in needs a household");
  const [ctx, places] = await withHousehold(db(), hid, tx => Promise.all([loadViewContext(tx, hid, ["income"], { state }), readPlaces(tx, hid)]), { isolationLevel: "repeatable read", accessMode: "read only" });
  const months = incomeMonthsView({}, ctx) as ViewResult<"stacked_columns">, pace = clientPaceView({}, ctx) as ViewResult<"strip">;
  return <ViewPanel id="money_in" device={places.canvases === "device" ? { householdId: hid } : undefined}
    questions={[{ key: "months", label: "By month", result: months, heading: "Money in", figure: <StackedColumns result={months} /> }, { key: "pace", label: "How fast they pay", result: pace, heading: "Money in", figure: <Strip result={pace} /> }]} />;
}
