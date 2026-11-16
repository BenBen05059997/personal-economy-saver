import { HOUSEHOLD_COOKIE, UPGRADE_DEMO_COOKIE } from "@/lib/supabase-auth";
import { NO_REFERRER, sameOriginOnly, text } from "@/lib/door";
import { redirectTo } from "@/lib/form-fetch";
import { routeAuth } from "@/lib/auth-request";

export async function POST(request: Request) {
  const foreign = sameOriginOnly(request);
  if (foreign) return foreign;
  const response = redirectTo("/", request, NO_REFERRER);
  const client = await routeAuth(response);
  const { error } = await client.auth.signOut({ scope: "local" });
  if (error) return text("Unable to sign out. Please try again.", 502);
  response.cookies.delete(HOUSEHOLD_COOKIE);
  response.cookies.delete(UPGRADE_DEMO_COOKIE);
  return response;
}
