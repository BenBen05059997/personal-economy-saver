"use client";

import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { ApiForm } from "@/components/ui/ApiForm";
import { CheckedInput } from "@/components/ui/CheckedInput";
import { HORIZON_MESSAGE, latestDate } from "@/lib/money/horizon";
import { categoryLabel, CategoryKeySchema } from "@/lib/money/categories";
import { guessCategory, guessRepeat } from "@/lib/money/categorise";
import { AmountField } from "./AmountField";
import { AmountWithUnknown, DueWithUnknown } from "./UnknownFields";
import { CategoryFields } from "./CategoryFields";
import { LABELS } from "./labels";
import { MoreFields } from "./MoreFields";
import { PayerOptions } from "./PayerOptions";
import { type Repeat, ScheduleFields } from "./ScheduleFields";
import "./add-entry.css";
import { repeatWords } from "@/lib/money/format";

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
  // The click is caught in the capture phase, before a Next <Link> handles it: a Link's own hash navigation finds no
  // element called add-bill, so it would scroll nowhere and leave the form closed (found in the Nov 4 walk).
  const scrollWhenOpen = useRef(false);
  useEffect(() => {
    const kinds: Record<string, "bill" | "charge"> = { "#add-bill": "bill", "#add-charge": "charge" };
    function show(target: "bill" | "charge") {
      setKind(target);
      scrollWhenOpen.current = true;
      setOpen(true);
    }
    function onClick(event: MouseEvent) {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest("a") : null;
      const href = link?.getAttribute("href") ?? "";
      const target = kinds[href] ?? (window.location.pathname === "/" ? kinds[href.replace(/^\//, "")] : undefined);
      if (!target) return;
      event.preventDefault(); // a Next <Link> leaves a prevented click alone; menus that close on any click still see it
      show(target);
    }
    // The address's hash is read here and again on every hash change (typing /#add-charge into the address bar of an open Home
    // changes only the hash, which never re-runs this effect). Each tab button carries the hash's id too, so the browser's own
    // fragment navigation finds an element inside this <details> and opens it even before this code has run.
    function arrive() {
      const arrived = kinds[window.location.hash];
      if (arrived) show(arrived);
    }
    arrive();
    document.addEventListener("click", onClick, true);
    window.addEventListener("hashchange", arrive);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("hashchange", arrive);
    };
  }, []);
  // Scroll once the open form is on the page, not before React has drawn it.
  useEffect(() => {
    if (!open || !scrollWhenOpen.current) return;
    scrollWhenOpen.current = false;
    document.getElementById("add-entry")?.scrollIntoView({ block: "center" });
  }, [open]);
  return <details id="add-entry" className="add-entry" open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>Add a bill or charge</summary>
    <div className="add-entry-kind" role="group" aria-label="What to add">
      <button id="add-bill" type="button" className="ui-button" aria-pressed={kind === "bill"} onClick={() => setKind("bill")}>Bill</button>
      <button id="add-charge" type="button" className="ui-button" aria-pressed={kind === "charge"} onClick={() => setKind("charge")}>Card charge</button>
    </div>
    <div hidden={kind !== "bill"}><BillForm id={ids.bill} people={people} {...shared} /></div>
    <div hidden={kind !== "charge"}>{cards.length ? <ChargeForm id={ids.charge} people={people} cards={cards} {...shared} /> : <p className="ui-hint">Add a card in Settings before adding a charge.</p>}</div>
  </details>;
}


/** The category key the select shows: the user's choice, else the guess from the name (D46: "Other" when the table is not sure). */
const categoryWords = (chosen: string | null, name: string) => {
  if (chosen === "") return "No category yet"; // the user picked "Choose a category": the form asks before it saves
  const key = CategoryKeySchema.safeParse(chosen);
  return categoryLabel(key.success ? key.data : guessCategory(name).category);
};

/** D51: what the form will save from More ›, said on the main part: "Every month · Health & fitness · Change ›". Change opens More at its first field. */
function Guess({ words, focus }: { words: string[]; focus: string }) {
  function change(event: ReactMouseEvent<HTMLButtonElement>) {
    const more = event.currentTarget.form?.querySelector<HTMLDetailsElement>("details.add-entry-more");
    if (!more) return;
    more.open = true;
    more.querySelector<HTMLElement>(focus)?.focus();
  }
  return <p className="ui-hint add-entry-guess">{words.join(" · ")} · <button type="button" className="add-entry-change" onClick={change}>Change ›</button></p>;
}

type FormProps = { id: string; returnTo: "/" | "/to-check"; today: string; currency: string; people: { id: string; name: string }[] };

function BillForm({ id, returnTo, today, currency, people }: FormProps) {
  const [name, setName] = useState(""); // the name typed so far; the category and the repeat follow it until the user chooses
  const [due, setDue] = useState(today);
  const [whose, setWhose] = useState(""); // "" = shared
  const [repeat, setRepeat] = useState<Repeat | null>(null); // null = not chosen: it follows the name
  const [varies, setVaries] = useState(false); // D54: only saved while the bill repeats every month
  const [category, setCategory] = useState<string | null>(null);
  const [nextAmount, setNextAmount] = useState("");
  const [cancelBy, setCancelBy] = useState("");
  const repeats = repeat ?? guessRepeat(name);
  // D55: the boxes are offered where the database accepts them: an unknown amount on a one-off or an amount-varies bill with no dated new amount, an unknown date on a one-off with no cancel-by date.
  const amountOffered = nextAmount.trim() === "" && (repeats === "" || (repeats === "month" && varies));
  const dueOffered = repeats === "" && cancelBy === "";
  const split = people.length >= 2; // D45: the split fields exist only for a household of two or more; alone, a bill is saved as shared (no owner), as before
  return <ApiForm action="/api/bills">
    <input type="hidden" name="id" value={id} />
    <input type="hidden" name="returnTo" value={returnTo} />
    <label className="ui-field">{LABELS.name}<input name="biller" maxLength={160} required placeholder={LABELS.namePlaceholder} value={name} onChange={event => setName(event.target.value)} /></label>
    <AmountWithUnknown currency={currency} offered={amountOffered} />
    <DueWithUnknown today={today} value={due} onValue={setDue} offered={dueOffered} />
    <Guess words={[repeatWords(repeats || null), ...(repeats === "month" && varies ? ["varies"] : []), categoryWords(category, name)]} focus="select[name=repeat]" />
    <button className="ui-button primary">Add bill</button>
    <MoreFields>
      <ScheduleFields id={id} today={today} currency={currency} name={name} due={due} flat chosen={repeat} onChoose={setRepeat} varies={varies} onVaries={setVaries} onNextAmount={setNextAmount} onCancelBy={setCancelBy} />
      <CategoryFields name={name} guessed chosen={category} onChoose={setCategory} />
      {split && <label className="ui-field">{LABELS.whoFor}<select name="memberId" value={whose} onChange={event => setWhose(event.target.value)}>
        <option value="">Shared, split by shares</option>{people.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>}
      {split && whose === "" && <label className="ui-field">{LABELS.whoPays}<select name="paidByMemberId" defaultValue={people[0].id}>
        <PayerOptions people={people} /></select></label>}
    </MoreFields>
  </ApiForm>;
}

function ChargeForm({ id, returnTo, today, currency, people, cards }: FormProps & { cards: { id: string; label: string }[] }) {
  const [name, setName] = useState(""); // what or where, typed so far; the category follows it until the user chooses
  const [category, setCategory] = useState<string | null>(null);
  const split = people.length >= 2;
  const card = <label className="ui-field">{LABELS.card}<select name="cardId" required>{cards.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>;
  return <ApiForm action="/api/charges">
    <input type="hidden" name="id" value={id} />
    <input type="hidden" name="returnTo" value={returnTo} />
    <label className="ui-field">{LABELS.whatOrWhere}<input name="merchant" maxLength={160} required placeholder={LABELS.whatOrWherePlaceholder} value={name} onChange={event => setName(event.target.value)} /></label>
    <label className="ui-field">{LABELS.amount}<AmountField name="amount" currency={currency} required /></label>
    <label className="ui-field">{LABELS.date}<CheckedInput name="date" type="date" defaultValue={today} max={latestDate(today)} message={HORIZON_MESSAGE} required /></label>
    {cards.length > 1 && card}
    <Guess words={[categoryWords(category, name)]} focus="select[name=category]" />
    <button className="ui-button primary">Add charge</button>
    <MoreFields>
      {cards.length === 1 && card}
      <CategoryFields name={name} guessed chosen={category} onChoose={setCategory} />
      {split && <><label className="add-entry-repeat"><input name="shared" type="checkbox" /> Shared, split by shares</label>
        <p className="ui-hint">The card’s owner paid it. Set a card’s owner in Settings.</p></>}
    </MoreFields>
  </ApiForm>;
}
