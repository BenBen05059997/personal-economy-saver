import { config } from "dotenv";
import { db } from "@/db/client";
import { seedBen } from "@/db/seed";

config({ path: ".env.local", quiet: true });

async function main() {
  const connection = db();
  try {
    const householdId = await seedBen(connection, { isDemo: true });
    console.log(householdId);
  } finally {
    await connection.$client.end();
  }
}

main().catch(() => {
  console.error(process.env.DATABASE_URL?.trim()
    ? "Seed failed. Check the database connection and apply the migration first."
    : "DATABASE_URL is not set");
  process.exitCode = 1;
});
