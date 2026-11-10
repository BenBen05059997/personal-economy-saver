"use client";

import { useState } from "react";
import { ConfirmRemove } from "@/components/ui/ConfirmRemove";
import { ApiForm, ApiFormGroup } from "@/components/ui/ApiForm";
import { PercentInput } from "@/components/ui/CheckedInput";
import { LABELS } from "@/components/household/labels";
import { CATEGORIES, categoryLabel } from "@/lib/money/categories";
import { OWN_NAME_MAX } from "@/lib/money/own-category";
import type { OwnCategoryGroup } from "@/db/own-categories";

type Choice = "none" | "personal" | "business" | "mixed";
const choiceOf = (bp: number | null): Choice => bp === null ? "none" : bp === 0 ? "personal" : bp === 10_000 ? "business" : "mixed";
/** "Work", "Personal", "30% work": a default share in words; null when there is none. */
function shareWords(bp: number | null): string | null {
  const choice = choiceOf(bp);
  return choice === "none" ? null : choice === "mixed" ? `${(bp! / 100).toString()}% work` : LABELS.work[choice];
}
const items = (n: number) => `${n} ${n === 1 ? "item" : "items"}`;

/** The default business share of an own category: No default, Personal, Work or Part work (with its percentage). It only pre-fills a form; saved items keep their own share. */
function DefaultShare({ bp }: { bp: number | null }) {
  const [choice, setChoice] = useState<Choice>(choiceOf(bp));
  return <>
    <label className="ui-field">Default for work?<select name="businessShare" value={choice} onChange={event => setChoice(event.target.value as Choice)}>
      <option value="none">No default</option>
      <option value="personal">{LABELS.work.personal}</option>
      <option value="business">{LABELS.work.business}</option>
      <option value="mixed">{LABELS.work.mixed}</option>
    </select></label>
    {choice === "mixed" && <label className="ui-field">{LABELS.workPercent}<PercentInput name="businessPercent" maxLength={6} required placeholder="e.g. 30" defaultValue={bp !== null && bp > 0 && bp < 10_000 ? String(bp / 100) : ""} /></label>}
  </>;
}

/**
 * Settings → Your categories (D75): the person's own names under the fourteen, grouped by category, each with its default share and how many
 * items are filed under it. Any member may add, rename, merge and remove; they post to /api/own-categories.
 */
export function OwnCategories({ groups }: { groups: OwnCategoryGroup[] }) {
  return <section className="ui-panel" id="categories"><h2>Your categories</h2>
    {groups.length === 0
      ? <p className="ui-hint">Your own names for your spending, kept under the fourteen categories, like Coffee under Food. Make one here, or while adding a bill or charge.</p>
      : <p className="ui-hint">Your own names, kept under the fourteen categories. Plan and Home show them inside their category.</p>}
    {groups.map(group => <div key={group.kind} className="settings-own-group">
      <h3>{group.label}</h3>
      {group.categories.map(category => {
        const same = group.categories.filter(other => other.id !== category.id);
        const share = shareWords(category.businessBp);
        return <div key={category.id} id={`own-${category.id}`} className="settings-bill">
          <p>{category.name}{share && ` · ${share}`} · {items(category.items)}</p>
          <ApiFormGroup>
            <details className="settings-edit"><summary aria-label={`Rename ${category.name} or change its default`}>Rename or change default</summary>
              <ApiForm action="/api/own-categories"><input type="hidden" name="kind" value="save" /><input type="hidden" name="id" value={category.id} />
                <label className="ui-field">Name<input name="name" maxLength={OWN_NAME_MAX} required defaultValue={category.name} /></label>
                <DefaultShare bp={category.businessBp} />
                <button className="ui-button primary">Save</button></ApiForm></details>
            {same.length > 0 && <details className="settings-edit"><summary aria-label={`Merge ${category.name} into another`}>Merge into…</summary>
              <ApiForm action="/api/own-categories"><input type="hidden" name="kind" value="merge" /><input type="hidden" name="id" value={category.id} />
                <label className="ui-field">Merge into<select name="into" required defaultValue={same[0].id}>{same.map(other => <option key={other.id} value={other.id}>{other.name}</option>)}</select></label>
                <p className="ui-hint">Its {items(category.items)} move to the one you choose, and {category.name} is removed.</p>
                <button className="ui-button">Merge</button></ApiForm></details>}
          </ApiFormGroup>
          <ConfirmRemove kind="own_category" id={category.id} returnTo="/settings" label={category.name}
            note={category.items === 0 ? "Nothing is filed under it." : `${category.items === 1 ? "Its 1 item goes" : `Its ${category.items} items go`} back to ${group.label}.`} />
        </div>;
      })}
    </div>)}
    <details className="settings-edit" open={groups.length === 0}><summary>Add a category</summary>
      <ApiForm action="/api/own-categories"><input type="hidden" name="kind" value="add" />
        <label className="ui-field">{LABELS.category}<select name="category" required defaultValue="">
          <option value="" disabled>Choose a category</option>
          {CATEGORIES.map(item => <option key={item.key} value={item.key}>{categoryLabel(item.key)}</option>)}
        </select></label>
        <label className="ui-field">Name<input name="name" maxLength={OWN_NAME_MAX} required placeholder="e.g. Coffee" /></label>
        <DefaultShare bp={null} />
        <button className="ui-button primary">Add category</button></ApiForm></details>
  </section>;
}
