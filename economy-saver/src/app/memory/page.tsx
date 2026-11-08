import { LoadingState } from "@/components/ui/LoadingState";
import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { householdDate } from "@/db/account";
import { db } from "@/db/client";
import { householdMoment } from "@/db/clock";
import { loadMoneyState, type Db } from "@/db/household";
import { households } from "@/db/schema";
import { listMemory } from "@/db/memory";
import { readPlaces } from "@/db/place";
import { loadNavigationData } from "@/db/workspace";
import { DeviceMemoryView } from "@/components/memory/DeviceMemoryView";
import { GoalsView } from "@/components/memory/GoalsView";
import { MemoryTabs, type MemoryTab } from "@/components/memory/MemoryTabs";
import { MemoryView } from "@/components/memory/MemoryView";
import { WorkspaceFrame } from "@/components/shell/WorkspaceFrame";
import { goalPaces } from "@/lib/money/goals";
import { currentHouseholdId } from "@/lib/session";

type Search = Promise<{ tab?: string | string[] }>;

async function tabContent(tx: Db, hid: string, tab: MemoryTab) {
  if (tab === "goals") {
    const state = await loadMoneyState(tx, hid, await householdDate(tx, hid));
    return <GoalsView goals={goalPaces(state)} />;
  }
  if (tab === "rules") return <article className="memory-page">
    <h1 className="ui-title">Rules</h1>
    <section className="ui-panel">
      <p>The late-client nudge rule is in Settings.</p>
      <Link className="ui-button" href="/settings#nudge" prefetch={false}>Open nudge setting</Link>
    </section>
  </article>;

  const [places, [household]] = await Promise.all([
    readPlaces(tx, hid),
    tx.select({ isDemo: households.isDemo, fixedToday: households.fixedToday, timeZone: households.timeZone }).from(households).where(eq(households.id, hid)),
  ]);
  // Memory kept on this device comes from the browser. Stamp its changes with the household's clock (D34, D59).
  if (places.memory === "device") {
    return <DeviceMemoryView householdId={hid} timeZone={household.timeZone} momentNow={householdMoment(household).toISOString()} />;
  }
  return <MemoryView items={await listMemory(tx, hid)} timeZone={household.timeZone} />;
}

async function Memory({ search }: { search: Search }) {
  const [hid, { tab }] = await Promise.all([currentHouseholdId(), search]);
  if (!hid) redirect("/");
  const active = tab === "goals" || tab === "rules" ? tab : "memory";
  const [workspace, content] = await db().transaction(tx => Promise.all([loadNavigationData(tx, hid), tabContent(tx, hid, active)]),
    { isolationLevel: "repeatable read", accessMode: "read only" });
  return <WorkspaceFrame workspace={workspace} section="memory">
    <MemoryTabs active={active} />
    {content}
  </WorkspaceFrame>;
}

export default function Page({ searchParams }: { searchParams: Search }) {
  return <Suspense fallback={<LoadingState label="Opening what the assistant knows…" />}><Memory search={searchParams} /></Suspense>;
}
