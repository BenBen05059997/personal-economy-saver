import { LoadingState } from "@/components/ui/LoadingState";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { db } from "@/db/client";
import { listMemory } from "@/db/memory";
import { loadNavigationData } from "@/db/workspace";
import { MemoryView } from "@/components/memory/MemoryView";
import { WorkspaceFrame } from "@/components/shell/WorkspaceFrame";
import { currentHouseholdId } from "@/lib/session";

async function Memory() {
  const hid = await currentHouseholdId();
  if (!hid) redirect("/");
  const [workspace, items] = await db().transaction(tx => Promise.all([loadNavigationData(tx, hid), listMemory(tx, hid)]),
    { isolationLevel: "repeatable read", accessMode: "read only" });
  return <WorkspaceFrame workspace={workspace} section="memory"><MemoryView items={items} /></WorkspaceFrame>;
}
export default function Page() {
  return <Suspense fallback={<LoadingState label="Opening what the assistant knows…" />}><Memory /></Suspense>;
}
