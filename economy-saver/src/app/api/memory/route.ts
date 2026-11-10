import { z } from "zod";
import { db } from "@/db/client";
import { withHousehold } from "@/db/household";
import { requireCloud } from "@/db/place";
import { requireSpace } from "@/db/spaces";
import { addMemory, deleteMemory, editMemory, forgetEverything } from "@/db/memory";
import { badFields, failure, householdForm, redirectTo, returnPath, text } from "@/lib/door";

/** Profile or space notes (D58, D70): add, edit, delete one thing, or clear the selected scope. */
export async function POST(request: Request) {
  const ctx = await householdForm(request);
  if (ctx instanceof Response) return ctx;
  const { hid, form } = ctx;
  const scope = z.string().uuid().nullable().safeParse(form.get("spaceId"));
  if (!scope.success) return badFields();
  const spaceId = scope.data;
  const by = { madeBy: "form" } as const;
  const field = (name: string) => String(form.get(name) ?? "");
  try {
    return await withHousehold(db(), hid, async tx => {
      await requireCloud(tx, hid, "memory");
      if (spaceId) await requireSpace(tx, hid, spaceId);
      switch (field("kind")) {
        case "add":
          await addMemory(tx, hid, { kind: field("memoryKind"), text: field("text"), spaceId }, by);
          break;
        case "edit": {
          const id = z.string().uuid().safeParse(field("id"));
          if (!id.success) return badFields();
          if (!await editMemory(tx, hid, id.data, { kind: field("memoryKind"), text: field("text"), spaceId }, by)) return text("That is no longer here. Reload the page.", 404);
          break;
        }
        case "delete": {
          const id = z.string().uuid().safeParse(field("id"));
          if (!id.success) return badFields();
          if (!await deleteMemory(tx, hid, id.data, by, spaceId)) return text("That is already gone.", 404);
          break;
        }
        case "forget_all":
          await forgetEverything(tx, hid, by, spaceId);
          break;
        default:
          return badFields();
      }
      return redirectTo(returnPath(form.get("returnTo")), request);
    });
  } catch (error) {
    return failure(error);
  }
}
