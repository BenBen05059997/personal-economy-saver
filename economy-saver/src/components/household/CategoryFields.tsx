"use client";

import { useState } from "react";
import { PercentInput } from "@/components/ui/CheckedInput";
import { CATEGORIES } from "@/lib/money/categories";
import { guessCategory } from "@/lib/money/categorise";
import "./add-entry.css";

type Share = "personal" | "business" | "mixed";

/**
 * The Category select and the Business share control of every form that takes a bill or a charge (D46). While the user has not
 * chosen, the select follows the keyword table as `name` is typed: it pre-selects a category only when the table is sure,
 * otherwise it shows "Choose a category" and the field is required. `defaultCategory` and `defaultBp` start it from a stored value.
 */
export function CategoryFields({ name, defaultCategory = null, defaultBp = 0 }: { name: string; defaultCategory?: string | null; defaultBp?: number }) {
  const [chosen, setChosen] = useState<string | null>(defaultCategory);
  const guess = guessCategory(name);
  const category = chosen ?? (guess.sure ? guess.category : "");
  const [share, setShare] = useState<Share>(defaultBp === 0 ? "personal" : defaultBp === 10_000 ? "business" : "mixed");
  return <>
    <label className="ui-field">Category<select name="category" value={category} onChange={event => setChosen(event.target.value)} required>
      <option value="">Choose a category</option>
      {CATEGORIES.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}
    </select></label>
    <fieldset className="share-choice">
      <legend>Business share</legend>
      <div role="radiogroup" aria-label="Business share">
        {(["personal", "business", "mixed"] as const).map(option => <label key={option}>
          <input type="radio" name="businessShare" value={option} checked={share === option} onChange={() => setShare(option)} />
          {option === "personal" ? "Personal" : option === "business" ? "Business" : "Mixed"}
        </label>)}
      </div>
      {share === "mixed" && <label className="ui-field">Business part (%)<PercentInput name="businessPercent" maxLength={6} required placeholder="30"
        defaultValue={defaultBp > 0 && defaultBp < 10_000 ? String(defaultBp / 100) : ""} /></label>}
    </fieldset>
  </>;
}
