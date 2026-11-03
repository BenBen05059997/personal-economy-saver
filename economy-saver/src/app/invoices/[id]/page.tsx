import { LoadingState } from "@/components/ui/LoadingState";
import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { InvoiceReview } from "@/components/invoices/InvoiceReview";
import { loadWorkspace, WorkspaceFrame } from "@/components/shell/WorkspaceFrame";
import { invoiceReview } from "@/db/approval";
import { db } from "@/db/client";
import { currentHouseholdId } from "@/lib/session";

async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const hid = await currentHouseholdId();
  if (!hid) redirect("/");
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const [review, workspace] = await Promise.all([invoiceReview(db(), hid, id), loadWorkspace(hid)]);
  if (!review) notFound();
  return <WorkspaceFrame workspace={workspace} section="invoices"><InvoiceReview review={review} state={workspace.state} /></WorkspaceFrame>;
}

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return <Suspense fallback={<LoadingState label="Opening invoice…" />}><InvoicePage params={params} /></Suspense>;
}
