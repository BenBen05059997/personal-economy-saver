import { db } from "@/db/client";
import { withHousehold } from "@/db/household";
import { createFamilyLink, loadFamilyView, stopFamilyLink } from "@/db/family-links";
import { badFields, failure, limited, NO_STORE, ownerForm, text } from "@/lib/door";
import { homeSentence } from "@/lib/money/sentence";
import { appUrl, MissingAuthSetting } from "@/lib/supabase-auth";
import { z } from "zod";

/**
 * Settings → People → Share a family view (D52). `kind=create` makes a link and answers with JSON: the full link, once (only its
 * hash is stored), and the message for LINE (the sentence, then the link and its last day). `kind=stop` (with `id`) stops one.
 */
export async function POST(request: Request) {
  const ctx = await ownerForm(request);
  if (ctx instanceof Response) return ctx;
  const { hid, form } = ctx;
  const kind = form.get("kind");
  try {
    if (kind !== "create" && kind !== "stop") return badFields();
    const busy = await limited(hid, "family-links", 20, "Too many changes. Try again in a minute.");
    if (busy) return busy;
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
