import type { ReaderInbox } from "@/db/reader-inbox";
import type { MoneyState } from "@/lib/money/types";
import { checksFor, readingProposal } from "@/lib/money/checks";
import { ApiForm } from "@/components/ui/ApiForm";
import { ReviewReadingCard } from "./ReviewReadingCard";
import type { OwnChoices } from "@/lib/reader/own-choices";

export function ReaderReview({ inbox, state, own }: { inbox: ReaderInbox; state: MoneyState; own: OwnChoices }) {
  const proposals = inbox.readings.map(readingProposal);
  const cards = state.cards.map(c => ({ id: c.id, label: c.label }));
  return <section aria-label="Document readings">
    {inbox.jobs.map(job => <div key={job.id} className="ui-row">
      <div>{job.status === "failed" ? "Document needs attention" : "Reading document…"}{job.error && <p className="ui-hint">{job.error}</p>}</div>
      {job.retry && <ApiForm action="/api/readings/retry"><input type="hidden" name="id" value={job.id}/><button className="ui-button">Retry</button></ApiForm>}
    </div>)}
    {inbox.readings.map(({ id, value, link }, index) => <ReviewReadingCard key={id}
      reading={{ id, value, link }} today={state.today} homeCurrency={state.homeCurrency} cards={cards} own={own}
      checks={checksFor(proposals[index], state, proposals)} />)}
  </section>;
}
