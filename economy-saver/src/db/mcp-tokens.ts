import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { requireHousehold, type Db } from "./household";
import { apiTokens } from "./schema";

const mcpScope = z.enum(["read", "draft"]);
export const tokenInput = z.object({ name: z.string().trim().min(1).max(80), scopes: z.array(mcpScope).min(1).max(2) });

const prefix = "pes1.";
const associatedData = new TextEncoder().encode("personal-economy-saver/mcp/v1");
async function cipherKey() {
  const raw = process.env.MCP_TOKEN_KEY;
  if (!raw) throw new Error("MCP_TOKEN_KEY is not set");
  const bytes = Buffer.from(raw, "base64url");
  if (bytes.length !== 32 || bytes.toString("base64url") !== raw) throw new Error("MCP_TOKEN_KEY must be 32 bytes encoded as unpadded base64url");
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function digest(token: string) {
  return Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))).toString("hex");
}

const publicColumns = { id: apiTokens.id, name: apiTokens.name, scopes: apiTokens.scopes, last4: apiTokens.last4 };
export function listMcpTokens(db: Db, hid: string) {
  return db.select(publicColumns).from(apiTokens)
    .where(and(eq(apiTokens.householdId, requireHousehold(hid)), isNull(apiTokens.revokedAt)))
    .orderBy(desc(apiTokens.createdAt));
}
export type McpTokenInfo = Awaited<ReturnType<typeof listMcpTokens>>[number];

export async function issueMcpToken(db: Db, hid: string, input: z.infer<typeof tokenInput>) {
  const householdId = requireHousehold(hid);
  const data = tokenInput.parse(input);
  // Hide the routing identifier: on Try it, a household UUID is itself a session credential.
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: associatedData },
    await cipherKey(), new TextEncoder().encode(householdId));
  const token = prefix + Buffer.concat([iv, new Uint8Array(ciphertext)]).toString("base64url");
  const [info] = await db.insert(apiTokens).values({
    householdId, name: data.name, scopes: [...new Set(data.scopes)], last4: token.slice(-4), tokenHash: await digest(token),
  }).returning(publicColumns);
  return { token, info };
}

export async function authenticateMcpToken(db: Db, token: string) {
  if (!token.startsWith(prefix) || token.length !== 91) return null;
  const bytes = Buffer.from(token.slice(prefix.length), "base64url");
  const key = await cipherKey();
  let hid: string;
  try {
    const id = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.subarray(0, 12), additionalData: associatedData }, key, bytes.subarray(12));
    hid = requireHousehold(new TextDecoder().decode(id));
  } catch { return null; }
  const [row] = await db.update(apiTokens).set({ lastUsedAt: new Date() })
    .where(and(eq(apiTokens.householdId, hid), eq(apiTokens.tokenHash, await digest(token)), isNull(apiTokens.revokedAt)))
    .returning({ householdId: apiTokens.householdId, scopes: apiTokens.scopes });
  return row ?? null;
}

export async function revokeMcpToken(db: Db, hid: string, tokenId: string) {
  const rows = await db.update(apiTokens).set({ revokedAt: new Date() })
    .where(and(eq(apiTokens.householdId, requireHousehold(hid)), eq(apiTokens.id, tokenId), isNull(apiTokens.revokedAt)))
    .returning({ id: apiTokens.id });
  return rows.length === 1;
}
