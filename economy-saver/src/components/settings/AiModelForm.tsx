"use client";

import { useRef, useState } from "react";
import { ApiForm } from "@/components/ui/ApiForm";

export type ProviderChoice = { id: string; label: string };

/** The one form for the household's own model (D56): a listed provider or its own address, the models and a key. */
export function AiModelForm({ providers, tested, initial, demo }: {
  providers: ProviderChoice[]; tested: { provider: string; model: string }[]; demo: boolean;
  initial: { provider: string; baseUrl: string; textModel: string; documentModel: string; same: boolean; hint: string | null };
}) {
  const [provider, setProvider] = useState(initial.provider);
  const [same, setSame] = useState(initial.same);
  const key = useRef<HTMLInputElement>(null);
  const suggestions = tested.filter(t => t.provider === provider);
  const isDefault = provider === "";
  return <ApiForm action="/api/settings/ai-model" onDone={() => { if (key.current) key.current.value = ""; }}>
    <input type="hidden" name="kind" value="save" />
    <label className="ui-field">Provider
      <select name="provider" value={provider} onChange={event => setProvider(event.target.value)}>
        <option value="" disabled={initial.provider !== ""}>This app’s default</option>
        {providers.map(p => <option key={p.id} value={p.id} disabled={demo && p.id === "custom"}>{p.label}</option>)}
      </select></label>
    {demo && <p className="ui-hint">A custom address needs an account. Sign in from Settings → Account.</p>}
    {provider === "custom" && <label className="ui-field">Address<input name="baseUrl" type="url" defaultValue={initial.baseUrl} placeholder="https://models.example/v1" spellCheck={false} maxLength={300} required /></label>}
    {!isDefault && <>
      <label className="ui-field">Model for questions<input name="textModel" list="ai-text-models" defaultValue={initial.textModel} spellCheck={false} maxLength={200} required />
        <datalist id="ai-text-models">{suggestions.map(t => <option key={t.model} value={t.model} />)}</datalist></label>
      <label className="ui-field"><span><input name="sameForDocuments" type="checkbox" checked={same} onChange={event => setSame(event.target.checked)} /> Use the same model for documents</span></label>
      {!same && <label className="ui-field">Model for documents<input name="documentModel" defaultValue={initial.documentModel} spellCheck={false} maxLength={200} required /></label>}
      <label className="ui-field">Key{provider === "custom" ? " (optional)" : ""}
        <input ref={key} name="key" type="password" autoComplete="new-password" spellCheck={false} maxLength={500} required={provider !== "custom" && !initial.hint} placeholder={initial.hint ? `Saved: ${initial.hint}. Leave empty to keep it.` : ""} /></label>
      <p className="ui-hint">Only the last four characters are shown again.</p>
      <button className="ui-button primary" disabled={false}>Save and check</button></>}
    {isDefault && <p className="ui-hint">Choose a provider to use your own model.</p>}
  </ApiForm>;
}
