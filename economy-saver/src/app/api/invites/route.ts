import { z } from "zod";
import { accountMembership } from "@/db/account";
import { db } from "@/db/client";
import { acceptInvite, cancelInvite, createInvite, INVITE_TOKEN, leaveHousehold } from "@/db/invites";
import { withHousehold } from "@/db/household";
import { consumeRequest } from "@/db/rate-limit";
import { privateRedirect, verifiedIdentity } from "@/lib/auth-request";
import { badFields, failure, formOf, NO_STORE, text, tooMany } from "@/lib/door";
import { postedByForm } from "@/lib/form-fetch";
import { sameOrigin } from "@/lib/session";
import { appUrl } from "@/lib/supabase-auth";

const createFields = z.object({ email: z.string().max(254), memberId: z.string().uuid().optional(), name: z.string().max(80).optional() });

export async function POST(request: Request) {
  if (!sameOrigin(request)) return text("Same-origin request required", 403);
  const identity = await verifiedIdentity();
  if (!identity) return text("Sign in to continue.", 401);
  const form = await formOf(request);
  if (form instanceof Response) return form;
  const store = db();
  const kind = form.get("kind");
  try {
    if (kind === "accept") {
      const token = z.string().regex(INVITE_TOKEN).safeParse(form.get("token"));
      if (!token.success) return badFields();
      if (!await acceptInvite(store, token.data, identity)) return text("This invitation is unavailable for your verified email.", 403);
      const response = privateRedirect("/", request);
      response.cookies.delete("household");
      response.cookies.delete("upgrade-demo");
      return response;
    }

    const access = await accountMembership(store, identity.uid);
    if (!access) return text("Household session required", 401);
    const hid = access.householdId;
    if (kind === "leave") {
      if (access.role !== "member") return text("Only a member can leave this way.", 403);
      if (!await leaveHousehold(store, hid, identity.uid)) return text("Membership is no longer available.", 404);
      return privateRedirect("/onboarding", request);
    }

    if (kind !== "create" && kind !== "cancel") return badFields();
    if (access.role !== "owner") return text("Household owner required", 403);
    if (!await withHousehold(store, hid, tx => consumeRequest(tx, hid, "invites", 20))) return tooMany("Too many invitation changes. Try again in a minute.");
    if (kind === "cancel") {
      const id = z.string().uuid().safeParse(form.get("id"));
      if (!id.success) return badFields();
      if (!await cancelInvite(store, hid, identity.uid, id.data)) return text("This invitation is no longer open.", 404);
      return privateRedirect(postedByForm(request) ? "/settings" : "/settings#people", request);
    }
    const fields = createFields.safeParse({ email: form.get("email"), memberId: form.get("memberId") || undefined, name: form.get("name") || undefined });
    if (!fields.success) return badFields();
    const origin = appUrl();
    const created = await createInvite(store, hid, identity.uid, fields.data);
    return Response.json({ url: new URL("/join/" + created.token, origin).href }, { status: 201, headers: NO_STORE });
  } catch (error) {
    return failure(error);
  }
}
