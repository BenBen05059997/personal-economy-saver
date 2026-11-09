// The one place a database connection is made. Server-only: the URL never reaches the browser.
// `prepare: false` because Supabase's transaction pooler does not support prepared statements.

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import * as schema from "./schema";

const globalForDb = globalThis as unknown as { __economyDb?: ReturnType<typeof create> };
const requestDatabases = new WeakMap<object, ReturnType<typeof create>>();

export class MissingDatabaseUrl extends Error {
  constructor() { super("DATABASE_URL is not set"); }
}

function create() {
  if (typeof window !== "undefined") throw new Error("db() is server-only");
  const url = process.env.DATABASE_URL;
  if (!url?.trim()) throw new MissingDatabaseUrl();
  // Overlapping unnamed statements on the same pooled connection can stall.
  // Independent requests can still use the three connections concurrently.
  const sql = postgres(url, { prepare: false, max: 3, max_pipeline: 1, idle_timeout: 20 });
  return drizzle(sql, { schema });
}

/** Workers reuse a client only within the current request, through streamed rendering. */
export function requestDatabase(after: (cleanup: () => Promise<void>) => void) {
  if (typeof navigator !== "undefined" && navigator.userAgent === "Cloudflare-Workers") {
    const context = getCloudflareContext();
    let database = requestDatabases.get(context);
    if (!database) {
      database = create();
      const client = database.$client;
      after(async () => {
        requestDatabases.delete(context);
        await client.end({ timeout: 5 });
      });
      requestDatabases.set(context, database);
    }
    return database;
  }
  return (globalForDb.__economyDb ??= create());
}

/** Background jobs own their connection independently of foreground cleanup. */
export async function withOwnedDatabase<T>(run: (database: ReturnType<typeof create>) => Promise<T>): Promise<T> {
  const database = create();
  try {
    return await run(database);
  } finally {
    await database.$client.end({ timeout: 5 });
  }
}
