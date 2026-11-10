import type { MoneyState } from "@/lib/money/types";
import { formatter } from "@/lib/money/format";
import { confirmedGaps, gapMeanwhileWords, gapQuestion, gapUrgencyWords } from "@/lib/money/gaps";
import { checksFor, pendingProposals, readingProposal } from "@/lib/money/checks";
import { draftedLabel, toCheck } from "@/lib/money/to-check";
import { ReaderReview } from "@/components/reader/ReaderReview";
import type { ReaderInbox } from "@/db/reader-inbox";
import "@/components/reader/reader.css";
import "./household.css";
import { AddEntry, type EntryIds } from "./AddEntry";
import type { OwnChoices } from "@/lib/reader/own-choices";
import { missingForwardingSetting } from "@/components/reader/ForwardingSettings";
import { PanelHint } from "@/components/ui/PanelHint";
import { ConfirmButton } from "./ConfirmButton";
import { GapFill } from "./GapFill";

export function CheckView({ state, inbox, people, entryIds, own, from }: {
  from?: "home";
  state: MoneyState; inbox: ReaderInbox; people: { id: string; name: string }[]; entryIds: EntryIds; own: OwnChoices;
}) {
  const forwarding = missingForwardingSetting() === null;
  const rows = toCheck(state);
  const missing = confirmedGaps(state);
  const format = formatter(state.homeCurrency);
  const proposals = new Map(pendingProposals(state).map(proposal => [proposal.id, proposal]));
  const readings = inbox.readings.map(readingProposal);
  const checkWords = (id: string) => { const proposal = proposals.get(id); return proposal ? checksFor(proposal, state, readings).filter(check => check.kind !== "missing").map(check => check.words) : []; };
  return <>
    <h1 className="ui-title">To check</h1>
    {rows.length + missing.length + inbox.readings.length + inbox.jobs.length === 0 && <PanelHint href={forwarding ? "/settings#forwarding" : "/upload"} label={forwarding ? "Forward a bill or upload a receipt" : "Upload a receipt"}>Things the app read or drafted, waiting for your OK. Nothing here now.</PanelHint>}
    {missing.length > 0 && <section aria-labelledby="check-missing" className="check-missing">
      <h2 id="check-missing" className="check-missing-title">Missing</h2>
      {missing.map(gap => <div key={gap.id} className="check-gap">
        <p className="check-gap-question">{gapQuestion(gap)}{gapUrgencyWords(gap) && <span className="check-gap-urgent">{gapUrgencyWords(gap)}</span>}</p>
        <p className="ui-hint">{gapMeanwhileWords(gap)}</p>
        <GapFill id={gap.id} missing={gap.missing} today={state.today} currency={state.homeCurrency} />
      </div>)}
    </section>}
    {rows.map(row => <div key={row.id} id={"check-" + row.id} className="ui-row check-row">
      <div>{row.title}{draftedLabel(row.madeBy) && <span className="ui-hint drafted-by"> · {draftedLabel(row.madeBy)}</span>}<p className="ui-hint">{row.detail}</p>
        {checkWords(row.id).map(words => <p key={words} className="ui-hint check-line">{words}</p>)}
        {row.kind === "bill" && row.gap && <GapFill id={row.id} missing={[...(row.gap.amount ? ["amount" as const] : []), ...(row.gap.date ? ["date" as const] : [])]} today={state.today} currency={state.homeCurrency} />}</div>
      <div className={row.amount !== null ? "num check-amount" : "num"}>{row.amount !== null ? format(row.amount) : row.kind === "bill" && row.gap && [row.gap.amount, row.gap.date].filter(Boolean).join(" · ")}</div>
      <ConfirmButton kind={row.kind} id={row.id} title={row.title} onCheckPage returnTo={from === "home" ? "/" : "/to-check"} />
    </div>)}
    {inbox.jobs.some(job => job.status !== "failed") && <p className="ui-hint">Reading the document… usually under 30 seconds</p>}
    <ReaderReview state={state} inbox={inbox} own={own} />
    <AddEntry key={entryIds.bill + entryIds.charge} ids={entryIds} returnTo="/to-check" today={state.today} currency={state.homeCurrency} people={people} own={own}
      cards={state.cards.map(card => ({ id: card.id, label: card.label }))} />
  </>;
}
