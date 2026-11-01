import { defineConfig } from "drizzle-kit";

// `generate` reads only the schema; DATABASE_URL is needed for `migrate`/`push` against a real database.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
});
