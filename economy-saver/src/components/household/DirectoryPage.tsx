import { LoadingState } from "@/components/ui/LoadingState";
import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { loadWorkspace, WorkspaceFrame } from "@/components/shell/WorkspaceFrame";
import { currentHouseholdId } from "@/lib/session";
import { Directory } from "./Directory";

type Props = { section: "cards" | "clients"; params: Promise<{ selection?: string[] }> };

async function DirectoryContent({ section, params }: Props) {
  const hid = await currentHouseholdId();
  if (!hid) redirect("/");
  const { selection } = await params;
  if (selection && selection.length !== 1) notFound();
  const workspace = await loadWorkspace(hid);
  return <WorkspaceFrame workspace={workspace} section={section}><Directory state={workspace.state} section={section} selected={selection?.[0]} newClientId={crypto.randomUUID()} /></WorkspaceFrame>;
}

export function DirectoryPage(props: Props) {
  return <Suspense fallback={<LoadingState label={"Opening " + props.section + "…"} />}><DirectoryContent {...props} /></Suspense>;
}
