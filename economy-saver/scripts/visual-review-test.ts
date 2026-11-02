// Export only the fictional view model from an isolated test database for visual QA.
import { writeFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { DEMO_DATE } from "@/db/demo";
import { householdOwnerName, loadMoneyState, unreadCount } from "@/db/household";
import * as schema from "@/db/schema";
import { readerInbox } from "@/db/reader-inbox";
import { seedBen } from "@/db/seed";
import { loadSettings } from "@/db/settings";

async function exportFixture() {
  const path = process.argv[2];
  if (!path) throw new Error("Supply an output path for the fictional review fixture");
  const pg = new PGlite();
  try {
    const db = drizzle(pg, { schema });
    await migrate(db, { migrationsFolder: "./drizzle" });
    const id = await seedBen(db, { isDemo: true });
    const data = {
      name: await householdOwnerName(db, id),
      unread: await unreadCount(db, id),
      inbox: await readerInbox(db, id),
      state: await loadMoneyState(db, id, DEMO_DATE),
      settings: await loadSettings(db, id),
    };
    await writeFile(path, JSON.stringify(data), { mode: 0o600 });
  } finally {
    await pg.close();
  }
}
void exportFixture();
