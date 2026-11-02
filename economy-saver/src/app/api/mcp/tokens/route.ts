import { z } from "zod";
import { db } from "@/db/client";
import { issueMcpToken, revokeMcpToken, tokenInput } from "@/db/mcp-tokens";
import { currentHouseholdId, sameOrigin } from "@/lib/session";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return new Response("Same-origin request required", { status: 403 });
  const hid = await currentHouseholdId();
  if (!hid) return new Response("Household session required", { status: 401 });
  const body = await request.json().catch(() => null);
  const revoke = z.object({ revoke: z.string().uuid() }).safeParse(body);
  if (revoke.success) {
    return await revokeMcpToken(db(), hid, revoke.data.revoke)
      ? new Response(null, { status: 204 }) : new Response("Token not found", { status: 404 });
  }
  const data = tokenInput.safeParse(body);
  if (!data.success) return new Response("Choose a token name and scopes.", { status: 400 });
  try {
    return Response.json(await issueMcpToken(db(), hid, data.data), { status: 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const message = error instanceof Error && error.message.startsWith("MCP_TOKEN_KEY ") ? error.message : "Could not issue token.";
    return new Response(message, { status: 503 });
  }
}
