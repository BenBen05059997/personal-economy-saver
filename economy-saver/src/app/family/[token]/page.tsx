import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { FamilyView } from "@/components/family/FamilyView";
import { LoadingState } from "@/components/ui/LoadingState";
import { db } from "@/db/client";
import { loadFamilyView, resolveFamilyLink } from "@/db/family-links";

// D52: a shared link opens without a session; the page is never indexed, cached or sent as a referrer.
export const metadata: Metadata = {
  title: "Family view · Personal Economy Saver",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

async function Family({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  await connection(); // whether a link is still live depends on the time of the request
  const hid = await resolveFamilyLink(db(), token);
  if (!hid) notFound();
  const { name, state } = await loadFamilyView(db(), hid);
  return <FamilyView name={name} state={state} />;
}

export default function Page({ params }: { params: Promise<{ token: string }> }) {
  return <Suspense fallback={<LoadingState label="Opening the family view…" />}><Family params={params} /></Suspense>;
}
