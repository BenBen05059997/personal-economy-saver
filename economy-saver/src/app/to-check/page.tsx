import { LoadingState } from "@/components/ui/LoadingState";
import { Suspense } from "react";
import { ScrollToHash } from "@/components/ui/ScrollToHash";
import { redirect } from "next/navigation";
import { CheckView } from "@/components/household/CheckView";
import { loadWorkspace, WorkspaceFrame } from "@/components/shell/WorkspaceFrame";
import { currentHouseholdId } from "@/lib/session";

async function CheckList({ search }: { search: Promise<{ from?: string | string[] }> }) {
  const { from } = await search; // the Home summary links here with ?from=home so Confirm returns there
  const hid = await currentHouseholdId();
  if (!hid) redirect("/");
  const workspace = await loadWorkspace(hid);
  return <WorkspaceFrame workspace={workspace} section="check">
    <CheckView from={from === "home" ? "home" : undefined} state={workspace.state} inbox={workspace.inbox} people={workspace.people} entryIds={{ bill: crypto.randomUUID(), charge: crypto.randomUUID() }} />
  </WorkspaceFrame>;
}
export default function Page({ searchParams }: { searchParams: Promise<{ from?: string | string[] }> }) {
  return <Suspense fallback={<LoadingState label="Opening To check…" />}><CheckList search={searchParams} /><ScrollToHash /></Suspense>;
}
