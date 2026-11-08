import { LoadingState } from "@/components/ui/LoadingState";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { householdClock, householdDate } from "@/db/account";
import { db } from "@/db/client";
import { householdMoment } from "@/db/clock";
import { loadMoneyState, type Db } from "@/db/household";
import { households } from "@/db/schema";
import { listMemory } from "@/db/memory";
import { readPlaces } from "@/db/place";
import { rulesFor } from "@/db/rules";
import { loadNavigationData } from "@/db/workspace";
import { DeviceMemoryView } from "@/components/memory/DeviceMemoryView";
import { GoalsView } from "@/components/memory/GoalsView";
import { MemoryTabs, type MemoryTab } from "@/components/memory/MemoryTabs";
import { MemoryView } from "@/components/memory/MemoryView";
import { RulesView } from "@/components/memory/RulesView";
import { WorkspaceFrame } from "@/components/shell/WorkspaceFrame";
import { Currency } from "@/lib/catalogue/types";
import { goalPaces } from "@/lib/money/goals";
import { currentHouseholdId } from "@/lib/session";

type Search = Promise<{ tab?: string | string[] }>;

async function tabContent(tx: Db, hid: string, tab: MemoryTab) {
  if (tab === "goals") {
    const state = await loadMoneyState(tx, hid, await householdDate(tx, hid));
    return <GoalsView goals={goalPaces(state)} />;
  }
  if (tab === "rules") {
    const [rules, { currency }] = await Promise.all([rulesFor(tx, hid), householdClock(tx, hid)]);
    return <RulesView rules={rules} currency={Currency.parse(currency)} />;
  }

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
    active === "rules" ? { isolationLevel: "read committed" } : { isolationLevel: "repeatable read", accessMode: "read only" });
  return <WorkspaceFrame workspace={workspace} section="memory">
    <MemoryTabs active={active} />
    {content}
  </WorkspaceFrame>;
}

export default function Page({ searchParams }: { searchParams: Search }) {
  return <Suspense fallback={<LoadingState label="Opening what the assistant knows…" />}><Memory search={searchParams} /></Suspense>;
}
