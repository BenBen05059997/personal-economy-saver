import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { AddForm, ADD_TITLES, isAddKind } from "@/components/add/AddForm";
import "@/components/add/add.css";
import { loadAddView } from "@/db/add-view";
import { db } from "@/db/client";
import { loadNavigation, WorkspaceFrame } from "@/components/shell/WorkspaceFrame";
import { LoadingState } from "@/components/ui/LoadingState";
import { returnPath } from "@/lib/door";
import { currentHouseholdId } from "@/lib/session";

type Params = Promise<{ kind: string }>;
type Search = Promise<{ back?: string | string[] }>;

/** The Add page: the same form as the Add dialog, for a browser without JavaScript. A native post comes back to `back`. */
async function AddPage({ params, search }: { params: Params; search: Search }) {
  const [{ kind }, { back }] = await Promise.all([params, search]);
  if (!isAddKind(kind)) notFound();
  const hid = await currentHouseholdId();
  if (!hid) redirect("/");
  const returnTo = returnPath(typeof back === "string" ? back : null);
  const [workspace, view] = await Promise.all([loadNavigation(hid), loadAddView(db(), hid)]);
  if (!view) notFound();
  return <WorkspaceFrame workspace={workspace} section="add">
    <div className="add-page">
      <h1 className="ui-title">{ADD_TITLES[kind]}</h1>
      <AddForm kind={kind} id={crypto.randomUUID()} returnTo={returnTo} view={view} />
      <p className="add-page-cancel"><Link prefetch={false} href={returnTo}>Cancel</Link></p>
    </div>
  </WorkspaceFrame>;
}

export default function Page({ params, searchParams }: { params: Params; searchParams: Search }) {
  return <Suspense fallback={<LoadingState label="Opening…" />}><AddPage params={params} search={searchParams} /></Suspense>;
}
