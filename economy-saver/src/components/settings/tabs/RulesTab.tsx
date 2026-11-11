import type { reminderView } from "@/db/reminders";
import type { Currency } from "@/lib/catalogue/types";
import type { StandingRules } from "@/lib/money/suggestion-types";
import { RulesView } from "@/components/memory/RulesView";
import { Reminders } from "../Reminders";

/** Settings → Assistant rules: when the assistant suggests a nudge or flags an expense, and the reminders it sends. */
export function RulesTab({ rules, currency, spaceNames, reminders, timeZone }: {
  rules: StandingRules; currency: Currency; spaceNames: ReadonlyMap<string, string>; reminders: Awaited<ReturnType<typeof reminderView>>; timeZone: string;
}) {
  return <>
    <div id="nudge"><RulesView rules={rules} currency={currency} spaceNames={spaceNames} /></div>
    <Reminders view={reminders} timeZone={timeZone} />
  </>;
}
