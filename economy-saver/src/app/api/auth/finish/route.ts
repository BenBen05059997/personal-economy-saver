import { cookies } from "next/headers";
import { accountHousehold } from "@/db/account";
import { NO_REFERRER, redirectTo } from "@/lib/door";
import { db } from "@/db/client";
import { InputError } from "@/db/input-error";
import { INVITE_TOKEN, acceptInvite } from "@/db/invites";
import { routeAuth } from "@/lib/auth-request";
import { INVITE_COOKIE, inviteCookiePolicy } from "@/lib/invite-auth";

export async function GET(request: Request) {
  const jar = await cookies();
  const rawInvite = jar.get(INVITE_COOKIE)?.value;
  const invite = rawInvite && INVITE_TOKEN.test(rawInvite) ? rawInvite : null;
  jar.set(INVITE_COOKIE, "", { ...inviteCookiePolicy, maxAge: 0 });

  const refused = invite ? "/join/" + invite + "?refused=1" : "/login?expired=1";
  const params = new URL(request.url).searchParams;
  const code = params.get("code");
  if (!code || (rawInvite !== undefined && !invite)) return redirectTo(refused, undefined, NO_REFERRER);

  const response = redirectTo(invite ? refused : "/onboarding", undefined, NO_REFERRER);
  const client = await routeAuth(response);
  const flowId = params.get("sb_flow_id");
  const { data, error } = await client.auth.exchangeCodeForSession(code, flowId ? { flowId } : undefined);
  if (error || !data.user) {
    response.headers.set("Location", refused);
    return response;
  }

  if (invite) {
    response.cookies.delete("upgrade-demo");
    const user = data.user;
    if (!user.email_confirmed_at || !user.email) return response;
    try {
      if (!await acceptInvite(db(), invite, { uid: user.id, email: user.email })) return response;
    } catch (failure) {
      if (failure instanceof InputError) return response;
      throw failure;
    }
  } else if (!await accountHousehold(db(), data.user.id)) {
    return response;
  }

  response.headers.set("Location", "/");
  response.cookies.delete("household");
  response.cookies.delete("upgrade-demo");
  return response;
}
