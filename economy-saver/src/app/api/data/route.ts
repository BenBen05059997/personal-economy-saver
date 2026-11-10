import { z } from "zod";
import { db } from "@/db/client";
import { withHousehold } from "@/db/household";
import { DATA_KINDS, deleteConversation, deleteKind, deleteOne } from "@/db/data-kinds";
import { isMovable, requireCloud } from "@/db/place";
import { badFields, failure, householdForm, limited, redirectTo, returnPath, text } from "@/lib/door";

const What = z.enum(DATA_KINDS);

/**
 * Your data (D59): `kind` delete_kind (`what`: memory, canvases, journal or documents; the record is refused), delete_one (`what`, `id`) or
 * delete_conversation (`id` = the conversation's id; Ask's "Delete this conversation"). A real delete, never undone. Goes back to `returnTo`.
 */
export async function POST(request: Request) {
  const ctx = await householdForm(request);
  if (ctx instanceof Response) return ctx;
  const { hid, form } = ctx;
  const kind = form.get("kind");
  const what = What.safeParse(form.get("what"));
  const id = z.string().uuid().safeParse(form.get("id"));
  if (kind !== "delete_kind" && kind !== "delete_one" && kind !== "delete_conversation") return badFields();
  if (kind === "delete_kind" && !what.success) return badFields();
  if (kind === "delete_one" && (!what.success || !id.success)) return badFields();
  if (kind === "delete_conversation" && !id.success) return badFields();
  const by = { madeBy: "form" } as const;
  try {
    const busy = await limited(hid, "data", 10, "Too many requests. Try again in a minute.");
    if (busy) return busy;
    return await withHousehold(db(), hid, async tx => {
      // A kind kept on the device is deleted in the browser; the server has none of it.
      if (kind !== "delete_conversation" && isMovable(what.data)) await requireCloud(tx, hid, what.data);
      if (kind === "delete_conversation") await requireCloud(tx, hid, "journal");
      if (kind === "delete_kind") await deleteKind(tx, hid, what.data!, by);
      else if (kind === "delete_one") {
        if (!await deleteOne(tx, hid, what.data!, id.data!, by)) return text("That is already gone.", 404);
      } else await deleteConversation(tx, hid, id.data!);
      return redirectTo(returnPath(form.get("returnTo")), request);
    });
  } catch (error) {
    return failure(error);
  }
}
