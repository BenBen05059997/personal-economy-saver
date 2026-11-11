// The one-off pay-token backfill: sent invoices made before payment links existed get one where a link can be made.
// PGlite, no credentials. Fictional data only. Run from the project root:
// npx tsx --tsconfig ./tsconfig.json scripts/backfill-pay-tokens-test.ts
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "@/db/schema";
import type { Db } from "@/db/household";
import { backfillPayTokens } from "@/db/pay-token-backfill";
import { seedBen } from "@/db/seed";

async function main() {
  const pg = new PGlite({ extensions: { pg_trgm } });
  const db = drizzle(pg, { schema });
  const store = db as unknown as Db;
  await migrate(db, { migrationsFolder: "./drizzle" });
  try {
    const mine = await seedBen(db, {}), theirs = await seedBen(db, {});
    const rows = (hid: string) => db.select().from(schema.invoices).where(eq(schema.invoices.householdId, hid));
    // Invoices from before links: sent, no token. One in yen cannot have a link.
    await db.update(schema.invoices).set({ payToken: null }).where(eq(schema.invoices.householdId, mine));
    const sentMine = (await rows(mine)).filter(r => r.status === "sent");
    assert.ok(sentMine.length >= 2);
    await db.update(schema.invoices).set({ currency: "JPY" }).where(eq(schema.invoices.id, sentMine[0].id));
    const before = await rows(theirs);

    const dry = await backfillPayTokens(store, false);
    assert.ok((await rows(mine)).every(r => r.payToken === null), "a dry run writes nothing");
    assert.ok(dry.given > 0 && dry.skipped["not USD"] === 1);

    const first = await backfillPayTokens(store, true);
    assert.deepEqual(first, dry, "the dry run counted what the real run did");
    const after = await rows(mine);
    for (const r of after) assert.equal(r.payToken !== null, r.status === "sent" && r.currency === "USD", r.status + " " + r.currency);
    assert.equal(new Set(after.filter(r => r.payToken).map(r => r.payToken)).size, after.filter(r => r.payToken).length, "tokens are distinct");

    const second = await backfillPayTokens(store, true);
    assert.equal(second.given, 0);
    assert.equal(second.households, 0);
    assert.deepEqual((await rows(mine)).map(r => r.payToken), after.map(r => r.payToken), "a second run changes nothing, another household is untouched");
        assert.deepEqual((await rows(theirs)).map(r => r.payToken), before.map(r => r.payToken), "a household whose invoices already have links keeps exactly those");
    assert.ok(before.some(r => r.payToken), "the fixture household had links to keep");
    console.log("✓ backfill: dry run writes nothing, sent USD invoices get a link, yen is skipped, a second run changes nothing, another household is untouched");
  } finally {
    await pg.close();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
