import { db } from "@/db/client";
import {
  addOwnCategory, addOwnCategoryInput, fileOwnCategory, fileOwnCategoryInput, mergeOwnCategories, mergeOwnCategoryInput,
  removeOwnCategory, removeOwnCategoryInput, saveOwnCategory, saveOwnCategoryInput,
} from "@/db/own-categories";
import { badFields, failure, householdForm, limited, text } from "@/lib/door";
import { businessBpFromForm } from "@/lib/money/categories";

const NOT_YOURS = "Choose one of your categories.";

/** The default share a form sends: "" or "none" = no default (null), else the bill form's Personal / Work / Part choice; undefined when the form does not say. */
function defaultShare(form: FormData): number | null | undefined {
  const choice = form.get("businessShare");
  if (choice === null) return undefined;
  if (choice === "" || choice === "none") return null;
  return businessBpFromForm(choice, form.get("businessPercent")) ?? undefined;
}

/**
 * Your categories (D75), open to any member and recorded nowhere in Activity (filing moves no money). `kind=add` makes one (`category`, `name`,
 * optional `businessShare`/`businessPercent`); `save` renames and/or changes the default share (`id`, `name`, `businessShare`); `merge` moves the items of
 * `id` into `into` and removes `id`; `remove` removes `id`; `file` files the bill or charge `id` (`item` = bill | charge) under `ownCategoryId` ("" = none),
 * for every item with the same name too when `everySame=on`.
 */
export async function POST(request: Request) {
  const ctx = await householdForm(request);
  if (ctx instanceof Response) return ctx;
  const { hid, form } = ctx;
  const kind = form.get("kind");
  try {
    if (kind !== "add" && kind !== "save" && kind !== "merge" && kind !== "remove" && kind !== "file") return badFields();
    const busy = await limited(hid, "own-categories", 20, "Too many changes. Try again in a minute.");
    if (busy) return busy;
    if (kind === "add") {
      const share = defaultShare(form);
      if (share === undefined && form.get("businessShare") !== null) return text("Enter the business share as a percentage from 0 to 100.", 400);
      const data = addOwnCategoryInput.safeParse({ kind: form.get("category"), name: form.get("name"), ...(share !== undefined && { businessBp: share }) });
      if (!data.success) return badFields();
      const made = await addOwnCategory(db(), hid, data.data);
      return text(`Added ${made.name}.`, 200);
    }
    if (kind === "save") {
      const share = defaultShare(form);
      if (share === undefined && form.get("businessShare") !== null) return text("Enter the business share as a percentage from 0 to 100.", 400);
      const name = form.get("name");
      const data = saveOwnCategoryInput.safeParse({ id: form.get("id"), ...(typeof name === "string" && { name }), ...(share !== undefined && { businessBp: share }) });
      if (!data.success) return badFields();
      if (!await saveOwnCategory(db(), hid, data.data)) return text(NOT_YOURS, 400);
      return text("Saved", 200);
    }
    if (kind === "merge") {
      const data = mergeOwnCategoryInput.safeParse({ id: form.get("id"), into: form.get("into") });
      if (!data.success) return badFields();
      const { moved } = await mergeOwnCategories(db(), hid, data.data);
      return text(`Merged. ${moved === 1 ? "1 item" : `${moved} items`} moved.`, 200);
    }
    if (kind === "remove") {
      const data = removeOwnCategoryInput.safeParse({ id: form.get("id") });
      if (!data.success) return badFields();
      if (!await removeOwnCategory(db(), hid, data.data)) return text(NOT_YOURS, 400);
      return text("Removed", 200);
    }
    const picked = form.get("ownCategoryId");
    const data = fileOwnCategoryInput.safeParse({ item: form.get("item"), id: form.get("id"), ownCategoryId: picked === "" || picked === null ? null : picked, everySame: form.get("everySame") === "on" });
    if (!data.success) return badFields();
    const filed = await fileOwnCategory(db(), hid, data.data);
    if (!filed) return text("Choose an item of this household", 400);
    return text(filed.filed === 1 ? "Filed" : `Filed ${filed.filed} items`, 200);
  } catch (error) {
    return failure(error);
  }
}
