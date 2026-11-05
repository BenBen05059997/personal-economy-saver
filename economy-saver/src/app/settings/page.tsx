import { LoadingState } from "@/components/ui/LoadingState";
import { Suspense } from "react";
import { ScrollToHash } from "@/components/ui/ScrollToHash";
import { redirect } from "next/navigation";
import { db } from "@/db/client";
import { canImportPayPal } from "@/db/paypal-import";
import { loadSettings } from "@/db/settings";
import { listFamilyLinks } from "@/db/family-links";
import { listMcpTokens } from "@/db/mcp-tokens";
import { McpTokens } from "@/components/mcp/McpTokens";
import { ForwardingSettings } from "@/components/reader/ForwardingSettings";
import { SettingsView } from "@/components/settings/SettingsView";
import { WorkspaceFrame } from "@/components/shell/WorkspaceFrame";
import { loadNavigationData } from "@/db/workspace";
import { currentHouseholdId } from "@/lib/session";

async function Settings() {
  const hid = await currentHouseholdId();
  if (!hid) redirect("/");
  const [workspace, data, tokens, canImport, links] = await db().transaction(tx => Promise.all([
    loadNavigationData(tx, hid), loadSettings(tx, hid), listMcpTokens(tx, hid), canImportPayPal(tx, hid), listFamilyLinks(tx, hid),
  ]), { isolationLevel: "repeatable read", accessMode: "read only" });
  return <WorkspaceFrame workspace={workspace} section="settings"><div className="settings-page">
    <SettingsView data={data} canImportPayPal={canImport}
      familyLinks={links.map(({ id, made, until }) => ({ id, made, until }))} /><ForwardingSettings householdId={hid} /><McpTokens tokens={tokens} />
  </div></WorkspaceFrame>;
}
export default function Page() {
  return <Suspense fallback={<LoadingState label="Opening Settings…" />}><Settings /><ScrollToHash /></Suspense>;
}
