"use client";

import { ApiForm } from "@/components/ui/ApiForm";
import { AmountInput } from "@/components/ui/CheckedInput";
import { VoiceFill } from "@/components/voice/VoiceFill";
import { stepPath } from "./steps";

/** The bank balance, posted to the same route as Home's Update. The id is minted per render, so a double submit saves once. */
export function SetupBank({ currency, balanceId }: { currency: string; balanceId: string }) {
  return <ApiForm action="/api/bank-balance" key={balanceId}>
    <VoiceFill />
    <input type="hidden" name="id" value={balanceId} />
    <input type="hidden" name="returnTo" value={stepPath("bank")} />
    <label className="ui-field">Bank balance ({currency})<AmountInput name="amount" currency={currency} signed required placeholder="e.g. 250000" /></label>
    <button className="ui-button primary">Save balance</button>
  </ApiForm>;
}
