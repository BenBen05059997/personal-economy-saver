import { LoadingState } from "@/components/ui/LoadingState";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { accountHousehold } from "@/db/account";
import { db } from "@/db/client";
import { verifiedUid } from "@/lib/auth-request";
import { SetupForm } from "@/components/auth/SetupForm";
import { missingForwardingSetting } from "@/components/reader/ForwardingSettings";

async function Setup() {
  const uid = await verifiedUid();
  if (!uid) redirect("/login");
  if (await accountHousehold(db(), uid)) redirect("/");
  return <SetupForm forwarding={missingForwardingSetting() === null} action="/api/onboarding" title="Set up your household" button="Start planning"
    hint="Start with your name; the next pages ask about your money, and you can skip any. Your household starts fresh with the figures you enter here. Demo bills and payments stay out of your accounts." />;
}
export default function OnboardingPage() {
  return <Suspense fallback={<LoadingState label="Opening setup…" />}><Setup /></Suspense>;
}
