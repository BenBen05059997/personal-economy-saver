import { LoadingState } from "@/components/ui/LoadingState";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { SetupForm } from "@/components/auth/SetupForm";
import { verifiedUid } from "@/lib/auth-request";
import { currentHouseholdId } from "@/lib/session";

async function Start() {
  if (await verifiedUid()) redirect("/account");
  const demo = await currentHouseholdId(); // not signed in, so a household here is a Try it or blank demo
  return <SetupForm notice={demo ? "This replaces the Try it household in this browser. Reset in Settings brings Ben's numbers back." : undefined} action="/api/try/blank" privacy title="Start with my numbers" button="Open my household"
    hint="Your bank balance and one card are all it needs. No bills, clients or payments are added for you, and nothing here is real money. You can sign in with email later to keep it." />;
}
export default function StartPage() {
  return <Suspense fallback={<LoadingState label="Opening setup…" />}><Start /></Suspense>;
}
