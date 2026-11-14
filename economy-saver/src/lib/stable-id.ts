// A UUID that code works out from what it is made of, so the same thing made twice is the same row. The one function behind a finding's id
// (db/suggestions.ts) and a draft's id (agent/tools.ts): same household and same parts give the same id; any other part gives another.
export async function stableId(householdId: string, ...parts: (string | number)[]): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode([householdId, ...parts].join("/")))).slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x80;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join("-");
}

/** A value as JSON with its keys in sorted order, so two inputs that say the same thing hash alike. */
export function canonicalJson(value: unknown): string {
  const sort = (node: unknown): unknown => Array.isArray(node) ? node.map(sort)
    : node !== null && typeof node === "object" ? Object.fromEntries(Object.entries(node).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([key, item]) => [key, sort(item)]))
    : node;
  return JSON.stringify(sort(value));
}
