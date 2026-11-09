import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { AskPage } from "@/components/ask/AskPage";
import { loadNavigation, WorkspaceFrame } from "@/components/shell/WorkspaceFrame";
import { LoadingState } from "@/components/ui/LoadingState";
import { askSpaceId, loadAskView } from "@/db/ask-view";
import { db } from "@/db/client";
import { currentHouseholdId } from "@/lib/session";

type Search = Promise<{ pin?: string | string[]; space?: string | string[]; thread?: string | string[] }>;

async function AskContent({ search }: { search: Search }) {
  const { pin: pinParam, space: spaceParam, thread: threadParam } = await search;
  const hid = await currentHouseholdId();
  if (!hid) redirect("/");
  const spaceId = askSpaceId.optional().safeParse(spaceParam);
  const legacyId = askSpaceId.optional().safeParse(threadParam);
  if (!spaceId.success || !legacyId.success) notFound();
  const pinId = typeof pinParam === "string" ? pinParam : undefined;
  const [workspace, view] = await Promise.all([
    loadNavigation(hid), loadAskView(db(), hid, { spaceId: spaceId.data, legacyId: legacyId.data, pinId }),
  ]);
  if (!view) notFound();
  return <WorkspaceFrame workspace={workspace} section="canvas">
    <AskPage key={`${view.space.id}:${view.legacyId ?? ""}:${view.pinId ?? ""}`} {...view} />
  </WorkspaceFrame>;
}

export default function Page({ searchParams }: { searchParams: Search }) {
  return <Suspense fallback={<LoadingState label="Opening Ask…" />}><AskContent search={searchParams} /></Suspense>;
}
