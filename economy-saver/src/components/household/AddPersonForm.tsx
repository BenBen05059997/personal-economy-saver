import { ApiForm } from "@/components/ui/ApiForm";
import { VoiceFill } from "@/components/voice/VoiceFill";
import "./add-entry.css";

/** Someone who shares costs (D45). Everyone's share becomes equal; the shares are changed on the People page. */
export function AddPersonForm({ returnTo }: { returnTo: string }) {
  return <ApiForm action="/api/people">
    <VoiceFill />
    <input type="hidden" name="kind" value="add" />
    <input type="hidden" name="returnTo" value={returnTo} />
    <label className="ui-field">Name<input name="name" maxLength={80} required /></label>
    <p className="ui-hint">Everyone’s share becomes equal; change the shares on the People page if you split unevenly.</p>
    <button className="ui-button primary">Add person</button>
  </ApiForm>;
}
