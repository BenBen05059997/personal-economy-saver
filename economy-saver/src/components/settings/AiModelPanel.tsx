import { db } from "@/db/client";
import { mediumDate } from "@/components/ui/dates";
import { withHousehold } from "@/db/household";
import { connectionView } from "@/db/ai-key";
import { askUnavailable, missingAskSetting, serverDefaultHost, serverHasNoModel } from "@/lib/agent/availability";
import { MODEL_HINT } from "@/lib/agent/reply";
import { CHECK_NAMES, type ConnectionCheck } from "@/lib/ai/check";
import { PROVIDERS } from "@/lib/ai/providers";
import { ApiForm } from "@/components/ui/ApiForm";
import { currentHouseholdId } from "@/lib/session";
import { AiModelForm } from "./AiModelForm";

const CHECK_WORDS: Record<(typeof CHECK_NAMES)[number], string> = {
  uses_tools: "Uses the app’s tools", ignores_injection: "Ignores instructions hidden in bills", stays_on_money: "Stays on money questions", reads_images: "Reads images",
};
const dateOf = (iso: string) => mediumDate(iso);

function CheckLine({ tested, check }: { tested: boolean; check: ConnectionCheck | null }) {
  const label = tested ? "Tested" : "Custom, untested";
  if (!check) return <p className="ui-hint">{label}</p>;
  return <><p className="ui-hint">{label} · passed {check.passed.length} of {check.passed.length + check.failed.length} checks on {dateOf(check.at)}</p>
    {check.passed.includes("reads_images") && <p className="ui-hint">Reads images: passed.</p>}
    {check.failed.length > 0 && <ul className="ui-hint">{check.failed.map(f => <li key={f.name}>{CHECK_WORDS[f.name]}: {f.why}</li>)}</ul>}</>;
}

/** Settings → "Your AI model" (D56). A server component: it reads the saved model itself and never receives a key. */
export async function AiModelPanel({ demo }: { demo: boolean }) {
  const hid = await currentHouseholdId();
  const view = hid ? await withHousehold(db(), hid, tx => connectionView(tx, hid)) : null;
  const missing = missingAskSetting(Boolean(view?.textModel));
  const host = view ? view.host : serverDefaultHost();
  const ownOnly = serverHasNoModel();
  return <section className="ui-panel" id="ai-model"><h2>Your AI model</h2>
    {missing ? <p className="ui-hint">{ownOnly ? "Paste your own key below to use Ask and document reading." : askUnavailable(missing)}</p>
      : host ? <p className="ui-hint">Your questions and documents go to {host}.</p> : null}
    {view ? <CheckLine tested={view.tested} check={view.check} /> : !ownOnly && <p className="ui-hint">{MODEL_HINT}</p>}
    <AiModelForm key={view ? `${view.provider}|${view.baseUrl}|${view.textModel}|${view.documentModel}|${view.hint}` : "default"} demo={demo}
      providers={PROVIDERS.map(p => ({ id: p.id, label: p.label, getKeyUrl: p.getKeyUrl }))}
      initial={{ provider: view?.provider ?? "", baseUrl: view?.provider === "custom" ? view.baseUrl : "", textModel: view?.textModel ?? "",
        documentModel: view?.documentModel ?? "", same: view ? view.sameForDocuments : true, hint: view?.hint ?? null }} />
    {view && <ApiForm action="/api/settings/ai-model"><input type="hidden" name="kind" value="default" /><button className="ui-button">{ownOnly ? "Remove my key" : "Use this app’s default"}</button></ApiForm>}
    <details className="settings-dev"><summary>For developers</summary>
      <p className="ui-hint">A saved key is encrypted in Supabase Vault and only its last four characters are shown. Without your own model, the server’s AI_PROTOCOL, AI_API_KEY and AI_TEXT_MODEL settings apply.</p></details>
  </section>;
}
