"use client";

import { useState, type MouseEvent as ReactMouseEvent } from "react";
import { ApiForm } from "@/components/ui/ApiForm";
import { CheckedInput } from "@/components/ui/CheckedInput";
import { HORIZON_MESSAGE, latestDate } from "@/lib/money/horizon";
import { CategoryKeySchema, type CategoryKey } from "@/lib/money/categories";
import { guessCategory, guessRepeat } from "@/lib/money/categorise";
import { Currency } from "@/lib/catalogue/types";
import { AmountField } from "./AmountField";
import { VoiceFill } from "@/components/voice/VoiceFill";
import { AmountWithUnknown, DueWithUnknown } from "./UnknownFields";
import { CategoryFields } from "./CategoryFields";
import type { OwnChoices } from "@/lib/reader/own-choices";
import { LABELS } from "./labels";
import { MoreFields } from "./MoreFields";
import { PayerOptions } from "./PayerOptions";
import { type Repeat, ScheduleFields } from "./ScheduleFields";
import "./add-entry.css";
import { repeatWords } from "@/lib/money/format";
import { ownLabel } from "@/lib/money/own-category";

/** The category key the select shows: the user's choice, else the guess from the name (D46: "Other" when the table is not sure). */
const categoryWords = (chosen: string | null, name: string, own: OwnApplied) => {
  if (chosen === "") return "No category yet"; // the user picked "Choose a category": the form asks before it saves
  const key = CategoryKeySchema.safeParse(chosen);
  return ownLabel(key.success ? key.data : guessCategory(name).category, own);
};
/** The own category CategoryFields resolved (picked or filed like last time), or null. */
type OwnApplied = { name: string; guessed: boolean } | null;

/** D51: what the form will save from More ›, said on the main part: "Every month · Health & fitness · Change ›". Change opens More at its first field. */
function Guess({ words, focus, categoryGuessed, ownGuessed }: { words: string[]; focus: string; categoryGuessed: boolean; ownGuessed: boolean }) {
  function change(event: ReactMouseEvent<HTMLButtonElement>) {
    const more = event.currentTarget.form?.querySelector<HTMLDetailsElement>("details.add-entry-more");
    if (!more) return;
    more.open = true;
    more.querySelector<HTMLElement>(focus)?.focus();
  }
  return <>
    <p className="ui-hint add-entry-guess"><span className="add-entry-guess-words">{words.join(" · ")}</span><span aria-hidden> · </span><button type="button" className="add-entry-change" onClick={change}>Change ›</button></p>
    {(ownGuessed || categoryGuessed) && <small className="ui-hint add-entry-hint">{ownGuessed ? LABELS.filedLikeLast : LABELS.categoryGuess}</small>}
  </>;
}

/** The setup steps start a bill from a chip: its name and category, repeating every month. */
export type BillPreset = { name: string; category: CategoryKey; varies?: boolean };
type FormProps = { id: string; returnTo: string; today: string; currency: string; people: { id: string; name: string }[]; own: OwnChoices };

export function BillForm({ id, returnTo, today, currency, people, own, preset }: FormProps & { preset?: BillPreset }) {
  const [name, setName] = useState(preset?.name ?? ""); // the name typed so far; the category and the repeat follow it until the user chooses
  const [due, setDue] = useState(today);
  const [whose, setWhose] = useState(""); // "" = shared
  const [repeat, setRepeat] = useState<Repeat | null>(preset ? "month" : null); // null = not chosen: it follows the name
  const [varies, setVaries] = useState(preset?.varies ?? false); // D54: only saved while the bill repeats every month
  const [category, setCategory] = useState<string | null>(preset?.category ?? null);
  const [applied, setApplied] = useState<OwnApplied>(null);
  const [nextAmount, setNextAmount] = useState("");
  const [cancelBy, setCancelBy] = useState("");
  const repeats = repeat ?? guessRepeat(name);
  // D55: the boxes are offered where the database accepts them: an unknown amount on a one-off or an amount-varies bill with no dated new amount, an unknown date on a one-off with no cancel-by date.
  const amountOffered = nextAmount.trim() === "" && (repeats === "" || (repeats === "month" && varies));
  const dueOffered = repeats === "" && cancelBy === "";
  const split = people.length >= 2; // D45: the split fields exist only for a household of two or more; alone, a bill is saved as shared (no owner), as before
  return <ApiForm action="/api/bills">
    <VoiceFill />
    <input type="hidden" name="id" value={id} />
    <input type="hidden" name="returnTo" value={returnTo} />
    <label className="ui-field">{LABELS.name}<input name="biller" maxLength={160} required placeholder={LABELS.namePlaceholder} value={name} onChange={event => setName(event.target.value)} /></label>
    <AmountWithUnknown currency={currency} offered={amountOffered} />
    <DueWithUnknown today={today} value={due} onValue={setDue} offered={dueOffered} />
    <Guess words={[repeatWords(repeats || null), ...(repeats === "month" && varies ? ["varies"] : []), categoryWords(category, name, applied)]} focus="select[name=repeat]" categoryGuessed={category === null} ownGuessed={applied?.guessed === true} />
    <button className="ui-button primary">Add bill</button>
    <MoreFields>
      <ScheduleFields id={id} today={today} currency={currency} name={name} due={due} flat chosen={repeat} onChoose={setRepeat} varies={varies} onVaries={setVaries} onNextAmount={setNextAmount} onCancelBy={setCancelBy} />
      <CategoryFields name={name} own={own} fileItself guessed chosen={category} onChoose={setCategory} onOwn={setApplied} />
      {split && <label className="ui-field">{LABELS.whoFor}<select name="memberId" value={whose} onChange={event => setWhose(event.target.value)}>
        <option value="">Shared, split by shares</option>{people.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>}
      {split && whose === "" && <label className="ui-field">{LABELS.whoPays}<select name="paidByMemberId" defaultValue={people[0].id}>
        <PayerOptions people={people} /></select></label>}
    </MoreFields>
  </ApiForm>;
}

export function ChargeForm({ id, returnTo, today, currency, people, cards, own }: FormProps & { cards: { id: string; label: string }[] }) {
  const [name, setName] = useState(""); // what or where, typed so far; the category follows it until the user chooses
  const [category, setCategory] = useState<string | null>(null);
  const [applied, setApplied] = useState<OwnApplied>(null);
  const split = people.length >= 2;
  const card = <label className="ui-field">{LABELS.card}<select name="cardId" required>{cards.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>;
  const [other, setOther] = useState("");
  const others = Currency.options.filter(code => code !== currency);
  return <ApiForm action="/api/charges">
    <VoiceFill />
    <input type="hidden" name="id" value={id} />
    <input type="hidden" name="returnTo" value={returnTo} />
    <label className="ui-field">{LABELS.whatOrWhere}<input name="merchant" maxLength={160} required placeholder={LABELS.whatOrWherePlaceholder} value={name} onChange={event => setName(event.target.value)} /></label>
    <label className="ui-field">{LABELS.amount}<AmountField name="amount" currency={currency} required /></label>
    <label className="ui-field">{LABELS.date}<CheckedInput name="date" type="date" defaultValue={today} max={latestDate(today)} message={HORIZON_MESSAGE} required /></label>
    {cards.length > 1 && card}
    <Guess words={[categoryWords(category, name, applied)]} focus="select[name=category]" categoryGuessed={category === null} ownGuessed={applied?.guessed === true} />
    <button className="ui-button primary">Add charge</button>
    <MoreFields>
      {cards.length === 1 && card}
      <CategoryFields name={name} own={own} fileItself guessed chosen={category} onChoose={setCategory} onOwn={setApplied} />
      <details className="add-entry-more">
        <summary>Paid in another currency</summary>
        <label className="ui-field">Currency<select name="originalCurrency" value={other} onChange={event => setOther(event.target.value)}>
          <option value="">Choose a currency</option>{others.map(code => <option key={code} value={code}>{code}</option>)}</select></label>
        <label className="ui-field">Amount paid in that currency<AmountField name="originalAmount" currency={other || others[0]} /></label>
        <p className="ui-hint">The amount on the receipt. Above, enter what the card billed in yen; the app shows what the conversion cost.</p>
      </details>
      {split && <><label className="add-entry-repeat"><input name="shared" type="checkbox" /> Shared, split by shares</label>
        <p className="ui-hint">The card’s owner paid it. Set a card’s owner in Settings.</p></>}
    </MoreFields>
  </ApiForm>;
}
