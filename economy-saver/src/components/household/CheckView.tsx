import type { MoneyState } from "@/lib/money/types";
import { formatter } from "@/lib/money/format";
import { draftedLabel, toCheck } from "@/lib/money/to-check";
import { ReaderReview } from "@/components/reader/ReaderReview";
import type { ReaderInbox } from "@/db/reader-inbox";
import "@/components/reader/reader.css";
import { AddEntry, type EntryIds } from "./AddEntry";
import { PanelHint } from "@/components/ui/PanelHint";
import { ConfirmButton } from "./ConfirmButton";

export function CheckView({ state, inbox, people, entryIds, from }: {
  from?: "home";
  state: MoneyState; inbox: ReaderInbox; people: { id: string; name: string }[]; entryIds: EntryIds;
}) {
  const rows = toCheck(state);
  const format = formatter(state.homeCurrency);
  return <>
    <h1 className="ui-title">To check</h1>
    {rows.length + inbox.readings.length + inbox.jobs.length === 0 && <PanelHint href="/settings#forwarding" label="Forward a bill or upload a receipt">Things the app read or drafted, waiting for your OK. Nothing here now.</PanelHint>}
    {rows.map(row => <div key={row.id} className="ui-row">
      <div>{row.title}{draftedLabel(row.madeBy) && <span className="ui-hint drafted-by"> · {draftedLabel(row.madeBy)}</span>}<p className="ui-hint">{row.detail}</p></div>
      <div className="num">{row.amount !== null && format(row.amount)}</div>
      <ConfirmButton kind={row.kind} id={row.id} title={row.title} onCheckPage returnTo={from === "home" ? "/" : "/to-check"} />
    </div>)}
    <ReaderReview state={state} inbox={inbox} />
    <AddEntry key={entryIds.bill + entryIds.charge} ids={entryIds} returnTo="/to-check" today={state.today} currency={state.homeCurrency} people={people}
      cards={state.cards.map(card => ({ id: card.id, label: card.label }))} />
  </>;
}
