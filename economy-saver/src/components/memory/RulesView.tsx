import "./memory.css";
import { ApiForm, ApiFormGroup } from "@/components/ui/ApiForm";
import { AmountInput } from "@/components/ui/CheckedInput";
import { fromMinor } from "@/db/money";
import type { Currency } from "@/lib/catalogue/types";
import { RULE_NAMES, ruleNumberLimit, ruleWords } from "@/lib/money/rules";
import { RULE_KINDS, type RuleKind, type StandingRule, type StandingRules } from "@/lib/money/suggestion-types";

function RuleThreshold({ kind, rule, currency }: { kind: RuleKind; rule: StandingRule; currency: Currency }) {
  if (kind === "safe_below") return <label className="ui-field">Minimum safe to spend ({currency})
    <AmountInput name="value" currency={currency} defaultValue={rule.threshold === null ? "" : fromMinor(rule.threshold, currency)} />
  </label>;

  const limit = ruleNumberLimit(kind);
  if (limit === null) return null;
  const label = kind === "cost_up" ? "Increase (%)" : "Days";
  const legacy = rule.threshold !== null && rule.threshold > limit;
  return <>
    <label className="ui-field">{label}
      <input name="value" type="number" min={1} max={limit} step={1} defaultValue={legacy ? "" : rule.threshold ?? ""} />
    </label>
    {legacy && <p className="ui-hint">The saved value is above the current limit. Enter a number from 1 to {limit} to change it, or switch the rule off.</p>}
  </>;
}

export function RulesView({ rules, currency, spaceNames }: { rules: StandingRules; currency: Currency; spaceNames: ReadonlyMap<string, string> }) {
  return <article className="memory-page">
    <header>
      <h2 className="ui-title">Assistant rules</h2>
      <p className="ui-hint">Rules make suggestions and reminders. fipa sends nothing to a client; the payment link behind Approve is the one PayPal action, and it needs your approval.</p>
    </header>
    <ApiFormGroup>
      {RULE_KINDS.map(kind => {
        const rule = rules[kind];
        const space = rule.spaceId ? spaceNames.get(rule.spaceId) : null;
        return <section key={kind} className="ui-panel memory-rule" aria-labelledby={"rule-" + kind}>
          <h2 id={"rule-" + kind}>{RULE_NAMES[kind]}</h2>
          <p className="ui-hint">{ruleWords(kind, rule)}</p>
          {space && <p className="ui-hint">Space: {space}</p>}
          <ApiForm action="/api/rules">
            <input type="hidden" name="kind" value="set" />
            <input type="hidden" name="ruleKind" value={kind} />
            <input type="hidden" name="returnTo" value="/settings" />
            <label className="rule-toggle">
              <input key={String(rule.enabled)} type="checkbox" name="enabled" value="on" defaultChecked={rule.enabled} />
              On
            </label>
            <RuleThreshold key={String(rule.threshold) + ":" + String(rule.currency)} kind={kind} rule={rule} currency={currency} />
            <button type="submit" className="ui-button">Save rule</button>
          </ApiForm>
        </section>;
      })}
    </ApiFormGroup>
  </article>;
}
