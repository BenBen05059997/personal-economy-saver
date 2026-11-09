import { Suspense, type ReactNode } from "react";
import { AskWorkspace } from "@/components/shell/AskWorkspace";
import { LoadingState } from "@/components/ui/LoadingState";
import { currentHouseholdId } from "@/lib/session";

async function HouseholdWorkspace({ children }: { children: ReactNode }) {
  const householdId = await currentHouseholdId();
  return householdId
    ? <AskWorkspace key={householdId} householdId={householdId}>{children}</AskWorkspace>
    : children;
}

export default function Layout({ children }: { children: ReactNode }) {
  return <Suspense fallback={<LoadingState label="Opening…" />}><HouseholdWorkspace>{children}</HouseholdWorkspace></Suspense>;
}
