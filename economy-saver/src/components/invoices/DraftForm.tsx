import type { Client } from "@/lib/money/types";
import { ApiForm } from "@/components/ui/ApiForm";
import { LABELS } from "@/components/household/labels";
import { MoreFields } from "@/components/household/MoreFields";
import { VoiceFill } from "@/components/voice/VoiceFill";
import { AmountField } from "@/components/household/AmountField";

export function DraftForm({ clients, id, clientId }: { clients: Client[]; id: string; clientId?: string }) {
  return <>
    <h1 className="ui-title">New invoice</h1>
    {clients.length ? <ApiForm className="ui-panel" action="/api/invoices/draft">
      <VoiceFill />
      <input name="id" type="hidden" value={id} />
      <label className="ui-field">{LABELS.client}<select name="clientId" required defaultValue={clients.find(client => client.id === clientId)?.id}>{clients.map(client =>
        <option key={client.id} value={client.id}>{client.name}</option>)}</select></label>
      <label className="ui-field">{LABELS.whatFor}<input name="item" maxLength={200} required /></label>
      <label className="ui-field">{LABELS.amount}<AmountField name="amount" currency="USD" required /><small className="ui-hint">Invoices are always in US dollars. Home shows what they are worth in your own currency.</small></label>
      <button className="ui-button primary">Review draft</button>
      <MoreFields><label className="ui-field">{LABELS.note}<textarea name="note" maxLength={3900} /></label></MoreFields>
    </ApiForm> : <p>Add a client before creating an invoice.</p>}
  </>;
}
