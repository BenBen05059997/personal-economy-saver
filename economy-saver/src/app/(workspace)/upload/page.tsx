import { LoadingState } from "@/components/ui/LoadingState";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { UploadView } from "@/components/reader/UploadView";
import { loadNavigation, WorkspaceFrame } from "@/components/shell/WorkspaceFrame";
import { currentHouseholdId } from "@/lib/session";

async function Upload() {
  const hid = await currentHouseholdId();
  if (!hid) redirect("/");
  const workspace = await loadNavigation(hid);
  return <WorkspaceFrame workspace={workspace} section="upload"><UploadView /></WorkspaceFrame>;
}
export default function Page() {
  return <Suspense fallback={<LoadingState label="Opening upload…" />}><Upload /></Suspense>;
}
