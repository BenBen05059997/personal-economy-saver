"use client";

import { useState } from "react";
import { AmountInput } from "@/components/ui/CheckedInput";
import "./add-entry.css";

export type EntryIds = { bill: string; charge: string };
type Props = {
  ids: EntryIds;
  returnTo: "/" | "/to-check";
  today: string;
  currency: string;
  people: { id: string; name: string }[];
  cards: { id: string; label: string }[];
  categories: string[];
};

/** One entry point for typing in a bill or a card charge. The ids are minted per render so a double submit saves once. */
export function AddEntry({ ids, returnTo, today, currency, people, cards, categories }: Props) {
  const [kind, setKind] = useState<"bill" | "charge">("bill");
  const [whose, setWhose] = useState(""); // "" = shared
  const split = people.length >= 2; // D45: the split fields exist only for a household of two or more; alone, a bill is saved as shared (no owner), as before
  const amount = <label className="ui-field">Amount ({currency})<AmountInput name="amount" currency={currency} required /></label>;
  return <details className="add-entry">
    <summary>Add a bill or charge</summary>
    <div className="add-entry-kind" role="group" aria-label="What to add">
      <button type="button" className="ui-button" aria-pressed={kind === "bill"} onClick={() => setKind("bill")}>Bill</button>
      <button type="button" className="ui-button" aria-pressed={kind === "charge"} onClick={() => setKind("charge")}>Card charge</button>
    </div>
    {kind === "bill" ? <form method="post" action="/api/bills">
      <input type="hidden" name="id" value={ids.bill} />
      <input type="hidden" name="returnTo" value={returnTo} />
      <label className="ui-field">Biller<input name="biller" maxLength={160} required /></label>
      {amount}
      <label className="ui-field">Due<input name="due" type="date" defaultValue={today} required /></label>
      <label className="add-entry-repeat"><input name="monthly" type="checkbox" /> Every month, on this day</label>
      <label className="ui-field">Category<input name="category" list="add-entry-categories" maxLength={100} required />
        <datalist id="add-entry-categories">{categories.map(name => <option key={name} value={name} />)}</datalist></label>
      {split && <label className="ui-field">Whose<select name="memberId" value={whose} onChange={event => setWhose(event.target.value)}>
        <option value="">Shared, split by shares</option>{people.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>}
      {split && whose === "" && <label className="ui-field">Paid by<select name="paidByMemberId" defaultValue={people[0].id} required>
        {people.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>}
      <button className="ui-button primary">Add bill</button>
    </form> : cards.length ? <form method="post" action="/api/charges">
      <input type="hidden" name="id" value={ids.charge} />
      <input type="hidden" name="returnTo" value={returnTo} />
      <label className="ui-field">Merchant<input name="merchant" maxLength={160} required /></label>
      {amount}
      <label className="ui-field">Date<input name="date" type="date" defaultValue={today} required /></label>
      <label className="ui-field">Card<select name="cardId" required>{cards.map(card => <option key={card.id} value={card.id}>{card.label}</option>)}</select></label>
      {split && <><label className="add-entry-repeat"><input name="shared" type="checkbox" /> Shared, split by shares</label>
        <p className="ui-hint">The card’s owner paid it. Set a card’s owner in Settings.</p></>}
      <button className="ui-button primary">Add charge</button>
    </form> : <p className="ui-hint">Add a card in Settings before adding a charge.</p>}
  </details>;
}
