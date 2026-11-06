import { z } from "zod";
import { db } from "@/db/client";
import { moveCanvas, pinCanvas, unpinCanvas, updateCanvas } from "@/db/canvases";
import { consumeRequest } from "@/db/rate-limit";
import { badFields, failure, formOf, redirectTo, returnPath, text } from "@/lib/door";
import { householdRequest } from "@/lib/session";

const MAX_RECIPE = 40_000;
const idOf = (value: FormDataEntryValue | null) => z.string().uuid().safeParse(value);

/** Pins on Home (D57): `kind` pin (title, recipe), update (id, recipe), move (id, direction up or down) or unpin (id). The recipe is hidden JSON text in the form. */
export async function POST(request: Request) {
  const hid = await householdRequest(request);
  if (hid instanceof Response) return hid;
  const form = await formOf(request);
  if (form instanceof Response) return form;
  const by = { madeBy: "form" } as const;
  const kind = form.get("kind");
  if (kind !== "pin" && kind !== "update" && kind !== "move" && kind !== "unpin") return badFields();
  if (!await consumeRequest(db(), hid, "pins", 20)) return text("Too many changes. Try again in a minute.", 429, { "Retry-After": "60" });
  const recipeText = String(form.get("recipe") ?? "");
  if (recipeText.length > MAX_RECIPE) return text("This canvas is too large.", 413);
  let recipe: unknown = null;
  if (kind === "pin" || kind === "update") {
    try { recipe = JSON.parse(recipeText); } catch { return badFields(); }
  }
  try {
    if (kind === "pin") {
      await pinCanvas(db(), hid, { title: String(form.get("title") ?? ""), recipe }, by);
    } else {
      const id = idOf(form.get("id"));
      if (!id.success) return badFields();
      const done = kind === "update" ? await updateCanvas(db(), hid, id.data, recipe, by)
        : kind === "move" ? form.get("direction") === "up" || form.get("direction") === "down" ? await moveCanvas(db(), hid, id.data, form.get("direction") as "up" | "down", by) : null
        : await unpinCanvas(db(), hid, id.data, by);
      if (done === null) return badFields();
      if (!done) return text("That canvas is no longer pinned. Reload the page.", 404);
    }
    return redirectTo(returnPath(form.get("returnTo")), request);
  } catch (error) {
    return failure(error);
  }
}
