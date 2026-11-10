import { text } from "@/lib/door";
import { db } from "@/db/client";
import { mcpRequest } from "@/lib/mcp/server";

async function handle(request: Request) {
  try { return await mcpRequest(request, db); }
  catch (error) {
    const message = error instanceof Error && /^(MCP_TOKEN_KEY |DATABASE_URL is not set)/.test(error.message)
      ? error.message : "MCP request failed";
    return text(message, 503);
  }
}

export { handle as POST, handle as GET, handle as DELETE };
