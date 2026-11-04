import { LoadingState } from "@/components/ui/LoadingState";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { SetupForm } from "@/components/auth/SetupForm";
import { verifiedUid } from "@/lib/auth-request";
import { currentHouseholdId } from "@/lib/session";
import { db } from "@/db/client";
import { tryItKind } from "@/db/demo";

async function Start() {
  if (await verifiedUid()) redirect("/account");
  const demo = await currentHouseholdId(); // not signed in, so a household here is a Try it or blank demo
  const kind = demo ? await tryItKind(db(), demo) : null;
  const notice = kind === "try-it" ? "This replaces the Try it household in this browser. Reset in Settings brings Ben's numbers back."
    : kind === "blank" ? "This replaces your household in this browser and its numbers." : undefined;
  return <SetupForm notice={notice} action="/api/try/blank" privacy title="Start with my numbers" button="Open my household"
    hint="A name and today's bank balance are all it needs. No bills, clients or payments are added for you, and nothing here is real money. You can sign in with email later to keep it." />;
}
export default function StartPage() {
  return <Suspense fallback={<LoadingState label="Opening setup…" />}><Start /></Suspense>;
}
