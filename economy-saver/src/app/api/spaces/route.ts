import { z } from "zod";
import { db } from "@/db/client";
import { withHousehold } from "@/db/household";
import { consumeRequest } from "@/db/rate-limit";
import { archiveSpace, createSpace, deleteSpace, renameSpace, saveBrief } from "@/db/spaces";
import { briefFromForm } from "@/lib/agent/brief-form";
import { badFields, failure, formOf, NO_STORE, redirectTo, tooMany } from "@/lib/door";
import { FORM_REDIRECT_HEADER, postedByForm } from "@/lib/form-fetch";
import { householdRequest } from "@/lib/session";

const name = z.string().trim().min(1).max(60);
const id = z.string().uuid();
const fields = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("create"), name }),
  z.object({ kind: z.literal("rename"), id, name }),
  z.object({ kind: z.literal("archive"), id }),
  z.object({ kind: z.literal("delete"), id }),
  z.object({ kind: z.literal("brief"), id }),
]);

export async function POST(request: Request) {
  const hid = await householdRequest(request);
  if (hid instanceof Response) return hid;
  const form = await formOf(request);
  if (form instanceof Response) return form;
  const parsed = fields.safeParse(Object.fromEntries(form));
  if (!parsed.success) return badFields();

  const connection = db();
  try {
    if (!await withHousehold(connection, hid, tx => consumeRequest(tx, hid, "spaces", 20))) {
      return tooMany("Too many space changes. Try again in a minute.");
    }
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
      return redirectTo("/memory?tab=spaces", request);
    });
  } catch (error) {
    return failure(error);
  }
}
