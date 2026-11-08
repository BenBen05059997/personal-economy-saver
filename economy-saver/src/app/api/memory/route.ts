import { z } from "zod";
import { db } from "@/db/client";
import { withHousehold } from "@/db/household";
import { requireCloud } from "@/db/place";
import { addMemory, deleteMemory, editMemory, forgetEverything } from "@/db/memory";
import { badFields, failure, formOf, redirectTo, returnPath, text } from "@/lib/door";
import { householdRequest } from "@/lib/session";

/** What the assistant knows (D58): add, edit, delete one thing, or forget everything. Goes back to the page named by `returnTo` (the Memory page). */
export async function POST(request: Request) {
  const hid = await householdRequest(request);
  if (hid instanceof Response) return hid;
  const form = await formOf(request);
  if (form instanceof Response) return form;
  const by = { madeBy: "form" } as const;
  const field = (name: string) => String(form.get(name) ?? "");
  try {
    return await withHousehold(db(), hid, async tx => {
      await requireCloud(tx, hid, "memory");
      switch (field("kind")) {
        case "add":
          await addMemory(tx, hid, { kind: field("memoryKind"), text: field("text") }, by);
          break;
        case "edit": {
          const id = z.string().uuid().safeParse(field("id"));
          if (!id.success) return badFields();
          if (!await editMemory(tx, hid, id.data, { kind: field("memoryKind"), text: field("text") }, by)) return text("That is no longer here. Reload the page.", 404);
          break;
        }
        case "delete": {
          const id = z.string().uuid().safeParse(field("id"));
          if (!id.success) return badFields();
          if (!await deleteMemory(tx, hid, id.data, by)) return text("That is already gone.", 404);
          break;
        }
        case "forget_all":
          await forgetEverything(tx, hid, by);
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
