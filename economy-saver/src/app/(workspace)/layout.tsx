import { Suspense, type ReactNode } from "react";
import { AddHost } from "@/components/add/AddHost";
import { AskWorkspace } from "@/components/shell/AskWorkspace";
import { LoadingState } from "@/components/ui/LoadingState";
import { currentHouseholdId } from "@/lib/session";

async function HouseholdWorkspace({ children }: { children: ReactNode }) {
  const householdId = await currentHouseholdId();
  return householdId
    ? <AskWorkspace key={householdId} householdId={householdId}><AddHost>{children}</AddHost></AskWorkspace>
    : children;
}

export default function Layout({ children }: { children: ReactNode }) {
  return <Suspense fallback={<LoadingState label="Opening…" />}><HouseholdWorkspace>{children}</HouseholdWorkspace></Suspense>;
}
