import { LoadingState } from "@/components/ui/LoadingState";
import { Suspense } from "react";
import { DraftForm } from "@/components/invoices/DraftForm";
import { redirect } from "next/navigation";
import { loadWorkspace, WorkspaceFrame } from "@/components/shell/WorkspaceFrame";
import { currentHouseholdId } from "@/lib/session";

async function Draft({ search }: { search: Promise<{ client?: string | string[] }> }) {
  const { client } = await search; // "New invoice for this client" on a client's page links here with ?client=<id>
  const hid = await currentHouseholdId();
  if (!hid) redirect("/");
  const workspace = await loadWorkspace(hid);
  return <WorkspaceFrame workspace={workspace} section="invoices">
    <DraftForm clients={workspace.state.clients} id={crypto.randomUUID()} clientId={typeof client === "string" ? client : undefined} />
  </WorkspaceFrame>;
}

export default function Page({ searchParams }: { searchParams: Promise<{ client?: string | string[] }> }) {
  return <Suspense fallback={<LoadingState label="Opening new invoice…" />}><Draft search={searchParams} /></Suspense>;
}
