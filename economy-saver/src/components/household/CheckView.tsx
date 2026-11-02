import type { MoneyState } from "@/lib/money/types";
import { formatter } from "@/lib/money/format";
import { toCheck } from "@/lib/money/to-check";
import { ReaderReview } from "@/components/reader/ReaderReview";
import type { ReaderInbox } from "@/db/reader-inbox";
import "@/components/reader/reader.css";
import { ConfirmButton } from "./ConfirmButton";

export function CheckView({ state, inbox }: { state: MoneyState; inbox: ReaderInbox }) {
  const rows = toCheck(state);
  const format = formatter(state.homeCurrency);
  return <>
    <h1 className="ui-title">To check</h1>
    {rows.length + inbox.readings.length + inbox.jobs.length === 0 && <p>Nothing to check.</p>}
    {rows.map(row => <div key={row.id} className="ui-row">
      <div>{row.title}<p className="ui-hint">{row.detail}</p></div>
      <div className="num">{format(row.amount)}</div>
      <ConfirmButton kind={row.kind} id={row.id} title={row.title} onCheckPage />
    </div>)}
    <ReaderReview state={state} inbox={inbox} />
  </>;
}
