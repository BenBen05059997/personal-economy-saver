"use client";

import { useEffect, useState } from "react";
import { ApiForm } from "@/components/ui/ApiForm";
import { AmountInput, CheckedInput } from "@/components/ui/CheckedInput";
import { HORIZON_MESSAGE, latestDate } from "@/lib/money/horizon";
import { CategoryFields } from "./CategoryFields";
import { ScheduleFields } from "./ScheduleFields";
import "./add-entry.css";

export type EntryIds = { bill: string; charge: string };
type Props = {
  ids: EntryIds;
  returnTo: "/" | "/to-check";
  today: string;
  currency: string;
  people: { id: string; name: string }[];
  cards: { id: string; label: string }[];
};

/** One entry point for typing in a bill or a card charge. The ids are minted per render so a double submit saves once; the caller keys it by them, so an accepted entry leaves a fresh, closed one. Each tab is its own form with its own fields; both stay mounted and the other is hidden, so switching tabs never mixes or loses what was typed. */
export function AddEntry({ ids, returnTo, today, currency, people, cards }: Props) {
  const [kind, setKind] = useState<"bill" | "charge">("bill");
  const shared = { returnTo, today, currency };
  const [open, setOpen] = useState(false);
  // Links to "#add-bill" and "#add-charge" (the empty panels and First steps on Home; the + Add menu links to "/#add-bill" from any page) open this form on the right tab.
  // A page opened with the hash already in its address (arriving from another page) opens it on load.
  useEffect(() => {
    const kinds: Record<string, "bill" | "charge"> = { "#add-bill": "bill", "#add-charge": "charge" };
    function show(target: "bill" | "charge") {
      setKind(target);
      setOpen(true);
      requestAnimationFrame(() => document.getElementById("add-entry")?.scrollIntoView({ block: "center" }));
    }
    function onClick(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest("a") : null;
      const href = link?.getAttribute("href") ?? "";
      const target = kinds[href] ?? (window.location.pathname === "/" ? kinds[href.replace(/^\//, "")] : undefined);
      if (!target) return;
      event.preventDefault();
      show(target);
    }
    const arrived = kinds[window.location.hash];
    if (arrived) show(arrived);
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);
  return <details id="add-entry" className="add-entry" open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>Add a bill or charge</summary>
    <div className="add-entry-kind" role="group" aria-label="What to add">
      <button type="button" className="ui-button" aria-pressed={kind === "bill"} onClick={() => setKind("bill")}>Bill</button>
      <button type="button" className="ui-button" aria-pressed={kind === "charge"} onClick={() => setKind("charge")}>Card charge</button>
    </div>
    <div hidden={kind !== "bill"}><BillForm id={ids.bill} people={people} {...shared} /></div>
    <div hidden={kind !== "charge"}>{cards.length ? <ChargeForm id={ids.charge} people={people} cards={cards} {...shared} /> : <p className="ui-hint">Add a card in Settings before adding a charge.</p>}</div>
  </details>;
}

type FormProps = { id: string; returnTo: "/" | "/to-check"; today: string; currency: string; people: { id: string; name: string }[] };

function BillForm({ id, returnTo, today, currency, people }: FormProps) {
  const [name, setName] = useState(""); // the biller typed so far; the category follows it until the user chooses
  const [whose, setWhose] = useState(""); // "" = shared
  const split = people.length >= 2; // D45: the split fields exist only for a household of two or more; alone, a bill is saved as shared (no owner), as before
  return <ApiForm action="/api/bills">
    <input type="hidden" name="id" value={id} />
    <input type="hidden" name="returnTo" value={returnTo} />
    <label className="ui-field">Biller<input name="biller" maxLength={160} required value={name} onChange={event => setName(event.target.value)} /></label>
    <label className="ui-field">Amount ({currency})<AmountInput name="amount" currency={currency} required /></label>
    <label className="ui-field">Due<CheckedInput name="due" type="date" defaultValue={today} max={latestDate(today)} message={HORIZON_MESSAGE} required /></label>
    <ScheduleFields id={id} today={today} currency={currency} />
    <CategoryFields name={name} />
    {split && <label className="ui-field">Whose<select name="memberId" value={whose} onChange={event => setWhose(event.target.value)}>
      <option value="">Shared, split by shares</option>{people.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>}
    {split && whose === "" && <label className="ui-field">Paid by<select name="paidByMemberId" defaultValue={people[0].id} required>
      {people.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>}
    <button className="ui-button primary">Add bill</button>
  </ApiForm>;
}

function ChargeForm({ id, returnTo, today, currency, people, cards }: FormProps & { cards: { id: string; label: string }[] }) {
  const [name, setName] = useState(""); // the merchant typed so far; the category follows it until the user chooses
  const split = people.length >= 2;
  return <ApiForm action="/api/charges">
    <input type="hidden" name="id" value={id} />
    <input type="hidden" name="returnTo" value={returnTo} />
    <label className="ui-field">Merchant<input name="merchant" maxLength={160} required value={name} onChange={event => setName(event.target.value)} /></label>
    <label className="ui-field">Amount ({currency})<AmountInput name="amount" currency={currency} required /></label>
    <label className="ui-field">Date<CheckedInput name="date" type="date" defaultValue={today} max={latestDate(today)} message={HORIZON_MESSAGE} required /></label>
    <label className="ui-field">Card<select name="cardId" required>{cards.map(card => <option key={card.id} value={card.id}>{card.label}</option>)}</select></label>
    <CategoryFields name={name} />
    {split && <><label className="add-entry-repeat"><input name="shared" type="checkbox" /> Shared, split by shares</label>
      <p className="ui-hint">The card’s owner paid it. Set a card’s owner in Settings.</p></>}
    <button className="ui-button primary">Add charge</button>
  </ApiForm>;
}
