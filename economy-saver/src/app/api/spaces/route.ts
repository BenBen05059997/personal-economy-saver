import { z } from "zod";
import { db } from "@/db/client";
import { withHousehold } from "@/db/household";
import { archiveSpace, createSpace, deleteSpace, renameSpace, saveBrief } from "@/db/spaces";
import { briefFromForm } from "@/lib/agent/brief-form";
import { badFields, failure, householdForm, limited } from "@/lib/door";
import { NO_STORE, redirectTo } from "@/lib/form-fetch";
import { FORM_REDIRECT_HEADER, postedByForm } from "@/lib/form-fetch";
import { Uuid } from "@/lib/stable-id";
import { MEMORY_SPACES } from "@/lib/links";

const name = z.string().trim().min(1).max(60);
const id = Uuid;
const fields = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("create"), name }),
  z.object({ kind: z.literal("rename"), id, name }),
  z.object({ kind: z.literal("archive"), id }),
  z.object({ kind: z.literal("delete"), id }),
  z.object({ kind: z.literal("brief"), id }),
]);

export async function POST(request: Request) {
  const ctx = await householdForm(request);
  if (ctx instanceof Response) return ctx;
  const { hid, form } = ctx;
  const parsed = fields.safeParse(Object.fromEntries(form));
  if (!parsed.success) return badFields();

  const connection = db();
  try {
    const busy = await limited(hid, "spaces", 20, "Too many space changes. Try again in a minute.", connection);
    if (busy) return busy;
    const action = parsed.data;
    return await withHousehold(connection, hid, async tx => {
      switch (action.kind) {
        case "create": {
          const space = await createSpace(tx, hid, action.name);
          return redirectTo(`/canvas?space=${space.id}`, request);
        }
        case "brief": {
          const record = await saveBrief(tx, hid, action.id, briefFromForm(form), "form");
          const destination = `/canvas?space=${action.id}`;
          return postedByForm(request)
            ? Response.json(record, { headers: { ...NO_STORE, [FORM_REDIRECT_HEADER]: destination } })
            : redirectTo(destination, request);
        }
        case "rename":
          await renameSpace(tx, hid, action.id, action.name);
          break;
        case "archive":
          await archiveSpace(tx, hid, action.id);
          break;
        case "delete":
          await deleteSpace(tx, hid, action.id);
          break;
      }
      return redirectTo(MEMORY_SPACES, request);
    });
  } catch (error) {
    return failure(error);
  }
}
