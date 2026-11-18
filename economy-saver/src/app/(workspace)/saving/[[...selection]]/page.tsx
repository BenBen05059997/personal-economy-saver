import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { SavingView } from "@/components/saving/SavingView";
import { loadWorkspace, WorkspaceFrame } from "@/components/shell/WorkspaceFrame";
import { LoadingState } from "@/components/ui/LoadingState";
import { currentHouseholdId } from "@/lib/session";

type Params = Promise<{ selection?: string[] }>;
type Search = Promise<{ win?: string | string[]; paid?: string | string[] }>;
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

async function Saving({ params, searchParams }: { params: Params; searchParams: Search }) {
  const hid = await currentHouseholdId();
  if (!hid) redirect("/");
  const { selection } = await params;
  const { win, paid } = await searchParams;
  if (selection && selection.length !== 1) notFound();
  const workspace = await loadWorkspace(hid);
  return <WorkspaceFrame workspace={workspace} section="saving"><SavingView state={workspace.state} selected={selection?.[0]} win={first(win)} paid={first(paid)} /></WorkspaceFrame>;
}

export default function Page({ params, searchParams }: { params: Params; searchParams: Search }) {
  return <Suspense fallback={<LoadingState label="Opening Saving…" />}><Saving params={params} searchParams={searchParams} /></Suspense>;
}
