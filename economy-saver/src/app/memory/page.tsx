import { LoadingState } from "@/components/ui/LoadingState";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { householdMoment } from "@/db/clock";
import { households } from "@/db/schema";
import { listMemory } from "@/db/memory";
import { readPlaces } from "@/db/place";
import { loadNavigationData } from "@/db/workspace";
import { DeviceMemoryView } from "@/components/memory/DeviceMemoryView";
import { MemoryView } from "@/components/memory/MemoryView";
import { WorkspaceFrame } from "@/components/shell/WorkspaceFrame";
import { currentHouseholdId } from "@/lib/session";

async function Memory() {
  const hid = await currentHouseholdId();
  if (!hid) redirect("/");
  // A kind is read from one place only (D59): on the device, the cloud list is not read at all.
  const [workspace, place, items, momentNow] = await db().transaction(async tx => {
    const [workspace, places] = await Promise.all([loadNavigationData(tx, hid), readPlaces(tx, hid)]);
    const [household] = await tx.select({ isDemo: households.isDemo, fixedToday: households.fixedToday, timeZone: households.timeZone }).from(households).where(eq(households.id, hid));
    // The household's clock at this moment (the real one, or a Try it household's fixed date): a write on the device is dated with it (D34).
    return [workspace, places.memory, places.memory === "cloud" ? await listMemory(tx, hid) : [], householdMoment(household).toISOString()] as const;
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
  return <WorkspaceFrame workspace={workspace} section="memory">
    {place === "device" ? <DeviceMemoryView householdId={hid} timeZone={workspace.timeZone} momentNow={momentNow} /> : <MemoryView items={items} timeZone={workspace.timeZone} />}
  </WorkspaceFrame>;
}
export default function Page() {
  return <Suspense fallback={<LoadingState label="Opening what the assistant knows…" />}><Memory /></Suspense>;
}
