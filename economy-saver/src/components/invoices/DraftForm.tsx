import type { Client } from "@/lib/money/types";
import { ApiForm } from "@/components/ui/ApiForm";
import { AmountInput } from "@/components/ui/CheckedInput";

export function DraftForm({ clients, id, clientId }: { clients: Client[]; id: string; clientId?: string }) {
  return <>
    <h1 className="ui-title">New invoice</h1>
    {clients.length ? <ApiForm className="ui-panel" action="/api/invoices/draft">
      <input name="id" type="hidden" value={id} />
      <label className="ui-field">To<select name="clientId" required defaultValue={clients.find(client => client.id === clientId)?.id}>{clients.map(client =>
        <option key={client.id} value={client.id}>{client.name}</option>)}</select></label>
      <label className="ui-field">For<input name="item" maxLength={200} required /></label>
      <label className="ui-field">Amount (USD)<AmountInput name="amount" currency="USD" required /><small className="ui-hint">Invoices are always in US dollars. Home shows what they are worth in your own currency.</small></label>
      <label className="ui-field">Note<textarea name="note" maxLength={3900} /></label>
      <button className="ui-button primary">Review draft</button>
    </ApiForm> : <p>Add a client before creating an invoice.</p>}
  </>;
}
