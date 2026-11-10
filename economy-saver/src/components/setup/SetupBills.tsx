"use client";

import { useState } from "react";
import { BillForm } from "@/components/household/AddEntry";
import type { OwnChoices } from "@/lib/reader/own-choices";
import { BILL_CHIPS, stepPath } from "./steps";

/** A row of chips; tapping one opens the Add a bill form with that name and category, repeating every month. The form is keyed by its minted id, so a saved bill leaves a fresh one. */
export function SetupBills({ id, today, currency, people, own }: { id: string; today: string; currency: string; people: { id: string; name: string }[]; own: OwnChoices }) {
  const [chip, setChip] = useState<number | null>(null);
  const chosen = chip === null ? null : BILL_CHIPS[chip];
  return <>
    <div className="setup-chips" role="group" aria-label="Pick a bill to add">
      {BILL_CHIPS.map((item, index) => <button key={item.label} type="button" className="setup-chip" aria-pressed={chip === index} onClick={() => setChip(index)}>{item.label}</button>)}
    </div>
    {chosen && <BillForm key={`${id}-${chip}`} id={id} returnTo={stepPath("bills")} today={today} currency={currency} people={people} own={own} preset={chosen.preset} />}
  </>;
}
