import type { ReaderInbox } from "@/db/reader-inbox";
import type { MoneyState } from "@/lib/money/types";
import type { Extracted } from "@/lib/reader/extract";
import { CategoryFields } from "@/components/household/CategoryFields";

function majorText(entry: Extracted) {
  if (entry.amountMinor === null || !entry.currency) return "";
  if (entry.currency === "JPY") return String(entry.amountMinor);
  return Math.floor(entry.amountMinor / 100) + "." + String(entry.amountMinor % 100).padStart(2, "0");
}

export function ReaderReview({ inbox, state }: { inbox: ReaderInbox; state: MoneyState }) {
  return <section aria-label="Document readings">
    {inbox.jobs.map(job => <div key={job.id} className="ui-row">
      <div>{job.status === "failed" ? "Document needs attention" : "Reading document…"}{job.error && <p className="ui-hint">{job.error}</p>}</div>
      {job.retry && <form method="post" action="/api/readings/retry"><input type="hidden" name="id" value={job.id}/><button className="ui-button">Retry</button></form>}
    </div>)}
    {inbox.readings.map(({ id, value }) => <details id={`reading-${id}`} key={id} className="ui-panel reader-card" open>
      <summary>{value.name || "Document"} · review {value.kind}</summary>
      <form method="post" action="/api/confirm">
        <input type="hidden" name="kind" value="reading" /><input type="hidden" name="id" value={id} />
        <div className="reader-fields">
          <label className="ui-field">Entry<select name="target" defaultValue={value.kind}><option value="bill">Bill</option><option value="charge">Card charge</option></select></label>
          <label className="ui-field">Biller or merchant<input name="name" defaultValue={value.name ?? ""} required maxLength={160}/></label>
          <label className="ui-field">Amount<input name="amount" inputMode="decimal" defaultValue={majorText(value)} required/></label>
          <label className="ui-field">Currency<select name="currency" required defaultValue={value.currency ?? ""}><option value="">Choose currency</option><option>JPY</option><option>USD</option></select></label>
          <label className="ui-field">Due or charge date<input name="date" type="date" required defaultValue={value.date ?? ""}/></label>
          <CategoryFields name={value.name ?? ""} defaultCategory={value.category} defaultBp={value.businessBp ?? 0} />
          <label className="ui-field">Card for a charge<select name="cardId" defaultValue={value.cardId ?? ""}><option value="">Choose card</option>{state.cards.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>
        </div>
        <div className="reader-buttons"><button className="ui-button primary" name="decision" value="confirm">Confirm reading</button><button className="ui-button" name="decision" value="reject" formNoValidate>Dismiss</button></div>
      </form>
    </details>)}
  </section>;
}
