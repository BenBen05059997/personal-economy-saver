// The Try it cookie holds a token, never the household id (D34). Route suites name a household by id; this gives the
// stand-in for next/headers a token that opens it. Anything else (a real household's id, a made-up value) is passed as
// is and opens nothing, as in the browser.
import { demoHouseholdForToken, issueDemoToken } from "@/db/demo";
import type { Db } from "@/db/household";

export function demoCookies(db: unknown) {
  const tokens = new Map<string, string>();
  return async (id: string | null): Promise<string | null> => {
    if (!id) return null;
    const store = db as Db;
    const known = tokens.get(id);
    if (known && await demoHouseholdForToken(store, known) === id) return known;
    const issued = /^[0-9a-f-]{36}$/.test(id) ? await issueDemoToken(store, id) : null;
    if (issued) tokens.set(id, issued);
    return issued ?? id;
  };
}
