// Statement import (D53): the CSV reader in lib/import/csv.ts (quotes, BOM, CRLF, Japanese headers, Shift_JIS, the date
// shapes, credits and unreadable rows, the limits) and importCharges in PGlite (rows added once, a second import skips them
// all, another household's card refused, one Activity event). Fictional data only (D20); no credentials.
// Run from the project root: npx tsx --tsconfig ./tsconfig.json scripts/csv-import-test.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "@/db/schema";
import { importCharges } from "@/db/import-charges";
import { InputError } from "@/db/input-error";
import { seedBen } from "@/db/seed";
import { decodeStatement, guessColumns, IMPORT_MAX_BYTES, IMPORT_MAX_ROWS, parseCsv, readDate, readRows, readStatement } from "@/lib/import/csv";

const fixture = (name: string) => readFileSync(`scripts/fixtures/${name}`);
const charges = (r: ReturnType<typeof readRows>) => r.rows.filter(x => !x.problem && !x.skipped).map(({ date, merchant, amountMinor, category }) => ({ date, merchant, amountMinor, category }));

function statementOf(bytes: Uint8Array) {
  const decoded = decodeStatement(bytes);
  assert.ok(!("problem" in decoded), "decoded");
  const statement = readStatement(decoded.text);
  assert.ok(!("problem" in statement), "statement");
  return { encoding: decoded.encoding, statement };
}

async function main() {
  let passed = 0;
  async function check(name: string, run: () => void | Promise<void>) { await run(); passed++; console.log(`✓ ${name}`); }

  // ------------------------------------------------------------ the reader, pure
  await check("parseCsv: quoted commas, doubled quotes, a line break inside quotes, CRLF, CR, a BOM and blank lines", () => {
    assert.deepEqual(parseCsv('﻿a,b\r\n"x, y","say ""hi"""\r\n\r\n"two\nlines",3\r4,5'), [["a", "b"], ["x, y", 'say "hi"'], ["two\nlines", "3"], ["4", "5"]]);
    assert.deepEqual(parseCsv("date\tname\tamount\n2026-11-01\tShop\t100\n"), [["date", "name", "amount"], ["2026-11-01", "Shop", "100"]], "a tab-separated export");
  });
  await check("guessColumns: Japanese card and bank headers, English bank headers, and nothing when no word matches", () => {
    assert.deepEqual(guessColumns(["利用日", "利用店名・商品名", "利用者", "支払区分", "利用金額", "支払金額"]), { date: 0, name: 1, amount: 4 });
    assert.deepEqual(guessColumns(["取引日", "摘要", "出金", "入金", "残高"]), { date: 0, name: 1, amount: 2 });
    assert.deepEqual(guessColumns(["Transaction Date", "Posted Date", "Description", "Category", "Amount"]), { date: 0, name: 2, amount: 4 });
    assert.deepEqual(guessColumns(["Ｄａｔｅ", "Merchant", "Debit", "Credit"]), { date: 0, name: 1, amount: 2 }, "full-width header words");
    assert.deepEqual(guessColumns(["a", "b"]), { date: null, name: null, amount: null });
  });
  await check("readDate: 2026/11/05, 2026-11-05, 20261105, 2026年11月5日, a time after the date; 11/05/2026 only when the file settles the order", () => {
    for (const cell of ["2026/11/05", "2026-11-05", "20261105", "2026/11/5", "2026年11月5日", "2026/11/05 13:20", "２０２６/１１/０５"]) assert.equal(readDate(cell, null), "2026-11-05", cell);
    assert.equal(readDate("11/05/2026", null), null, "ambiguous alone");
    assert.equal(readDate("11/05/2026", "md"), "2026-11-05");
    assert.equal(readDate("11/05/2026", "dm"), "2026-05-11");
    assert.equal(readDate("28/10/2026", null), "2026-10-28", "a day over 12 settles itself");
    assert.equal(readDate("05/05/2026", null), "2026-05-05", "the same either way");
    for (const bad of ["2026/13/40", "2026/02/30", "yesterday", ""]) assert.equal(readDate(bad, null), null, bad);
  });
  await check("the UTF-8 fixture: BOM, a card line above the header, Japanese headers, quotes; credits skipped, a bad date unreadable", () => {
    const { encoding, statement } = statementOf(fixture("sample-statement-utf8.csv"));
    assert.equal(encoding, "UTF-8");
    assert.equal(statement.headerIndex, 1, "the issuer's card line is above the header");
    assert.deepEqual(statement.picks, { date: 0, name: 1, amount: 4 });
    const read = readRows(statement.body, statement.picks, "JPY", statement.headerIndex + 2);
    assert.deepEqual([read.readable, read.skipped, read.unreadable], [7, 1, 1]);
    assert.deepEqual(read.rows[0], { line: 3, date: "2026-10-03", merchant: "Minato Fresh Market", amountMinor: 3480, category: "food" });
    assert.equal(read.rows[1].merchant, "Kissa Hoshi, Nakameguro");
    assert.equal(read.rows[2].merchant, "東京フィクション地下鉄 定期");
    assert.equal(read.rows[3].skipped, "credit");
    assert.equal(read.rows[4].merchant, 'Studio "Sora" Prints');
    assert.equal(read.rows[7].problem, "The date can't be read as a day");
    assert.deepEqual(read.rows[8], { line: 11, date: "2026-11-02", merchant: "FICTIONAL DENKI", amountMinor: 8140, category: "utilities" }, "full-width text is NFKC");
  });
  await check("the Shift_JIS fixture: invalid UTF-8 is read as Shift_JIS; a bank export with 出金, 20261001 dates and a deposit skipped", () => {
    const bytes = fixture("sample-statement-sjis.csv");
    assert.throws(() => new TextDecoder("utf-8", { fatal: true }).decode(bytes), "the fixture is not UTF-8");
    const { encoding, statement } = statementOf(bytes);
    assert.equal(encoding, "Shift_JIS");
    assert.deepEqual(statement.header, ["取引日", "摘要", "出金", "入金", "残高"]);
    const read = readRows(statement.body, statement.picks, "JPY");
    assert.deepEqual([read.readable, read.skipped, read.unreadable], [2, 1, 0]);
    assert.deepEqual(charges(read), [
      { date: "2026-10-01", merchant: "カ)フィクション電気", amountMinor: 7560, category: "utilities" },
      { date: "2026-10-04", merchant: "フィクション薬局", amountMinor: 1980, category: "health" },
    ]);
  });
  await check("a US export: month-first dates settled by the file, dollars to cents, (12.00) and -5.00 as credits, a mark of another currency unreadable", () => {
    const rows = parseCsv("Date,Description,Amount\n10/28/2026,Fictional Grocery,$45.10\n11/02/2026,Fictional Bookshop,12.5\n11/03/2026,Refund,(12.00)\n11/04/2026,Return,-5.00\n11/04/2026,Fictional Ryokan,¥8000\n");
    const read = readRows(rows.slice(1), guessColumns(rows[0]), "USD");
    assert.deepEqual(charges(read), [
      { date: "2026-10-28", merchant: "Fictional Grocery", amountMinor: 4510, category: "food" },
      { date: "2026-11-02", merchant: "Fictional Bookshop", amountMinor: 1250, category: "other" },
    ]);
    assert.deepEqual([read.readable, read.skipped, read.unreadable], [2, 2, 1]);
    assert.match(read.rows[4].problem ?? "", /Enter an amount in dollars/);
  });
  await check("readRows: a missing column pick makes every row unreadable with what to choose; amounts over the limit are unreadable", () => {
    const read = readRows([["2026-11-01", "Shop", "100"]], { date: 0, name: null, amount: 2 }, "JPY");
    assert.equal(read.rows[0].problem, "Choose the shop or description column");
    const big = readRows([["2026-11-01", "Shop", "100,000,001"]], { date: 0, name: 1, amount: 2 }, "JPY");
    assert.equal(big.rows[0].problem, "Enter an amount up to ¥100,000,000");
  });
  await check("limits: over 1 MB and over 2,000 rows are refused with words; an empty file and a header alone too", () => {
    assert.match((decodeStatement(new Uint8Array(IMPORT_MAX_BYTES + 1)) as { problem: string }).problem, /over 1 MB/);
    assert.match((decodeStatement(new Uint8Array(0)) as { problem: string }).problem, /empty/);
    const many = "date,name,amount\n" + Array.from({ length: IMPORT_MAX_ROWS + 1 }, (_, i) => `2026-10-01,Shop ${i},100`).join("\n");
    assert.match((readStatement(many) as { problem: string }).problem, /2,001 rows; up to 2,000/);
    assert.ok(!("problem" in readStatement(many.split("\n").slice(0, IMPORT_MAX_ROWS + 1).join("\n"))), "2,000 rows are fine");
    assert.match((readStatement("date,name,amount\n") as { problem: string }).problem, /no rows under a header/);
  });

  // ------------------------------------------------------------ importCharges, PGlite
  const pg = new PGlite();
  const db = drizzle(pg, { schema });
  try {
    await migrate(db, { migrationsFolder: "./drizzle" });
    const A = await seedBen(db, { isDemo: true, name: "Import A household" });
    const B = await seedBen(db, { isDemo: true, name: "Import B household" });
    const cardOf = async (hid: string, label: string) => (await db.select().from(schema.cards).where(and(eq(schema.cards.householdId, hid), eq(schema.cards.label, label))))[0].id;
    const cardB = await cardOf(A, "Card B"), otherCard = await cardOf(B, "Card B");
    const { statement } = statementOf(fixture("sample-statement-utf8.csv"));
    const rows = charges(readRows(statement.body, statement.picks, "JPY"));
    const countOn = async (hid: string, card: string) => (await db.select().from(schema.charges).where(and(eq(schema.charges.householdId, hid), eq(schema.charges.cardId, card)))).length;
    const before = await countOn(A, cardB);
    const statementsBefore = await db.select().from(schema.cardStatements).where(eq(schema.cardStatements.householdId, A));

    await check("importCharges: the fixture's 7 charges are added to Card B, confirmed, manual, by import, personal, with the guessed categories", async () => {
      assert.deepEqual(await importCharges(db, A, cardB, rows, { madeBy: "import" }), { added: 7, skipped: 0 });
      const added = await db.select().from(schema.charges).where(and(eq(schema.charges.householdId, A), eq(schema.charges.cardId, cardB), eq(schema.charges.madeBy, "import")));
      assert.equal(added.length, 7);
      assert.equal(await countOn(A, cardB), before + 7);
      assert.ok(added.every(c => c.status === "confirmed" && c.source === "manual" && !c.shared && c.businessBp === 0 && c.currency === "JPY"));
      assert.equal(added.filter(c => c.merchant === "Kissa Hoshi Nakameguro").length, 2, "two identical coffees on one day stay two");
      assert.equal(added.find(c => c.merchant === "FICTIONAL DENKI")?.category, "utilities");
      assert.deepEqual(await db.select().from(schema.cardStatements).where(eq(schema.cardStatements.householdId, A)), statementsBefore, "stored statements are the issuer's bill and stay as they are");
    });
    await check("one charges_imported event in Activity with the count, the card and the total", async () => {
      const events = await db.select().from(schema.events).where(and(eq(schema.events.householdId, A), eq(schema.events.kind, "charges_imported")));
      assert.equal(events.length, 1);
      assert.equal(events[0].title, "Imported 7 charges to Card B from a statement");
      assert.equal(events[0].madeBy, "import");
      assert.equal(events[0].amountMinor, 3480 + 620 + 10_000 + 2200 + 620 + 620 + 8140);
    });
    await check("importing the same file again adds nothing and records no event; a file with one new row adds that row only", async () => {
      assert.deepEqual(await importCharges(db, A, cardB, rows, { madeBy: "import" }), { added: 0, skipped: 7 });
      assert.equal(await countOn(A, cardB), before + 7);
      const extra = { date: "2026-11-03", merchant: "Fictional Udon Stand", amountMinor: 890, category: "food" as const };
      assert.deepEqual(await importCharges(db, A, cardB, [...rows.map(r => ({ ...r, merchant: r.merchant.toUpperCase() })), extra], { madeBy: "import" }), { added: 1, skipped: 7 }, "the name matches without case");
      const events = await db.select().from(schema.events).where(and(eq(schema.events.householdId, A), eq(schema.events.kind, "charges_imported")));
      assert.deepEqual(events.map(e => e.title).sort(), ["Imported 1 charge to Card B from a statement (7 already there)", "Imported 7 charges to Card B from a statement"]);
    });
    await check("another household's card is refused and nothing is written to either household", async () => {
      const otherBefore = await countOn(B, otherCard);
      await assert.rejects(importCharges(db, A, otherCard, rows, { madeBy: "import" }), (e: unknown) => e instanceof InputError && e.message === "Choose a card of this household");
      assert.equal(await countOn(B, otherCard), otherBefore);
      assert.equal((await db.select().from(schema.events).where(and(eq(schema.events.householdId, B), eq(schema.events.kind, "charges_imported")))).length, 0);
    });
    await check("rows dated after the household's today, over the yen limit, or more than 500 are refused before anything is saved", async () => {
      const n = await countOn(A, cardB);
      await assert.rejects(importCharges(db, A, cardB, [{ date: "2026-11-20", merchant: "Fictional Future", amountMinor: 100, category: "other" }], { madeBy: "import" }),
        (e: unknown) => e instanceof InputError && e.message === "One row is dated after today (2026-11-14). A statement lists charges already made; check the date column.");
      await assert.rejects(importCharges(db, A, cardB, [{ date: "2026-11-01", merchant: "Fictional Big", amountMinor: 100_000_001, category: "other" }], { madeBy: "import" }),
        (e: unknown) => e instanceof InputError && e.message === "Enter an amount up to ¥100,000,000");
      await assert.rejects(importCharges(db, A, cardB, Array.from({ length: 501 }, () => rows[0]), { madeBy: "import" }));
      await assert.rejects(importCharges(db, A, cardB, [], { madeBy: "import" }));
      assert.equal(await countOn(A, cardB), n);
    });
    console.log(`CSV import checks passed (${passed}).`);
  } finally {
    await pg.close();
  }
}

main().catch(error => {
  console.error("CSV import tests failed", error);
  process.exit(1);
});
