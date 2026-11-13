import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { LoadingState } from "@/components/ui/LoadingState";
import { LinkTabs } from "@/components/ui/LinkTabs";
import { ScrollToHash } from "@/components/ui/ScrollToHash";
import { OwnCategories } from "@/components/settings/OwnCategories";
import { OverTime } from "@/components/spending/OverTime";
import { ThisMonth } from "@/components/spending/ThisMonth";
import { chosenMonth, chosenQuery, type SpendingAsk } from "@/components/spending/SpendingView";
import { SpendingSearchForm } from "@/components/spending/SpendingSearch";
import { loadWorkspace, WorkspaceFrame } from "@/components/shell/WorkspaceFrame";
import { db } from "@/db/client";
import { withHousehold } from "@/db/household";
import { readPlaces } from "@/db/place";
import { listOwnCategoriesGrouped } from "@/db/own-categories";
import { loadSpending } from "@/db/spending";
import { HISTORY_MONTHS, monthBounds, monthsBack } from "@/lib/money/spending";
import { currentHouseholdId } from "@/lib/session";
import "@/components/spending/spending.css";

type Search = Promise<{ q?: string | string[]; month?: string | string[] }>;
type Params = Promise<{ tab?: string[] }>;

const TABS = [
  { id: "month", label: "This month", href: "/spending" },
  { id: "over-time", label: "Over time", href: "/spending/over-time" },
  { id: "categories", label: "Your categories", href: "/spending/categories" },
];

async function Spending({ params, search }: { params: Params; search: Search }) {
  const [{ tab }, { q, month }] = await Promise.all([params, search]);
  if (tab && (tab.length !== 1 || !TABS.some(item => item.id === tab[0] && item.id !== "month"))) notFound();
  const current = tab ? tab[0] : "month";
  const hid = await currentHouseholdId();
  if (!hid) redirect("/");
  const workspace = await loadWorkspace(hid, false, true);
  const today = workspace.state.today;
  const thisMonth = today.slice(0, 7);
  const oldest = monthsBack(thisMonth, HISTORY_MONTHS);
  // One read for the page: the twelve months the month view and the search reach, and the month before the oldest for its comparison.
  const [spending, ownGroups, places] = await withHousehold(db(), hid, tx => Promise.all([
    current === "categories" ? null : loadSpending(tx, hid, { from: monthBounds(monthsBack(oldest, 2)).first, to: monthBounds(thisMonth).last }),
    current === "categories" ? listOwnCategoriesGrouped(tx, hid) : null,
    readPlaces(tx, hid),
  ]), { isolationLevel: "repeatable read", accessMode: "read only" });
  const device = places.canvases === "device" ? { householdId: hid } : undefined;
  const ask: SpendingAsk = { today, current: thisMonth, oldest, month: month ?? null, query: q ?? null };
  const { query } = chosenQuery(ask), shown = chosenMonth(ask).month;
  const content = current === "categories" ? <OwnCategories groups={ownGroups!} />
    : current === "over-time" ? <OverTime state={workspace.state} spending={spending!} today={today} device={device} />
    : <ThisMonth state={workspace.state} spending={spending!} ask={ask} own={workspace.own} device={device} />;
  return <WorkspaceFrame workspace={workspace} section="spending">
    <article className="spending">
      <h1 className="ui-title">Spending</h1>
      <SpendingSearchForm query={query} month={shown === thisMonth ? null : shown} />
      <LinkTabs label="Spending" tabs={TABS} current={current}>{content}</LinkTabs>
    </article>
  </WorkspaceFrame>;
}

export default function Page({ params, searchParams }: { params: Params; searchParams: Search }) {
  return <Suspense fallback={<LoadingState label="Opening Spending…" />}><Spending params={params} search={searchParams} /><ScrollToHash /></Suspense>;
}
