import { LoadingState } from "@/components/ui/LoadingState";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { householdClock, householdDate } from "@/db/account";
import { db } from "@/db/client";
import { householdMoment } from "@/db/clock";
import { loadMoneyState, withHousehold, type Db } from "@/db/household";
import { households } from "@/db/schema";
import { listMemory } from "@/db/memory";
import { readPlaces } from "@/db/place";
import { rulesFor } from "@/db/rules";
import { listSpaces } from "@/db/spaces";
import { loadNavigationData } from "@/db/workspace";
import { DeviceMemoryView } from "@/components/memory/DeviceMemoryView";
import { GoalsView } from "@/components/memory/GoalsView";
import { MemoryTabs, type MemoryTab } from "@/components/memory/MemoryTabs";
import { MemoryView } from "@/components/memory/MemoryView";
import { RulesView } from "@/components/memory/RulesView";
import { SpacesView } from "@/components/memory/SpacesView";
import { WorkspaceFrame } from "@/components/shell/WorkspaceFrame";
import { Currency } from "@/lib/catalogue/types";
import { goalPaces } from "@/lib/money/goals";
import { currentHouseholdId } from "@/lib/session";

type Search = Promise<{ tab?: string | string[] }>;

async function tabContent(tx: Db, hid: string, tab: MemoryTab) {
  if (tab === "spaces") {
    const [spaces, places] = await Promise.all([listSpaces(tx, hid), readPlaces(tx, hid)]);
    const summaries = spaces.map(({ id, name, status, isGeneral, brief }) => ({
      id, name, status, isGeneral, about: places.journal === "cloud" && typeof brief.about === "string" ? brief.about : null,
    }));
    return <SpacesView spaces={summaries} householdId={hid} places={places} />;
  }
  if (tab === "goals") {
    const state = await loadMoneyState(tx, hid, await householdDate(tx, hid));
    return <GoalsView goals={goalPaces(state)} />;
  }
  if (tab === "rules") {
    const { currency } = await householdClock(tx, hid);
    const [rules, spaces] = await Promise.all([rulesFor(tx, hid), listSpaces(tx, hid)]);
    return <RulesView rules={rules} currency={Currency.parse(currency)} spaceNames={new Map(spaces.map(space => [space.id, space.name]))} />;
  }

  const [places, [household]] = await Promise.all([
    readPlaces(tx, hid),
    tx.select({ isDemo: households.isDemo, fixedToday: households.fixedToday, timeZone: households.timeZone }).from(households).where(eq(households.id, hid)),
  ]);
  // Memory kept on this device comes from the browser. Stamp its changes with the household's clock (D34, D59).
  if (places.memory === "device") {
    return <DeviceMemoryView householdId={hid} timeZone={household.timeZone} momentNow={householdMoment(household).toISOString()} />;
  }
  const items = await listMemory(tx, hid);
  return <MemoryView items={items.filter(item => !item.spaceId)} totalCount={items.length} timeZone={household.timeZone} />;
}

async function Memory({ search }: { search: Search }) {
  const [hid, { tab }] = await Promise.all([currentHouseholdId(), search]);
  if (!hid) redirect("/");
  const active = tab === "spaces" || tab === "goals" || tab === "rules" ? tab : "memory";
  const { workspace, content } = await withHousehold(db(), hid, async tx => {
    const workspace = await loadNavigationData(tx, hid);
    const content = await tabContent(tx, hid, active);
    return { workspace, content };
  }, active === "rules" ? { isolationLevel: "read committed" } : { isolationLevel: "repeatable read", accessMode: "read only" });
  return <WorkspaceFrame workspace={workspace} section="memory">
    <MemoryTabs active={active} />
    {content}
  </WorkspaceFrame>;
}

export default function Page({ searchParams }: { searchParams: Search }) {
  return <Suspense fallback={<LoadingState label="Opening what the assistant knows…" />}><Memory search={searchParams} /></Suspense>;
}
