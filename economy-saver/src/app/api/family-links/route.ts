import { db } from "@/db/client";
import { withHousehold } from "@/db/household";
import { createFamilyLink, loadFamilyView, stopFamilyLink } from "@/db/family-links";
import { consumeRequest } from "@/db/rate-limit";
import { badFields, failure, formOf, NO_STORE, text, tooMany } from "@/lib/door";
import { homeSentence } from "@/lib/money/sentence";
import { appUrl, MissingAuthSetting } from "@/lib/supabase-auth";
import { ownerRequest } from "@/lib/session";
import { z } from "zod";

/**
 * Settings → People → Share a family view (D52). `kind=create` makes a link and answers with JSON: the full link, once (only its
 * hash is stored), and the message for LINE (the sentence, then the link and its last day). `kind=stop` (with `id`) stops one.
 */
export async function POST(request: Request) {
  const hid = await ownerRequest(request);
  if (hid instanceof Response) return hid;
  const form = await formOf(request);
  if (form instanceof Response) return form;
  const kind = form.get("kind");
  try {
    if (kind !== "create" && kind !== "stop") return badFields();
    if (!await withHousehold(db(), hid, tx => consumeRequest(tx, hid, "family-links", 20))) return tooMany("Too many changes. Try again in a minute.");
    if (kind === "stop") {
      const id = z.string().uuid().safeParse(form.get("id"));
      if (!id.success) return badFields();
      const stopped = await withHousehold(db(), hid, tx => stopFamilyLink(tx, hid, id.data));
      return stopped ? text("Sharing stopped. That link no longer opens.", 200) : text("That link has already ended.", 200);
    }
    const base = appUrl().origin; // read before anything is made, so a missing APP_URL stops with its own message
    const made = await withHousehold(db(), hid, tx => createFamilyLink(tx, hid));
    const view = await withHousehold(db(), hid, tx => loadFamilyView(tx, hid),
      { isolationLevel: "repeatable read", accessMode: "read only" });
    const sentence = homeSentence(view.state);
    const link = `${base}/family/${made.token}`;
    const message = `${sentence.text}\nSee our month: ${link} (until ${made.day})`;
    return Response.json({ link, message, day: made.day, id: made.info.id }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof MissingAuthSetting) return text(error.message, 503);
    return failure(error);
  }
}
