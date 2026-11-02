import { defineConfig } from "drizzle-kit";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
const url = process.env.DATABASE_URL?.trim();
if (!url && process.argv.some((arg) => ["migrate", "push", "pull", "studio"].includes(arg))) {
  throw new Error("DATABASE_URL is not set");
}

// `generate` reads only the schema; DATABASE_URL is needed for `migrate`/`push` against a real database.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  ...(url && { dbCredentials: { url } }),
});
