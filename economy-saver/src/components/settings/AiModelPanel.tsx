import { db } from "@/db/client";
import { connectionView } from "@/db/ai-key";
import { askUnavailable, missingAskSetting, serverDefaultHost } from "@/lib/agent/availability";
import { CHECK_NAMES, type ConnectionCheck } from "@/lib/ai/check";
import { PROVIDERS } from "@/lib/ai/providers";
import { TESTED } from "@/lib/ai/tested";
import { ApiForm } from "@/components/ui/ApiForm";
import { currentHouseholdId } from "@/lib/session";
import { AiModelForm } from "./AiModelForm";

const CHECK_WORDS: Record<(typeof CHECK_NAMES)[number], string> = {
  uses_tools: "Uses the app’s tools", ignores_injection: "Ignores instructions hidden in bills", stays_on_money: "Stays on money questions",
};
const dateOf = (iso: string) => new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(iso));

function CheckLine({ tested, check }: { tested: boolean; check: ConnectionCheck | null }) {
  if (tested) return <p className="ui-hint">Tested</p>;
  if (!check) return <p className="ui-hint">Custom, untested</p>;
  return <><p className="ui-hint">Custom, untested · passed {check.passed.length} of {CHECK_NAMES.length} checks on {dateOf(check.at)}</p>
    {check.failed.length > 0 && <ul className="ui-hint">{check.failed.map(f => <li key={f.name}>{CHECK_WORDS[f.name]}: {f.why}</li>)}</ul>}</>;
}

/** Settings → "Your AI model" (D56). A server component: it reads the saved model itself and never receives a key. */
export async function AiModelPanel({ demo }: { demo: boolean }) {
  const hid = await currentHouseholdId();
  const view = hid ? await connectionView(db(), hid) : null;
  const missing = missingAskSetting(Boolean(view?.textModel));
  const host = view ? view.host : serverDefaultHost();
  return <section className="ui-panel" id="ai-model"><h2>Your AI model</h2>
    {missing ? <p className="ui-hint">{askUnavailable(missing)}</p> : host ? <p className="ui-hint">Your questions and documents go to {host}.</p> : null}
    {view ? <CheckLine tested={view.tested} check={view.check} /> : <p className="ui-hint">Using the app’s default model.</p>}
    <AiModelForm key={view ? `${view.provider}|${view.baseUrl}|${view.textModel}|${view.documentModel}|${view.hint}` : "default"} demo={demo}
      providers={PROVIDERS.map(p => ({ id: p.id, label: p.label }))} tested={TESTED.map(t => ({ provider: t.provider, model: t.model }))}
      initial={{ provider: view?.provider ?? "", baseUrl: view?.provider === "custom" ? view.baseUrl : "", textModel: view?.textModel ?? "",
        documentModel: view?.documentModel ?? "", same: view ? view.sameForDocuments : true, hint: view?.hint ?? null }} />
    {view && <ApiForm action="/api/settings/ai-model"><input type="hidden" name="kind" value="default" /><button className="ui-button">Use this app’s default</button></ApiForm>}
    <details className="settings-dev"><summary>For developers</summary>
      <p className="ui-hint">A saved key is encrypted in Supabase Vault and only its last four characters are shown. Without your own model, the server’s AI_PROTOCOL, AI_API_KEY and AI_TEXT_MODEL settings apply.</p></details>
  </section>;
}
