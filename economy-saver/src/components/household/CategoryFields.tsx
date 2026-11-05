"use client";

import { useState } from "react";
import { PercentInput } from "@/components/ui/CheckedInput";
import { CATEGORIES } from "@/lib/money/categories";
import { guessCategory } from "@/lib/money/categorise";
import { LABELS } from "./labels";
import "./add-entry.css";

type Share = "personal" | "business" | "mixed";

/**
 * The Category select and the "For work?" control of every form that takes a bill or a charge (D46). While the user has not
 * chosen, the select follows the keyword table as `name` is typed. By default it pre-selects a category only when the table is
 * sure, otherwise it shows "Choose a category" and the field is required. With `guessed` (the add forms, where it sits under
 * More ›) it always shows the guess, "Other" when the table is not sure, with "guessed, change if wrong" under it.
 * `defaultCategory` and `defaultBp` start it from a stored value. The add forms, which show the guess on their main part, hold
 * the choice themselves and pass `chosen` and `onChoose`.
 */
export function CategoryFields({ name, defaultCategory = null, defaultBp = 0, guessed = false, chosen: held, onChoose }: {
  name: string; defaultCategory?: string | null; defaultBp?: number; guessed?: boolean; chosen?: string | null; onChoose?: (category: string) => void;
}) {
  const [own, setOwn] = useState<string | null>(defaultCategory);
  const chosen = onChoose ? held ?? null : own;
  const setChosen = onChoose ?? setOwn;
  const guess = guessCategory(name);
  const category = chosen ?? (guessed || guess.sure ? guess.category : "");
  const [share, setShare] = useState<Share>(defaultBp === 0 ? "personal" : defaultBp === 10_000 ? "business" : "mixed");
  return <>
    <label className="ui-field">{LABELS.category}<select name="category" value={category} onChange={event => setChosen(event.target.value)} required>
      <option value="">Choose a category</option>
      {CATEGORIES.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}
    </select></label>
    {guessed && chosen === null && <small className="ui-hint add-entry-hint">{LABELS.categoryGuess}</small>}
    <fieldset className="share-choice">
      <legend>{LABELS.forWork}</legend>
      <div role="radiogroup" aria-label={LABELS.forWork}>
        {(["personal", "business", "mixed"] as const).map(option => <label key={option}>
          <input type="radio" name="businessShare" value={option} checked={share === option} onChange={() => setShare(option)} />
          {LABELS.work[option]}
        </label>)}
      </div>
      {share === "mixed" && <label className="ui-field">{LABELS.workPercent}<PercentInput name="businessPercent" maxLength={6} required placeholder="e.g. 30"
        defaultValue={defaultBp > 0 && defaultBp < 10_000 ? String(defaultBp / 100) : ""} /></label>}
    </fieldset>
  </>;
}
