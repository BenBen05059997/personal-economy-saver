import { LoadingState } from "@/components/ui/LoadingState";
import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { householdClock } from "@/db/account";
import { db } from "@/db/client";
import { withHousehold } from "@/db/household";
import { paypalConnectionView } from "@/db/paypal-connection";
import { listMcpTokens } from "@/db/mcp-tokens";
import { reminderView } from "@/db/reminders";
import { rulesFor } from "@/db/rules";
import { listSpaces } from "@/db/spaces";
import { loadNavigationData } from "@/db/workspace";
import { verifiedIdentity } from "@/lib/auth-request";
import { Currency } from "@/lib/catalogue/types";
import { currentHouseholdId } from "@/lib/session";
import { AccountTab } from "@/components/settings/AccountTab";
import { MovedAnchors } from "@/components/settings/MovedAnchors";
import { AiModelTab } from "@/components/settings/tabs/AiModelTab";
import { DataTab } from "@/components/settings/tabs/DataTab";
import { PayPalTab } from "@/components/settings/tabs/PayPalTab";
import { RulesTab } from "@/components/settings/tabs/RulesTab";
import { WorkspaceFrame } from "@/components/shell/WorkspaceFrame";
import { LinkTabs } from "@/components/ui/LinkTabs";
import { ScrollToHash } from "@/components/ui/ScrollToHash";
import "@/components/settings/settings.css";

const TABS = [
  { id: "rules", slug: "", label: "Assistant rules", href: "/settings" },
  { id: "ai-model", slug: "ai-model", label: "Your AI model", href: "/settings/ai-model" },
  { id: "paypal", slug: "paypal", label: "PayPal", href: "/settings/paypal" },
  { id: "data", slug: "data", label: "Your data", href: "/settings/data" },
  { id: "account", slug: "account", label: "Account", href: "/settings/account" },
] as const;

type Params = Promise<{ tab?: string[] }>;

async function Settings({ params }: { params: Params }) {
  const { tab } = await params;
  if (tab && tab.length !== 1) notFound();
  const current = TABS.find(item => item.slug === (tab?.[0] ?? ""));
  if (!current) notFound();
  const [hid, identity] = await Promise.all([currentHouseholdId(), verifiedIdentity()]);
  if (!hid) redirect("/");
  // The rules read seeds the defaults the first time, so only that tab reads in a writable transaction.
  const options = current.id === "rules" ? { isolationLevel: "read committed" as const } : { isolationLevel: "repeatable read" as const, accessMode: "read only" as const };
  const { workspace, content } = await withHousehold(db(), hid, async tx => {
    const [workspace, clock] = await Promise.all([loadNavigationData(tx, hid, identity), householdClock(tx, hid)]);
    const { membership, canManage, isOwner } = workspace.role;
    if (current.id === "rules") {
      const [rules, spaces, reminders] = await Promise.all([rulesFor(tx, hid), listSpaces(tx, hid), reminderView(tx, hid, identity)]);
      return { workspace, content: <RulesTab rules={rules} currency={Currency.parse(clock.currency)} spaceNames={new Map(spaces.map(space => [space.id, space.name]))} reminders={reminders} timeZone={clock.timeZone} /> };
    }
    if (current.id === "ai-model") return { workspace, content: <AiModelTab canManage={canManage} demo={clock.isDemo} tokens={canManage ? await listMcpTokens(tx, hid) : []} /> };
    if (current.id === "paypal") return { workspace, content: <PayPalTab connection={await paypalConnectionView(tx, hid)} isOwner={isOwner} /> };
    if (current.id === "data") return { workspace, content: <DataTab canManage={canManage} /> };
    return { workspace, content: <AccountTab role={membership?.role ?? null} /> };
  }, options);
  return <WorkspaceFrame workspace={workspace} section="settings"><div className="settings-page">
    <header><h1 className="ui-title">Settings</h1><p className="ui-hint">How the assistant works for you, and your account.</p></header>
    <LinkTabs label="Settings" tabs={TABS.map(({ id, label, href }) => ({ id, label, href }))} current={current.id}>
      <div className="settings-tab">{content}</div>
    </LinkTabs>
  </div></WorkspaceFrame>;
}

export default function Page({ params }: { params: Params }) {
  return <Suspense fallback={<LoadingState label="Opening Settings…" />}><Settings params={params} /><MovedAnchors /><ScrollToHash /></Suspense>;
}
