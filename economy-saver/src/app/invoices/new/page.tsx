import { Suspense } from "react";
import { DraftForm } from "@/components/invoices/DraftForm";
import { redirect } from "next/navigation";
import { loadWorkspace, WorkspaceFrame } from "@/components/shell/WorkspaceFrame";
import { currentHouseholdId } from "@/lib/session";

async function Draft() {
  const hid = await currentHouseholdId();
  if (!hid) redirect("/");
  const workspace = await loadWorkspace(hid);
  return <WorkspaceFrame workspace={workspace} section="invoices">
    <DraftForm clients={workspace.state.clients} id={crypto.randomUUID()} />
  </WorkspaceFrame>;
}

export default function Page() {
  return <Suspense fallback={<p aria-busy="true">Opening new invoice…</p>}><Draft /></Suspense>;
}
