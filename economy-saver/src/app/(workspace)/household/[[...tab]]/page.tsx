import { LoadingState } from "@/components/ui/LoadingState";
import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { db } from "@/db/client";
import { withHousehold } from "@/db/household";
import { activeInvites } from "@/db/invites";
import { listFamilyLinks } from "@/db/family-links";
import { listMcpTokens } from "@/db/mcp-tokens";
import { loadSettings } from "@/db/settings";
import { loadNavigationData } from "@/db/workspace";
import { verifiedIdentity } from "@/lib/auth-request";
import { currentHouseholdId } from "@/lib/session";
import { DetailsTab } from "@/components/household-page/DetailsTab";
import { PeopleTab } from "@/components/household-page/PeopleTab";
import { WorkspaceFrame } from "@/components/shell/WorkspaceFrame";
import { LinkTabs } from "@/components/ui/LinkTabs";
import { ScrollToHash } from "@/components/ui/ScrollToHash";
import "@/components/settings/settings.css";

const TABS = [
  { id: "details", label: "Details", href: "/household" },
  { id: "people", label: "People", href: "/household/people" },
];

async function Household({ params }: { params: Promise<{ tab?: string[] }> }) {
  const { tab } = await params;
  if (tab && (tab.length !== 1 || tab[0] !== "people")) notFound();
  const current = tab ? "people" : "details";
  const [hid, identity] = await Promise.all([currentHouseholdId(), verifiedIdentity()]);
  if (!hid) redirect("/");
  const { workspace, data, familyLinks, access, canManage } = await withHousehold(db(), hid, async tx => {
    const [workspace, data] = await Promise.all([loadNavigationData(tx, hid, identity), loadSettings(tx, hid)]);
    if (current === "details") return { workspace, data, familyLinks: [], access: null, canManage: false };
    const { isOwner, canManage } = workspace.role;
    const [tokens, links, active] = await Promise.all([
      canManage ? listMcpTokens(tx, hid) : [],
      canManage ? listFamilyLinks(tx, hid) : [],
      isOwner && identity ? activeInvites(tx, hid, identity.uid) : null,
    ]);
    const expiry = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: workspace.timeZone });
    const access = active && {
      invites: active.map(({ id, name, email, expiresAt }) => ({ id, name, email, expiresAt: expiresAt.toISOString(), expiresLabel: expiry.format(expiresAt) })),
      tokens,
      invited: active.map(row => row.memberId),
    };
    return { workspace, data, familyLinks: links.map(({ id, made, until }) => ({ id, made, until })), access, canManage };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
  return <WorkspaceFrame workspace={workspace} section="household"><div className="settings-page">
    <header><p className="ui-hint">YOUR HOUSEHOLD</p><h1 className="ui-title">Household</h1><p className="ui-hint">Who is in it and how it is set up.</p></header>
    <LinkTabs label="Household" tabs={TABS} current={current}>
      <div className="settings-tab">
        {current === "details" ? <DetailsTab household={data.household} /> : <PeopleTab data={data} familyLinks={familyLinks} canManage={canManage} access={access} />}
      </div>
    </LinkTabs>
  </div></WorkspaceFrame>;
}

export default function Page({ params }: { params: Promise<{ tab?: string[] }> }) {
  return <Suspense fallback={<LoadingState label="Opening Household…" />}><Household params={params} /><ScrollToHash /></Suspense>;
}
