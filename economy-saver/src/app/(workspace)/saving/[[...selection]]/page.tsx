import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { SavingView } from "@/components/saving/SavingView";
import { loadWorkspace, WorkspaceFrame } from "@/components/shell/WorkspaceFrame";
import { LoadingState } from "@/components/ui/LoadingState";
import { currentHouseholdId } from "@/lib/session";

type Params = Promise<{ selection?: string[] }>;

async function Saving({ params }: { params: Params }) {
  const hid = await currentHouseholdId();
  if (!hid) redirect("/");
  const { selection } = await params;
  if (selection && selection.length !== 1) notFound();
  const workspace = await loadWorkspace(hid);
  return <WorkspaceFrame workspace={workspace} section="saving"><SavingView state={workspace.state} selected={selection?.[0]} /></WorkspaceFrame>;
}

export default function Page({ params }: { params: Params }) {
  return <Suspense fallback={<LoadingState label="Opening Saving…" />}><Saving params={params} /></Suspense>;
}
