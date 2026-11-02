import { privateRedirect, routeAuth } from "@/lib/auth-request";
import { sameOrigin } from "@/lib/session";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return new Response("Same-origin request required", { status: 403 });
  const response = privateRedirect("/");
  const client = await routeAuth(response);
  const { error } = await client.auth.signOut({ scope: "local" });
  if (error) return new Response("Unable to sign out. Please try again.", { status: 502 });
  response.cookies.delete("household");
  response.cookies.delete("upgrade-demo");
  return response;
}
