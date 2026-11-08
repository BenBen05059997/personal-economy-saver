import type { Repeat } from "@/components/household/ScheduleFields";
import type { CheckChoice, CheckKind } from "@/lib/money/checks";

export type CheckAnswers = { kinds: CheckKind[]; repeat?: Repeat; date?: string; amountUnknown?: boolean; dueUnknown?: boolean };

export function answerCheck(current: CheckAnswers, kind: CheckKind, { step }: CheckChoice): CheckAnswers {
  const kinds = current.kinds.includes(kind) ? current.kinds : [...current.kinds, kind];
  if (step.do === "repeat") return { ...current, kinds, repeat: step.repeat ?? "" };
  if (step.do === "date") return { ...current, kinds, date: step.date };
  if (step.do === "unknown") return {
    ...current, kinds,
    amountUnknown: current.amountUnknown || step.fields.includes("amount"),
    dueUnknown: current.dueUnknown || step.fields.includes("date"),
  };
  return { ...current, kinds };
}
