"use client";

import { useState } from "react";
import { ApiForm } from "@/components/ui/ApiForm";

/**
 * Plan's quiet "File" control on one item row (D75): a text button that opens a small form with a select of that category's own categories
 * and "None", and the checkbox "Every <name>, past and future" (ticked), which files every bill and charge with the same name and category.
 * Posts to /api/own-categories with `kind=file`. Only drawn for a signed-in household; the public family link has none.
 */
export function FileControl({ item, id, name, current, options }: {
  item: "bill" | "charge"; id: string; name: string; current: string | null; options: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" className="plan-file" aria-expanded={open} aria-label={`File ${name}`} onClick={() => setOpen(!open)}>File</button>
    {open && <span className="plan-file-form">
      <ApiForm action="/api/own-categories" onDone={() => setOpen(false)}>
        <input type="hidden" name="kind" value="file" /><input type="hidden" name="item" value={item} /><input type="hidden" name="id" value={id} />
        <label className="ui-field">Your category<select name="ownCategoryId" defaultValue={current ?? ""}>
          <option value="">None</option>
          {options.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}
        </select></label>
        <label className="plan-file-every"><input type="checkbox" name="everySame" defaultChecked /> Every {name}, past and future</label>
        <span className="plan-file-buttons"><button className="ui-button primary">Save</button><button type="button" className="ui-button" onClick={() => setOpen(false)}>Cancel</button></span>
      </ApiForm>
    </span>}
  </>;
}
