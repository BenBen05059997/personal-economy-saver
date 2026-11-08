"use client";

import type { Check, CheckChoice } from "@/lib/money/checks";

// The discard choice submits the existing Dismiss action. Other choices update this reading's form for review.
export function CheckLines({ checks, onChoose }: { checks: Check[]; onChoose: (check: Check, choice: CheckChoice) => void }) {
  if (checks.length === 0) return null;
  return <div className="check-lines">{checks.map(check => <div key={check.kind} className="check-line" role="group" aria-label={check.words}>
    <p className="check-line-words">{check.words}</p>
    <div className="check-line-choices">
      {check.choices.map(choice => choice.step.do === "dismiss"
        ? <button key={choice.label} type="submit" className="ui-button" name="decision" value="reject" formNoValidate>{choice.label}</button>
        : <button key={choice.label} type="button" className="ui-button" onClick={() => onChoose(check, choice)}>{choice.label}</button>)}
    </div>
  </div>)}</div>;
}
