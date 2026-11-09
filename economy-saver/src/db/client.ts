import { after } from "next/server";
import { requestDatabase } from "./client-core";

export { MissingDatabaseUrl, withOwnedDatabase } from "./client-core";

/** App Router requests keep the database open until streamed rendering finishes. */
export function db() {
  return requestDatabase(after);
}
