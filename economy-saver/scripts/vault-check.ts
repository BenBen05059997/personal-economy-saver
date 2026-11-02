import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";

config({ path: ".env.local", quiet: true });

async function main() {
  const connection = db();
  try {
    // A rollback on any failure removes the probe, including after a disconnect.
    await connection.transaction(async (tx) => {
      const probe = randomUUID();
      const [secret] = await tx.execute<{ id: string }>(
        sql`select vault.create_secret(${probe}) as id`,
      );
      const [readback] = await tx.execute<{ matches: boolean }>(
        sql`select decrypted_secret = ${probe} as matches from vault.decrypted_secrets where id = ${secret.id}::uuid`,
      );
      if (!readback?.matches) throw new Error("Vault probe did not match");
      const removed = await tx.execute(
        sql`delete from vault.secrets where id = ${secret.id}::uuid returning id`,
      );
      if (removed.length !== 1) throw new Error("Vault probe was not deleted");
    });
    console.log("Vault create, read and delete passed.");
  } finally {
    await connection.$client.end();
  }
}

main().catch(() => {
  console.error(process.env.DATABASE_URL?.trim()
    ? "Vault check failed. Check the database connection, Vault extension and permissions."
    : "DATABASE_URL is not set");
  process.exitCode = 1;
});
