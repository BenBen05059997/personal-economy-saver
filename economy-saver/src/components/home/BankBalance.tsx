"use client";

import { useRef, type KeyboardEvent } from "react";
import { ApiForm } from "@/components/ui/ApiForm";
import { VoiceFill } from "@/components/voice/VoiceFill";
import { AmountInput } from "@/components/ui/CheckedInput";

/** D42: the bank balance in one line. Update reveals one field and puts the cursor in it; the id is minted per render so a double submit saves once, and the caller keys this by it so a saved balance leaves a closed, empty one. */
export function BankBalance({ currency, balance, balanceId }: { currency: string; balance: string; balanceId: string }) {
  const field = useRef<HTMLInputElement>(null);
  const panel = useRef<HTMLDetailsElement>(null);
  function escape(event: KeyboardEvent<HTMLDetailsElement>) {
    if (event.key !== "Escape" || !panel.current?.open) return;
    event.preventDefault();
    panel.current.open = false;
    panel.current.querySelector("summary")?.focus();
  }
  return <details ref={panel} className="home-balance" onKeyDown={escape} onToggle={event => { if (event.currentTarget.open) field.current?.focus(); }}>
    <summary><span>Bank balance <b>{balance}</b></span><span className="home-balance-edit">Update</span></summary>
    <ApiForm action="/api/bank-balance">
      <VoiceFill />
      <input type="hidden" name="id" value={balanceId} />
      <input type="hidden" name="returnTo" value="/" />
      <AmountInput ref={field} name="amount" aria-label={`New bank balance (${currency})`} placeholder="New balance" currency={currency} signed required />
      <button className="home-confirm">Save</button>
    </ApiForm>
  </details>;
}
