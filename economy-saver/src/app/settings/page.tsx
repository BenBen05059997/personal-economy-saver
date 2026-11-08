import { LoadingState } from "@/components/ui/LoadingState";
import { Suspense } from "react";
import { ScrollToHash } from "@/components/ui/ScrollToHash";
import { redirect } from "next/navigation";
import { accountMembership } from "@/db/account";
import { db } from "@/db/client";
import { activeInvites } from "@/db/invites";
import { canImportPayPal } from "@/db/paypal-import";
import { loadSettings } from "@/db/settings";
import { reminderView } from "@/db/reminders";
import { verifiedIdentity } from "@/lib/auth-request";
import { listFamilyLinks } from "@/db/family-links";
import { listMcpTokens } from "@/db/mcp-tokens";
import { McpTokens } from "@/components/mcp/McpTokens";
import { ForwardingSettings } from "@/components/reader/ForwardingSettings";
import { SettingsView } from "@/components/settings/SettingsView";
import { WorkspaceFrame } from "@/components/shell/WorkspaceFrame";
import { loadNavigationData } from "@/db/workspace";
import { currentHouseholdId } from "@/lib/session";

async function Settings() {
  const [hid, identity] = await Promise.all([currentHouseholdId(), verifiedIdentity()]);
  if (!hid) redirect("/");
  const { workspace, data, tokens, canImport, familyLinks, reminders, access } = await db().transaction(async tx => {
    const [workspace, data, tokens, canImport, links, reminders, membership] = await Promise.all([
      loadNavigationData(tx, hid), loadSettings(tx, hid), listMcpTokens(tx, hid), canImportPayPal(tx, hid), listFamilyLinks(tx, hid),
      reminderView(tx, hid, identity), identity ? accountMembership(tx, identity.uid) : null,
    ]);
    const familyLinks = links.map(({ id, made, until }) => ({ id, made, until }));
    const expiry = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: workspace.timeZone });
    const active = identity && membership?.householdId === hid && membership.role === "owner"
      ? await activeInvites(tx, hid, identity.uid) : null;
    const access = active && {
      invites: active.map(({ id, name, email, expiresAt }) => ({ id, name, email, expiresAt: expiresAt.toISOString(), expiresLabel: expiry.format(expiresAt) })),
      tokens,
      invited: active.map(row => row.memberId),
    };
    return { workspace, data, tokens, canImport, familyLinks, reminders, access };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
  return <WorkspaceFrame workspace={workspace} section="settings"><div className="settings-page">
    <SettingsView data={data} canImportPayPal={canImport} reminders={reminders}
      familyLinks={familyLinks} canManage={data.household.demo || access !== null} access={access} /><ForwardingSettings householdId={hid} /><McpTokens tokens={tokens} />
  </div></WorkspaceFrame>;
}
export default function Page() {
  return <Suspense fallback={<LoadingState label="Opening Settings…" />}><Settings /><ScrollToHash /></Suspense>;
}
