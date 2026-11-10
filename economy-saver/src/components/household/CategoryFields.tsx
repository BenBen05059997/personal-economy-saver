"use client";

import { useEffect, useState } from "react";
import { PercentInput } from "@/components/ui/CheckedInput";
import { CATEGORIES } from "@/lib/money/categories";
import { guessCategory } from "@/lib/money/categorise";
import { guessedOwn, NEW_OWN, type OwnChoices } from "@/lib/reader/own-choices";
import { OWN_NAME_MAX } from "@/lib/money/own-category";
import { LABELS } from "./labels";
import "./add-entry.css";

type Share = "personal" | "business" | "mixed";

/**
 * The Category select and the "For work?" control of every form that takes a bill or a charge (D46). While the user has not
 * chosen, the select follows the keyword table as `name` is typed. By default it pre-selects a category only when the table is
 * sure, otherwise it shows "Choose a category" and the field is required. With `guessed` (the add forms, where it sits under
 * More ›) it always shows the guess, "Other" when the table is not sure. The add form labels the guess in its summary.
 * `defaultCategory` and `defaultBp` start it from a stored value.
 * D75: after Category, "Your category" (None, that category's own categories, New…) always shows. With `fileItself` a typed name that
 * matches the latest confirmed item of the same category that has an own category pre-fills it ("Filed like last time"), until the person picks.
 * `defaultOwn` is a saved item's own category. Choosing one with a default business share sets the share unless the person already chose it. The add forms, which show the guess on their main part, hold
 * the choice themselves and pass `chosen` and `onChoose`; `onOwn` reports the own category that applies (picked or guessed) so the summary can say it.
 */
export function CategoryFields({ name, own, defaultCategory = null, defaultBp = 0, defaultOwn = null, fileItself = false, guessed = false, chosen: held, onChoose, onOwn }: {
  name: string; own: OwnChoices; defaultCategory?: string | null; defaultBp?: number; defaultOwn?: string | null; fileItself?: boolean;
  guessed?: boolean; chosen?: string | null; onChoose?: (category: string) => void;
  onOwn?: (own: { name: string; guessed: boolean } | null) => void;
}) {
  const [kept, setKept] = useState<string | null>(defaultCategory);
  const chosen = onChoose ? held ?? null : kept;
  const setChosen = onChoose ?? setKept;
  const keyword = guessCategory(name);
  const category = chosen ?? (guessed || keyword.sure ? keyword.category : "");
  const [pick, setPick] = useState<{ category: string; value: string } | null>(null); // the person's own choice in "Your category"; a pick under another category no longer counts
  const [newName, setNewName] = useState("");
  const picked = pick !== null && pick.category === category ? pick.value : null;
  const guess = fileItself && picked === null ? guessedOwn(own, category, name) : null;
  const offered = own.categories.filter(item => item.kind === category);
  const saved = defaultOwn !== null && category === defaultCategory && offered.some(item => item.id === defaultOwn) ? defaultOwn : "";
  const ownValue = picked ?? guess?.id ?? saved;
  const ownShare = picked === null && guess === null ? null : offered.find(item => item.id === ownValue)?.businessBp ?? null; // the default share of what was chosen or guessed
  const [chosenShare, setChosenShare] = useState<Share | null>(null);
  const bp = ownShare ?? defaultBp;
  const ownName = ownValue === NEW_OWN ? newName.trim() : offered.find(item => item.id === ownValue)?.name ?? "";
  const ownGuessed = picked === null && guess !== null;
  useEffect(() => { onOwn?.(ownName === "" ? null : { name: ownName, guessed: ownGuessed }); }, [onOwn, ownName, ownGuessed]);
  const share: Share = chosenShare ?? (bp === 0 ? "personal" : bp === 10_000 ? "business" : "mixed");
  return <>
    <label className="ui-field">{LABELS.category}<select name="category" value={category} onChange={event => setChosen(event.target.value)} required>
      <option value="">Choose a category</option>
      {CATEGORIES.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}
    </select></label>
    <label className="ui-field">{LABELS.yourCategory}<select name="ownCategory" value={ownValue} onChange={event => setPick({ category, value: event.target.value })}>
      <option value="">None</option>
      {offered.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      <option value={NEW_OWN}>New…</option>
    </select></label>
    {ownValue === NEW_OWN && <label className="ui-field">{LABELS.newOwnCategory}<input name="ownCategoryNew" maxLength={OWN_NAME_MAX} required value={newName} onChange={event => setNewName(event.target.value)} /></label>}
    {guess !== null && <small className="ui-hint add-entry-hint">{LABELS.filedLikeLast}</small>}
    <fieldset className="share-choice">
      <legend>{LABELS.forWork}</legend>
      <div role="radiogroup" aria-label={LABELS.forWork}>
        {(["personal", "business", "mixed"] as const).map(option => <label key={option}>
          <input type="radio" name="businessShare" value={option} checked={share === option} onChange={() => setChosenShare(option)} />
          {LABELS.work[option]}
        </label>)}
      </div>
      {share === "mixed" && <label key={bp} className="ui-field">{LABELS.workPercent}<PercentInput name="businessPercent" maxLength={6} required placeholder="e.g. 30"
        defaultValue={bp > 0 && bp < 10_000 ? String(bp / 100) : ""} /></label>}
    </fieldset>
  </>;
}
