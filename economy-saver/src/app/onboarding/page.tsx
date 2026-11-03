import { LoadingState } from "@/components/ui/LoadingState";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { accountHousehold } from "@/db/account";
import { db } from "@/db/client";
import { verifiedUid } from "@/lib/auth-request";
import { SetupForm } from "@/components/auth/SetupForm";

async function Setup() {
  const uid = await verifiedUid();
  if (!uid) redirect("/login");
  if (await accountHousehold(db(), uid)) redirect("/");
  return <SetupForm />;
}
export default function OnboardingPage() {
  return <Suspense fallback={<LoadingState label="Opening setup…" />}><Setup /></Suspense>;
}
