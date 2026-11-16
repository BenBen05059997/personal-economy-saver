import { z } from "zod";

/** A UUID in the text form every id of a household takes (zod's own check: any hex digits in the 8-4-4-4-12 shape). */
export const Uuid = z.string().uuid();

// A UUID that code works out from what it is made of, so the same thing made twice is the same row. The one function behind a finding's id
// (db/suggestions.ts), a draft's id (agent/tools.ts) and a document's job id (db/reader-job.ts): the same parts give the same id; any other part gives another.
export async function stableIdOfBytes(bytes: BufferSource): Promise<string> {
  const id = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)).slice(0, 16);
  id[6] = (id[6] & 0x0f) | 0x80;
  id[8] = (id[8] & 0x3f) | 0x80;
  const hex = Array.from(id, byte => byte.toString(16).padStart(2, "0")).join("");
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join("-");
}

/** The id for the same household and the same parts. */
export function stableId(householdId: string, ...parts: (string | number)[]): Promise<string> {
  return stableIdOfBytes(new TextEncoder().encode([householdId, ...parts].join("/")));
}

/** SHA-256 of a text or of bytes, as lowercase hex. */
export async function sha256Hex(input: string | BufferSource): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", typeof input === "string" ? new TextEncoder().encode(input) : input);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

/** A secret token for a link or a cookie: 32 random bytes, base64url. Only its SHA-256 is stored where it must be looked up. */
export function newToken(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
}

/** A value as JSON with its keys in sorted order, so two inputs that say the same thing hash alike. */
export function canonicalJson(value: unknown): string {
  const sort = (node: unknown): unknown => Array.isArray(node) ? node.map(sort)
    : node !== null && typeof node === "object" ? Object.fromEntries(Object.entries(node).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([key, item]) => [key, sort(item)]))
    : node;
  return JSON.stringify(sort(value));
}
