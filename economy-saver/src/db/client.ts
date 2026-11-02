// The one place a database connection is made. Server-only: the URL never reaches the browser.
// `prepare: false` because Supabase's transaction pooler does not support prepared statements.

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const globalForDb = globalThis as unknown as { __economyDb?: ReturnType<typeof create> };

export class MissingDatabaseUrl extends Error {
  constructor() { super("DATABASE_URL is not set"); }
}

function create() {
  if (typeof window !== "undefined") throw new Error("db() is server-only");
  const url = process.env.DATABASE_URL;
  if (!url?.trim()) throw new MissingDatabaseUrl();
  // A small pool: a Worker or serverless instance only ever runs a few queries at once.
  const sql = postgres(url, { prepare: false, max: 3, idle_timeout: 20 });
  return drizzle(sql, { schema });
}

/** Created on first use and reused across hot reloads and requests in the same instance. */
export function db() {
  return (globalForDb.__economyDb ??= create());
}
