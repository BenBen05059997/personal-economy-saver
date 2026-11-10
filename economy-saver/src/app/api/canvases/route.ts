import { z } from "zod";
import { db } from "@/db/client";
import { withHousehold } from "@/db/household";
import { requireCloud } from "@/db/place";
import { moveCanvas, pinCanvas, unpinCanvas, updateCanvas } from "@/db/canvases";
import { badFields, failure, householdForm, limited, redirectTo, returnPath, text } from "@/lib/door";

const MAX_RECIPE = 40_000;
const idOf = (value: FormDataEntryValue | null) => z.string().uuid().safeParse(value);

/** Pins on Home (D57): `kind` pin (title, recipe), update (id, recipe), move (id, direction up or down) or unpin (id). The recipe is hidden JSON text in the form. */
export async function POST(request: Request) {
  const ctx = await householdForm(request);
  if (ctx instanceof Response) return ctx;
  const { hid, form } = ctx;
  const by = { madeBy: "form" } as const;
  const kind = form.get("kind");
  if (kind !== "pin" && kind !== "update" && kind !== "move" && kind !== "unpin") return badFields();
  const busy = await limited(hid, "pins", 20, "Too many changes. Try again in a minute.");
  if (busy) return busy;
  const recipeText = String(form.get("recipe") ?? "");
  if (recipeText.length > MAX_RECIPE) return text("This canvas is too large.", 413);
  let recipe: unknown = null;
  if (kind === "pin" || kind === "update") {
    try { recipe = JSON.parse(recipeText); } catch { return badFields(); }
  }
  try {
    return await withHousehold(db(), hid, async tx => {
      await requireCloud(tx, hid, "canvases");
      if (kind === "pin") {
        const rawSpace = form.get("spaceId");
        const space = rawSpace === null ? null : idOf(rawSpace);
        if (space && !space.success) return badFields();
        await pinCanvas(tx, hid, { title: String(form.get("title") ?? ""), recipe, spaceId: space?.data }, by);
      } else {
        const id = idOf(form.get("id"));
        if (!id.success) return badFields();
        const done = kind === "update" ? await updateCanvas(tx, hid, id.data, recipe, by)
          : kind === "move" ? form.get("direction") === "up" || form.get("direction") === "down" ? await moveCanvas(tx, hid, id.data, form.get("direction") as "up" | "down", by) : null
          : await unpinCanvas(tx, hid, id.data, by);
        if (done === null) return badFields();
        if (!done) return text("That canvas is no longer pinned. Reload the page.", 404);
      }
      return redirectTo(returnPath(form.get("returnTo")), request);
    });
  } catch (error) {
    return failure(error);
  }
}
