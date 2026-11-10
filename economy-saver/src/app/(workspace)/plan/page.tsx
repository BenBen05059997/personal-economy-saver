import { LoadingState } from "@/components/ui/LoadingState";
import { Suspense } from "react";
import { ScrollToHash } from "@/components/ui/ScrollToHash";
import { redirect } from "next/navigation";
import { PlanView, type PlanAsk } from "@/components/plan/PlanView";
import { loadWorkspace, WorkspaceFrame } from "@/components/shell/WorkspaceFrame";
import { db } from "@/db/client";
import { withHousehold } from "@/db/household";
import { loadSpending } from "@/db/spending";
import { HISTORY_MONTHS, monthBounds, monthsBack } from "@/lib/money/spending";
import { currentHouseholdId } from "@/lib/session";

type Search = Promise<{ q?: string | string[]; month?: string | string[] }>;

async function Plan({ search }: { search: Search }) {
  const { q, month } = await search;
  const hid = await currentHouseholdId();
  if (!hid) redirect("/");
  const workspace = await loadWorkspace(hid, false, true);
  const today = workspace.state.today;
  const current = today.slice(0, 7);
  const oldest = monthsBack(current, HISTORY_MONTHS);
  // One spending read for the page: the month view (any of the last 12 months, the current one to its last day) and the search.
  const spending = await withHousehold(db(), hid, tx => loadSpending(tx, hid, { from: monthBounds(oldest).first, to: monthBounds(current).last }),
    { isolationLevel: "repeatable read", accessMode: "read only" });
  const ask: PlanAsk = { today, current, oldest, month: month ?? null, query: q ?? null };
  return <WorkspaceFrame workspace={workspace} section="plan">
    <PlanView state={workspace.state} spending={spending} ask={ask} own={workspace.own} newPotId={crypto.randomUUID()} />
  </WorkspaceFrame>;
}
export default function Page({ searchParams }: { searchParams: Search }) {
  return <Suspense fallback={<LoadingState label="Opening Plan…" />}><Plan search={searchParams} /><ScrollToHash /></Suspense>;
}
