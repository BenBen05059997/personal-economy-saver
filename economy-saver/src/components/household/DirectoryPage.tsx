import { ScrollToHash } from "@/components/ui/ScrollToHash";
import { LoadingState } from "@/components/ui/LoadingState";
import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { db } from "@/db/client";
import { withHousehold } from "@/db/household";
import { loadSettings } from "@/db/settings";
import { loadWorkspaceData } from "@/db/workspace";
import { WorkspaceFrame } from "@/components/shell/WorkspaceFrame";
import { BillsView } from "@/components/bills/BillsView";
import { ForwardingSettings } from "@/components/reader/ForwardingSettings";
import { currentHouseholdId } from "@/lib/session";
import { Directory } from "./Directory";

type Props = { section: "bills" | "cards" | "clients"; params: Promise<{ selection?: string[] }> };

async function DirectoryContent({ section, params }: Props) {
  const hid = await currentHouseholdId();
  if (!hid) redirect("/");
  const { selection } = await params;
  if (selection && selection.length !== 1) notFound();
  const selected = selection?.[0];
  // Bills and cards also need the settings read and the own categories, in the same read as the money state.
  const { workspace, settings } = await withHousehold(db(), hid, async tx => {
    const withSettings = section !== "clients";
    const [workspace, settings] = await Promise.all([loadWorkspaceData(tx, hid, false, null, withSettings), withSettings ? loadSettings(tx, hid) : null]);
    return { workspace, settings };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
  if (section === "clients") return <WorkspaceFrame workspace={workspace} section="clients"><Directory state={workspace.state} section="clients" selected={selected} /></WorkspaceFrame>;
  if (!settings || !workspace.own) throw new Error("Bills and cards load the settings and the own categories");
  const data = { settings, own: workspace.own };
  return <WorkspaceFrame workspace={workspace} section={section}>
    {section === "cards" ? <Directory state={workspace.state} section="cards" selected={selected} cardsData={data} />
      : <BillsView data={data.settings} own={data.own} selected={selected} forwarding={<ForwardingSettings householdId={hid} />} />}
  </WorkspaceFrame>;
}

export function DirectoryPage(props: Props) {
  return <Suspense fallback={<LoadingState label={"Opening " + props.section + "…"} />}><DirectoryContent {...props} /><ScrollToHash /></Suspense>;
}
