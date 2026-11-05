import { LoadingState } from "@/components/ui/LoadingState";
import { Suspense } from "react";
import { ScrollToHash } from "@/components/ui/ScrollToHash";
import { redirect } from "next/navigation";
import { PlanView, type PlanAsk } from "@/components/plan/PlanView";
import { loadWorkspace, WorkspaceFrame } from "@/components/shell/WorkspaceFrame";
import { db } from "@/db/client";
import { loadSpending } from "@/db/spending";
import { HISTORY_MONTHS, monthBounds, monthsBack } from "@/lib/money/spending";
import { currentHouseholdId } from "@/lib/session";

type Search = Promise<{ q?: string | string[]; month?: string | string[] }>;

async function Plan({ search }: { search: Search }) {
  const { q, month } = await search;
  const hid = await currentHouseholdId();
  if (!hid) redirect("/");
  const workspace = await loadWorkspace(hid);
  const today = workspace.state.today;
  const current = today.slice(0, 7);
  const oldest = monthsBack(current, HISTORY_MONTHS);
  // One spending read for the page: the month view (any of the last 12 months, the current one to its last day) and the search.
  const spending = await loadSpending(db(), hid, { from: monthBounds(oldest).first, to: monthBounds(current).last });
  const ask: PlanAsk = { today, current, oldest, month: month ?? null, query: q ?? null };
  return <WorkspaceFrame workspace={workspace} section="plan">
    <PlanView state={workspace.state} spending={spending} ask={ask} newPotId={crypto.randomUUID()} />
  </WorkspaceFrame>;
}
export default function Page({ searchParams }: { searchParams: Search }) {
  return <Suspense fallback={<LoadingState label="Opening Plan…" />}><Plan search={searchParams} /><ScrollToHash /></Suspense>;
}
