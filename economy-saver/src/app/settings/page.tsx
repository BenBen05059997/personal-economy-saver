import { Suspense } from "react";
import { redirect } from "next/navigation";
import { db } from "@/db/client";
import { loadSettings } from "@/db/settings";
import { listMcpTokens } from "@/db/mcp-tokens";
import { McpTokens } from "@/components/mcp/McpTokens";
import { ForwardingSettings } from "@/components/reader/ForwardingSettings";
import { SettingsView } from "@/components/settings/SettingsView";
import { loadWorkspace, WorkspaceFrame } from "@/components/shell/WorkspaceFrame";
import { currentHouseholdId } from "@/lib/session";

async function Settings() {
  const hid = await currentHouseholdId();
  if (!hid) redirect("/");
  const [workspace, data, tokens] = await Promise.all([loadWorkspace(hid), loadSettings(db(), hid), listMcpTokens(db(), hid)]);
  return <WorkspaceFrame workspace={workspace} section="settings"><div className="settings-page">
    <SettingsView data={data} /><ForwardingSettings householdId={hid} /><McpTokens tokens={tokens} />
  </div></WorkspaceFrame>;
}
export default function Page() {
  return <Suspense fallback={<main aria-busy="true">Opening Settings…</main>}><Settings /></Suspense>;
}
