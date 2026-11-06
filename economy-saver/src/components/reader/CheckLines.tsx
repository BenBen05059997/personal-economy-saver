"use client";

import { useState } from "react";
import type { Check, CheckChoice } from "@/lib/money/checks";

// D61: the checks that failed on a reading, one line each, above the fields. A "don't add it" choice is the card's own Dismiss
// (a submit button); "as read" hides the line; the other choices only point at the field on the card that makes the change.
// Nothing here confirms or refuses: To check does not enforce answers.

function hint(choice: CheckChoice): string | null {
  const step = choice.step;
  if (step.do === "edit") return step.field === "amount" ? "Change the amount below" : "Change the date below";
  if (step.do === "unknown") return step.fields.length === 2 ? "Tick Not known yet under the amount and the date" : step.fields[0] === "amount" ? "Tick Not known yet under the amount" : "Tick Not known yet under the date";
  if (step.do === "repeat") return step.repeat === null ? "Leave Repeats as it is" : `Choose ${step.repeat === "month" ? "Every month" : "Every year"} under Repeats`;
  if (step.do === "date") return `Change the date below to ${step.date}`;
  return null;
}

export function CheckLines({ checks }: { checks: Check[] }) {
  const [hidden, setHidden] = useState<Record<string, true>>({});
  const [hinted, setHinted] = useState<Record<string, string>>({});
  const shown = checks.filter(check => !hidden[check.kind]);
  if (shown.length === 0) return null;
  return <div className="check-lines">{shown.map(check => <div key={check.kind} className="check-line" role="group" aria-label={check.words}>
    <p className="check-line-words">{check.words}</p>
    <div className="check-line-choices">
      {check.choices.map(choice => choice.step.do === "dismiss"
        ? <button key={choice.label} type="submit" className="ui-button" name="decision" value="reject" formNoValidate>{choice.label}</button>
        : <button key={choice.label} type="button" className="ui-button" onClick={() => {
          if (choice.step.do === "keep") setHidden(current => ({ ...current, [check.kind]: true }));
          else setHinted(current => ({ ...current, [check.kind]: hint(choice) ?? "" }));
        }}>{choice.label}</button>)}
    </div>
    {hinted[check.kind] && <p className="ui-hint" role="status">{hinted[check.kind]}</p>}
  </div>)}</div>;
}
