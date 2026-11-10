"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { ModelChoice } from "@/lib/ai/list-models";
import { keyOwner, providerFromKey, wrongProviderWords } from "@/lib/ai/providers";
import { OWN_KEY_HINT } from "@/lib/agent/availability";
import { ApiForm } from "@/components/ui/ApiForm";
import { modelsFor, scheduleModelChoices } from "./model-choices";

type ProviderChoice = { id: string; label: string; getKeyUrl: string | null };

function ModelField({ purpose, models, initial }: { purpose: "questions" | "documents"; models: ModelChoice[]; initial: string }) {
  const id = useId();
  return <label className="ui-field">Model for {purpose}
    <input name={purpose === "questions" ? "textModel" : "documentModel"} list={id} defaultValue={initial} spellCheck={false} maxLength={200} required />
    <datalist id={id}>{models.map(model => <option key={model.id} value={model.id} label={model.tested ? `${model.id} · Tested` : undefined} />)}</datalist>
  </label>;
}

/** The one form for the household's own model (D56). The pasted key stays in the password input. */
export function AiModelForm({ providers, initial, demo }: {
  providers: ProviderChoice[]; demo: boolean;
  initial: { provider: string; baseUrl: string; textModel: string; documentModel: string; same: boolean; hint: string | null };
}) {
  const [provider, setProvider] = useState(initial.provider);
  const [address, setAddress] = useState(initial.baseUrl);
  const [same, setSame] = useState(initial.same);
  const [typedKey, setTypedKey] = useState(false);
  const [typedOwner, setTypedOwner] = useState<string | undefined>(undefined);
  const [keyVersion, setKeyVersion] = useState(0);
  const [catalogue, setCatalogue] = useState<{ lookup: string; models: ModelChoice[]; problem: string } | null>(null);
  const key = useRef<HTMLInputElement>(null);
  const pickedProvider = useRef(false);
  const isDefault = provider === "";
  const selected = providers.find(choice => choice.id === provider);
  const baseUrl = provider === "custom" ? address.trim().replace(/\/+$/, "") : "";
  const savedKey = initial.hint && provider === initial.provider && baseUrl === initial.baseUrl;
  // A key made by another listed provider is never looked up with this one (the server refuses it too).
  const wrongOwner = typedKey && typedOwner && !isDefault && provider !== "custom" && typedOwner !== provider ? typedOwner : undefined;
  const canList = !isDefault && !wrongOwner && (typedKey || savedKey) && (provider !== "custom" || URL.canParse(baseUrl));
  const lookup = canList ? JSON.stringify([provider, baseUrl, keyVersion]) : "";
  const current = lookup && catalogue?.lookup === lookup ? catalogue : null;
  const models = current?.models ?? [];

  useEffect(() => {
    if (!lookup) return;
    return scheduleModelChoices(
      () => new URLSearchParams({ provider, baseUrl, key: key.current?.value.trim() ?? "" }),
      result => setCatalogue({ lookup, ...result }),
    );
  }, [baseUrl, lookup, provider]);

  function noteKey(value: string) {
    setTypedKey(Boolean(value.trim()));
    setTypedOwner(keyOwner(value.trim()));
    setKeyVersion(current => current + 1);
  }

  function clearKey() {
    if (!key.current?.value) return;
    key.current.value = "";
    noteKey("");
  }

  return <ApiForm action="/api/settings/ai-model" onDone={clearKey}>
    <input type="hidden" name="kind" value="save" />
    <label className="ui-field">Provider
      <select name="provider" value={provider} onChange={event => {
        const next = event.target.value;
        pickedProvider.current = true;
        if (!isDefault && provider !== next) clearKey();
        setProvider(next);
        setKeyVersion(current => current + 1);
      }}>
        <option value="" disabled={initial.provider !== ""}>This app’s default</option>
        {providers.map(p => <option key={p.id} value={p.id} disabled={demo && p.id === "custom"}>{p.label}</option>)}
      </select></label>
    {selected?.getKeyUrl && <>
      <p className="ui-hint"><a href={selected.getKeyUrl} target="_blank" rel="noreferrer">Get a key</a></p>
      <p className="ui-hint">Your use is billed to your own {selected.label} account. {OWN_KEY_HINT}</p>
    </>}
    {demo && <p className="ui-hint">A custom address needs an account. Sign in from Settings → Account.</p>}
    {provider === "custom" && <label className="ui-field">Address<input name="baseUrl" type="url" value={address} placeholder="https://models.example/v1" spellCheck={false}
      maxLength={300} required onChange={event => {
        const next = event.target.value;
        if (next.trim().replace(/\/+$/, "") !== baseUrl) {
          if (URL.canParse(baseUrl)) clearKey();
          setKeyVersion(current => current + 1);
        }
        setAddress(next);
      }} /></label>}
    <label className="ui-field">Key{provider === "custom" ? " (optional)" : ""}
      <input ref={key} name="key" type="password" autoComplete="off" data-1p-ignore="" data-lpignore="true" data-bwignore="" data-form-type="other"
        spellCheck={false} maxLength={500}
        required={!isDefault && provider !== "custom" && !savedKey} placeholder={savedKey ? `Saved: ${initial.hint}. Leave empty to keep it.` : ""}
        onChange={event => noteKey(event.target.value)}
        onPaste={event => {
          if (pickedProvider.current) return;
          const inferred = providerFromKey(event.clipboardData.getData("text"), provider);
          if (inferred) setProvider(inferred);
        }} />
    </label>
    {wrongOwner && <p className="ui-problem" role="alert">{wrongProviderWords(wrongOwner)}</p>}
    {!isDefault && <>
      {lookup && <p className="ui-hint" role="status">{current ? current.problem : "Loading models…"}</p>}
      <ModelField purpose="questions" models={modelsFor(models, "questions", same)} initial={initial.textModel} />
      <label className="settings-check"><input name="sameForDocuments" type="checkbox" checked={same} onChange={event => setSame(event.target.checked)} />Use the same model for documents</label>
      {!same && <ModelField purpose="documents" models={modelsFor(models, "documents", same)} initial={initial.documentModel} />}
      <p className="ui-hint">Must read images and PDFs.</p>
      <p className="ui-hint">Only the last four characters of a longer key are shown again.</p>
      <button className="ui-button primary">Save and check</button></>}
    {isDefault && <><button type="submit" hidden disabled /><p className="ui-hint">Paste a key or choose a provider to use your own model.</p></>}
  </ApiForm>;
}
