import { z } from "zod";
import { InputError } from "@/db/input-error";
import { db } from "@/db/client";
import { withHousehold } from "@/db/household";
import { issueMcpToken, revokeMcpToken, tokenInput } from "@/db/mcp-tokens";
import { limited, NO_STORE, text } from "@/lib/door";
import { ownerRequest } from "@/lib/session";

export async function POST(request: Request) {
  const hid = await ownerRequest(request);
  if (hid instanceof Response) return hid;
  const body = await request.json().catch(() => null);
  const revoke = z.object({ revoke: z.string().uuid() }).safeParse(body);
  if (revoke.success) {
    return await withHousehold(db(), hid, tx => revokeMcpToken(tx, hid, revoke.data.revoke))
      ? new Response(null, { status: 204 }) : text("Token not found", 404);
  }
  const busy = await limited(hid, "mcp-tokens", 10, "Too many tokens made. Try again in a minute.");
  if (busy) return busy;
  const data = tokenInput.safeParse(body);
  if (!data.success) return text("Choose a token name and scopes.", 400);
  try {
    return Response.json(await withHousehold(db(), hid, tx => issueMcpToken(tx, hid, data.data)), { status: 201, headers: NO_STORE });
  } catch (error) {
    if (error instanceof InputError) return text(error.message, 400);
    const message = error instanceof Error && error.message.startsWith("MCP_TOKEN_KEY ") ? error.message : "Could not issue token.";
    return text(message, 503);
  }
}
