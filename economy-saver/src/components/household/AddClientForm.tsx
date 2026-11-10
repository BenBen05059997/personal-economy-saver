import { ApiForm } from "@/components/ui/ApiForm";
import { VoiceFill } from "@/components/voice/VoiceFill";
import { LABELS } from "./labels";
import "./add-entry.css";

/** `returnTo` (the setup steps) shows the form open, with no fold, and keeps the person on that page after a save. */
export function AddClientForm({ id, returnTo }: { id: string; returnTo?: string }) {
  const form = <ApiForm action="/api/clients">
      <VoiceFill />
      <input type="hidden" name="id" value={id} />
      {returnTo && <input type="hidden" name="returnTo" value={returnTo} />}
      <label className="ui-field">{LABELS.clientName}<input name="name" maxLength={120} required /></label>
      <label className="ui-field">{LABELS.email}<input name="email" type="email" data-voice="off" maxLength={254} required /></label>
      <label className="ui-field">{LABELS.daysToPay}<input name="termsDays" type="number" min={0} max={120} step={1} defaultValue={30} required /><small className="ui-hint">{LABELS.daysToPayHint}</small></label>
      <button className="ui-button primary">Add client</button>
    </ApiForm>;
  return returnTo ? form : <details className="add-entry" id="add-client">
    <summary>Add a client</summary>
    {form}
  </details>;
}
