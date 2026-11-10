"use client";

import { useState, type ComponentProps } from "react";
import type { Check, CheckChoice } from "@/lib/money/checks";
import { dayLabel } from "@/lib/money/format";
import { CheckLines } from "./CheckLines";
import { answerCheck, type CheckAnswers } from "./check-answers";
import { ReadingForm } from "./ReadingForm";

type Props = Pick<ComponentProps<typeof ReadingForm>, "reading" | "today" | "homeCurrency" | "cards" | "own"> & { checks: Check[] };

function choiceHint({ step }: CheckChoice): string | null {
  if (step.do === "repeat") return step.repeat === null ? "Repeats is set to one time."
    : `Repeats is set to ${step.repeat === "month" ? "Every month" : "Every year"}.`;
  if (step.do === "date") return `The due date is set to ${dayLabel(step.date)}.`;
  if (step.do === "unknown") return step.fields.length === 2 ? "The amount and date are marked as not known."
    : `The ${step.fields[0]} is marked as not known.`;
  if (step.do === "edit") return `Change the ${step.field} below.`;
  return null;
}

export function ReviewReadingCard({ reading, checks, ...form }: Props) {
  const [answers, setAnswers] = useState<CheckAnswers>({ kinds: [] });
  const [hint, setHint] = useState<string | null>(null);
  const [focus, setFocus] = useState<"amount" | "date">();
  const remaining = checks.filter(check => !answers.kinds.includes(check.kind));
  return <details id={`reading-${reading.id}`} className="ui-panel reader-card" open>
    <summary>{reading.value.name || "Document"} · review {reading.value.kind}</summary>
    <ReadingForm {...form} reading={reading} preset={answers} focus={focus}
      hidden={answers.kinds.map(kind => <input key={kind} type="hidden" name="answered" value={kind} />)}
      checks={<>
        <CheckLines checks={remaining} onChoose={(check, choice) => {
          setAnswers(current => answerCheck(current, check.kind, choice));
          setFocus(choice.step.do === "edit" ? choice.step.field : undefined);
          setHint(choiceHint(choice));
        }} />
        {hint && <p className="ui-hint" role="status">{hint}</p>}
      </>} />
  </details>;
}
