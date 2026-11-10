import { NO_REFERRER, redirectTo, sameOriginOnly, text } from "@/lib/door";
import { routeAuth } from "@/lib/auth-request";

export async function POST(request: Request) {
  const foreign = sameOriginOnly(request);
  if (foreign) return foreign;
  const response = redirectTo("/", request, NO_REFERRER);
  const client = await routeAuth(response);
  const { error } = await client.auth.signOut({ scope: "local" });
  if (error) return text("Unable to sign out. Please try again.", 502);
  response.cookies.delete("household");
  response.cookies.delete("upgrade-demo");
  return response;
}
