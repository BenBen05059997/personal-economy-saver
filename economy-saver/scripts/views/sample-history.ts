// The sample's paid history (D77): Ben and every Try it household are seeded with sixteen paid invoices spread over June to early November,
// so the months of income have something to show, while every number the app already says stays the same. Fictional data only; PGlite.
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { and, eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { foreignCostInputs } from "@/db/fx-cost";
import { loadMoneyState } from "@/db/household";
import { loadIncome } from "@/db/income";
import { seedBen } from "@/db/seed";
import { foreignCosts } from "@/lib/money/fx-cost";
import { low, series, safeToSpend } from "@/lib/money/runway";
import { homeSentence } from "@/lib/money/sentence";
import { benMoney } from "@/lib/sample/ben";

let passed = 0;
async function check(name: string, run: () => void | Promise<void>) { await run(); passed++; console.log(`✓ ${name}`); }
const TODAY = "2026-11-14";

async function main() {
  const pg = new PGlite({ extensions: { pg_trgm } });
  const db = drizzle(pg, { schema });
  try {
    await migrate(db, { migrationsFolder: "./drizzle" });
    const hid = await seedBen(db, { isDemo: true });
    const state = await loadMoneyState(db, hid, TODAY);
    const paid = await db.select().from(schema.invoices).where(and(eq(schema.invoices.householdId, hid), eq(schema.invoices.status, "paid")));

    await check("sixteen paid invoices, every one paid between Jun 1 and Nov 6", () => {
      assert.equal(paid.length, 16);
      for (const invoice of paid) assert.ok(invoice.paidOn! >= "2026-06-01" && invoice.paidOn! <= "2026-11-06", `${invoice.number} paid ${invoice.paidOn}`);
    });

    await check("each client's days to pay are Ben's sample's", () => {
      const days = (name: string) => state.clients.find(c => c.name.startsWith(name))!.daysToPay;
      assert.deepEqual(days("Beacon"), [1, 2, 3, 2, 2, 1]);
      assert.deepEqual(days("Northwind"), [10, 13, 12, 11, 16]);
      assert.deepEqual(days("Acme"), [12, 14, 13, 25, 16]);
    });

    await check("the sentence, the late low and safe to spend are what they were", () => {
      assert.match(homeSentence(state).text, /¥18,780 short on the 27th/);
      const worst = low(series(state, "worst"), state.today);
      assert.deepEqual([worst.amount, worst.date], [-18_780, "2026-11-27"]);
      assert.equal(safeToSpend(state, 0).amount, 0);
    });

    await check("the money state's invoice list is the sample's three: no paid history is in it", () => {
      assert.deepEqual(state.invoices.map(i => [i.item, i.status, i.amountUsd, i.sentOn ?? null]),
        benMoney.invoices.map(i => [i.item, i.status, i.amountUsd, i.sentOn ?? null]));
    });

    await check("the foreign costs: sixteen payouts, ¥111,637", async () => {
      const costs = foreignCosts(await foreignCostInputs(db, hid, TODAY));
      assert.equal(costs.payoutTotals.count, 16);
      assert.equal(costs.payoutTotals.costMinor, 111_637);
    });

    await check("income over the last six months: sixteen rows, and every month June to November has one", async () => {
      const income = await loadIncome(db, hid, { from: "2026-06-01", to: "2026-11-30" });
      assert.equal(income.length, 16);
      assert.ok(income.every(row => row.homeMinor !== null && row.sentOn !== null));
      for (const month of ["2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11"]) assert.ok(income.some(row => row.paidOn.startsWith(month)), month);
      assert.equal(income.reduce((sum, row) => sum + row.homeMinor!, 0), 1_590_000, "$10,600 at the sample's rate");
    });
  } finally {
    await pg.close();
  }
  console.log(`\n${passed} checks passed`);
}

export const done = main();
