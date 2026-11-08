import { DrizzleQueryError } from "drizzle-orm/errors";

export function jobError(error: unknown) {
  if (!(error instanceof Error)) return { name: "Error", message: "Unknown failure" };
  // Drizzle query errors include SQL parameters, which can contain household data.
  if (error instanceof DrizzleQueryError) return { name: error.name, message: "Database query failed" };
  return { name: error.name, message: error.message };
}
