import { ApiForm } from "@/components/ui/ApiForm";
import { VoiceFill } from "@/components/voice/VoiceFill";
import { LABELS } from "./labels";
import "./add-entry.css";

export function AddClientForm({ id }: { id: string }) {
  return <details className="add-entry" id="add-client">
    <summary>Add a client</summary>
    <ApiForm action="/api/clients">
      <VoiceFill />
      <input type="hidden" name="id" value={id} />
      <label className="ui-field">{LABELS.clientName}<input name="name" maxLength={120} required /></label>
      <label className="ui-field">{LABELS.email}<input name="email" type="email" data-voice="off" maxLength={254} required /></label>
      <label className="ui-field">{LABELS.daysToPay}<input name="termsDays" type="number" min={0} max={120} step={1} defaultValue={30} required /><small className="ui-hint">{LABELS.daysToPayHint}</small></label>
      <button className="ui-button primary">Add client</button>
    </ApiForm>
  </details>;
}
