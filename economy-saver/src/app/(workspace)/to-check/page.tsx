import { LoadingState } from "@/components/ui/LoadingState";
import { Suspense } from "react";
import { ScrollToHash } from "@/components/ui/ScrollToHash";
import { redirect } from "next/navigation";
import { CheckView } from "@/components/household/CheckView";
import { loadWorkspace, WorkspaceFrame } from "@/components/shell/WorkspaceFrame";
import { currentHouseholdId } from "@/lib/session";
import { db } from "@/db/client";
import { loadViewContext } from "@/lib/views/load";
import { resolveView } from "@/lib/views/resolve";
import { ViewError } from "@/lib/views/types";
import { dayLabel, formatter } from "@/lib/money/format";
import type { MoneyState } from "@/lib/money/types";

type Search = { from?: string | string[]; saved?: string | string[] };

/** D61: `?saved=bill:<id>` or `charge:<id>` is the Confirm just made. The line says what was saved and carries the what_changed view for it (the picture without it against now). */
async function savedLine(hid: string, state: MoneyState, saved: string | string[] | undefined) {
  const match = typeof saved === "string" ? /^(bill|charge):([0-9a-f-]{36})$/.exec(saved) : null;
  if (!match) return undefined;
  const [, kind, id] = match, format = formatter(state.homeCurrency);
  let what: string;
  if (kind === "bill") {
    const bill = state.bills.find(item => item.id.split("@")[0] === id);
    if (!bill || bill.status !== "confirmed") return undefined;
    what = `${bill.biller} ${format(bill.amount)}${bill.dueUnknown ? "" : `, due ${dayLabel(bill.due)}`}`;
  } else {
    const charge = state.charges.find(item => item.id === id);
    if (!charge || charge.status !== "confirmed") return undefined;
    what = `${charge.merchant} ${format(charge.amount)} to ${state.cards.find(card => card.id === charge.cardId)?.label ?? "your card"}`;
  }
  try {
    const result = resolveView("what_changed", { itemId: id }, await loadViewContext(db(), hid, ["spending"], { state }));
    return { what, result };
  } catch (error) {
    if (error instanceof ViewError) return { what, result: null };
    throw error;
  }
}

async function CheckList({ search }: { search: Promise<Search> }) {
  const { from, saved } = await search; // the Home summary links here with ?from=home so Confirm returns there
  const hid = await currentHouseholdId();
  if (!hid) redirect("/");
  const workspace = await loadWorkspace(hid, false, true);
  return <WorkspaceFrame workspace={workspace} section="check">
    <CheckView from={from === "home" ? "home" : undefined} saved={await savedLine(hid, workspace.state, saved)} state={workspace.state} inbox={workspace.inbox} own={workspace.own} />
  </WorkspaceFrame>;
}
export default function Page({ searchParams }: { searchParams: Promise<Search> }) {
  return <Suspense fallback={<LoadingState label="Opening To check…" />}><CheckList search={searchParams} /><ScrollToHash /></Suspense>;
}
