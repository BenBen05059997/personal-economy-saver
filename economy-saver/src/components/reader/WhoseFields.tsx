"use client";

import { useState } from "react";
import { PayerOptions } from "@/components/household/PayerOptions";
import type { Whose } from "@/lib/reader/extract";

export type WhosePerson = { id: string; name: string };

/**
 * D45, D61: "Whose is it?" on a reading's card, for a household of two or more (the caller shows nothing for one). A bill is shared (and says
 * who pays) or one person's; a charge is shared (the card's owner paid it) or not. Posts `whose` and `paidByMemberId`, which `readingForm` reads.
 * Key it by the entry kind: the choices differ.
 */
export function WhoseFields({ kind, people, value }: { kind: "bill" | "charge"; people: WhosePerson[]; value: Whose | null | undefined }) {
  const initial = kind === "charge" ? (value?.shared ? "shared" : "own") : value?.memberId ?? "shared";
  const [chosen, setChosen] = useState(initial);
  return <>
    <label className="ui-field">Whose is it?
      <select name="whose" value={chosen} onChange={event => setChosen(event.target.value)}>
        {kind === "bill"
          ? <><option value="shared">Shared, split by shares</option>{people.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</>
          : <><option value="own">The card&rsquo;s owner only</option><option value="shared">Shared, split by shares</option></>}
      </select></label>
    {kind === "bill" && chosen === "shared" && <label className="ui-field">Who pays it?
      <select name="paidByMemberId" defaultValue={value?.paidByMemberId ?? ""}><PayerOptions people={people} /></select></label>}
    {kind === "charge" && chosen === "shared" && <p className="ui-hint">The card&rsquo;s owner paid it. Set a card&rsquo;s owner in Settings.</p>}
  </>;
}
