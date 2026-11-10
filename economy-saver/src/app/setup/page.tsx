import { redirect } from "next/navigation";
import { Suspense } from "react";
import { LoadingState } from "@/components/ui/LoadingState";
import { SetupSteps } from "@/components/setup/SetupSteps";
import { STEPS, type Step } from "@/components/setup/steps";
import { currentHouseholdId } from "@/lib/session";

type Search = Promise<{ step?: string | string[] }>;

async function Setup({ search }: { search: Search }) {
  const householdId = await currentHouseholdId();
  if (!householdId) redirect("/start");
  const { step } = await search;
  const chosen = STEPS.find(item => item === step) as Step | undefined;
  if (!chosen) redirect("/setup?step=bank");
  return <SetupSteps householdId={householdId} step={chosen} />;
}

export default function SetupPage({ searchParams }: { searchParams: Search }) {
  return <Suspense fallback={<LoadingState label="Opening setup…" />}><Setup search={searchParams} /></Suspense>;
}
