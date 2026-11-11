import { z } from "zod";
import { accountMembership } from "@/db/account";
import { db } from "@/db/client";
import { acceptInvite, cancelInvite, createInvite, INVITE_TOKEN, leaveHousehold } from "@/db/invites";
import { verifiedIdentity } from "@/lib/auth-request";
import { badFields, failure, formOf, limited, NO_REFERRER, NO_STORE, redirectTo, sameOriginOnly, text } from "@/lib/door";
import { appUrl } from "@/lib/supabase-auth";

const createFields = z.object({ email: z.string().max(254), memberId: z.string().uuid().optional(), name: z.string().max(80).optional() });

export async function POST(request: Request) {
  const foreign = sameOriginOnly(request);
  if (foreign) return foreign;
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
      const response = redirectTo("/", request, NO_REFERRER);
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
      return redirectTo("/onboarding", request, NO_REFERRER);
    }

    if (kind !== "create" && kind !== "cancel") return badFields();
    if (access.role !== "owner") return text("Household owner required", 403);
    const busy = await limited(hid, "invites", 20, "Too many invitation changes. Try again in a minute.", store);
    if (busy) return busy;
    if (kind === "cancel") {
      const id = z.string().uuid().safeParse(form.get("id"));
      if (!id.success) return badFields();
      if (!await cancelInvite(store, hid, identity.uid, id.data)) return text("This invitation is no longer open.", 404);
      return redirectTo("/household/people", request, NO_REFERRER);
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
