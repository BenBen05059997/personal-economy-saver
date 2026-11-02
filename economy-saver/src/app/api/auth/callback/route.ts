import { privateRedirect, routeAuth } from "@/lib/auth-request";
import { accountHousehold } from "@/db/account";
import { db } from "@/db/client";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const code = params.get("code");
  if (!code) return privateRedirect("/login?expired=1");
  const response = privateRedirect("/onboarding");
  const client = await routeAuth(response);
  const flowId = params.get("sb_flow_id");
  const { data, error } = await client.auth.exchangeCodeForSession(code, flowId ? { flowId } : undefined);
  if (error || !data.user) return privateRedirect("/login?expired=1");
  if (await accountHousehold(db(), data.user.id)) {
    response.headers.set("Location", "/");
    response.cookies.delete("household");
    response.cookies.delete("upgrade-demo");
  }
  return response;
}
