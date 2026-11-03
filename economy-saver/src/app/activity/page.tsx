import { LoadingState } from "@/components/ui/LoadingState";
import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { db } from "@/db/client";
import { listEvents } from "@/db/household";
import { publicEvent } from "@/db/event-feed";
import { ActivityView } from "@/components/household/ActivityView";
import { loadNavigation, WorkspaceFrame } from "@/components/shell/WorkspaceFrame";
import { currentHouseholdId } from "@/lib/session";

type Props = { searchParams: Promise<{ page?: string | string[] }> };
const pageSize = 50;

async function Activity({ searchParams }: Props) {
  const hid = await currentHouseholdId();
  if (!hid) redirect("/");
  const { page = "1" } = await searchParams;
  if (typeof page !== "string" || !/^[1-9]\d{0,5}$/.test(page)) notFound();
  const index = Number(page);
  const [workspace, rows] = await Promise.all([
    loadNavigation(hid), listEvents(db(), hid, undefined, pageSize + 1, (index - 1) * pageSize),
  ]);
  if (index > 1 && rows.length === 0) notFound();
  return <WorkspaceFrame workspace={workspace} section="activity">
    <ActivityView rows={rows.slice(0, pageSize).map(publicEvent)} index={index} hasOlder={rows.length > pageSize} timeZone={workspace.timeZone} />
  </WorkspaceFrame>;
}
export default function Page(props: Props) {
  return <Suspense fallback={<LoadingState label="Opening Activity…" />}><Activity {...props} /></Suspense>;
}
