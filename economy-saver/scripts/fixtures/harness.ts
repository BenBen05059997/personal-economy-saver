// The pieces every database suite shares: the check runner, the in-process database, Supabase Vault's SQL interface, the
// fictional PayPal settings, the readers and builders the suites repeat. Not under scripts/views/, which the views runner
// executes as suites, and not a suite itself.
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { and, asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import type { Db } from "@/db/household";
import * as schema from "@/db/schema";
import type { CaptureOrder } from "@/lib/paypal/contracts";
import type { homeSentence } from "@/lib/money/sentence";
import type { Bill } from "@/lib/money/types";

/**
 * The checks of one suite. A check that throws stops the suite, unless `keepGoing` is set: then the failure is printed
 * and the next check runs (the caller reads `tally` to set the exit code).
 */
export function createChecks(options: { keepGoing?: boolean } = {}) {
  const tally = { passed: 0, total: 0 };
  async function check(name: string, run: () => void | Promise<void>) {
    tally.total += 1;
    try {
      await run();
      tally.passed += 1;
      console.log(`✓ ${name}`);
    } catch (error) {
      if (!options.keepGoing) throw error;
      console.log(`✗ ${name}\n    ${(error as Error).message.split("\n").slice(0, 12).join("\n    ")}`);
    }
  }
  return { check, tally };
}

/** A database error naming the constraint (drizzle wraps the driver's error in `cause`). */
export const violates = (constraint: string) => (error: unknown) => String((error as { cause?: { message?: string } }).cause?.message ?? "").includes(constraint);

/** The checks of a suite with no database: each runs at once and a failure stops the run. */
export function createSyncChecks() {
  const tally = { passed: 0 };
  function check(name: string, run: () => void) {
    run();
    tally.passed += 1;
    console.log(`✓ ${name}`);
  }
  return { check, tally };
}

/** Supabase Vault's public SQL interface, represented only in a disposable database. */
export const VAULT_SQL = `create schema vault;
  create table vault.secrets(id uuid primary key default gen_random_uuid(), name text unique, decrypted_secret text);
  create view vault.decrypted_secrets as select * from vault.secrets;
  create function vault.create_secret(value text, label text, description text) returns uuid language plpgsql as $$
    declare secret_id uuid; begin insert into vault.secrets(name,decrypted_secret) values(label,value) returning id into secret_id; return secret_id; end $$;
  create function vault.update_secret(secret_id uuid, value text, label text) returns void language sql as $$
    update vault.secrets set decrypted_secret=value,name=label where id=secret_id $$;`;

/** An in-process Postgres with every migration applied (and Vault's SQL interface when asked). Close `pg` when the suite ends. */
export async function openDb(options: { vault?: boolean } = {}) {
  const pg = new PGlite({ extensions: { pg_trgm } });
  const db = drizzle(pg, { schema });
  await migrate(db, { migrationsFolder: "./drizzle" });
  if (options.vault) await pg.exec(VAULT_SQL);
  return { pg, db, store: db as unknown as Db };
}

/** A household's events of one kind, in the order they were written. */
export const eventsOf = (db: unknown) => (householdId: string, kind: string) =>
  (db as ReturnType<typeof drizzle<typeof schema>>).select().from(schema.events)
    .where(and(eq(schema.events.householdId, householdId), eq(schema.events.kind, kind)))
    .orderBy(asc(schema.events.createdAt), asc(schema.events.id));

/** The first row of a query. */
export const first = async <T,>(rows: Promise<T[]>) => (await rows)[0];

/** Settings → Bills → Edit with only whose changed. */
export async function setWhose(db: Db, hid: string, billId: string, memberId: string | null, paidByMemberId: string | null = null) {
  const { billEditInput, updateBill } = await import("@/db/bills"); // loaded on use: a suite that stubs modules loads the app after its stubs
  const [row] = await db.select().from(schema.bills).where(and(eq(schema.bills.householdId, hid), eq(schema.bills.id, billId)));
  return updateBill(db, hid, billEditInput.parse({ id: billId, biller: row.biller, amount: String(row.amountMinor), due: row.due, category: row.category, businessBp: row.businessBp, memberId, paidByMemberId }), { madeBy: "form" });
}

/** The two strings a sentence is made of (its other parts are tested in pots-test). */
export const lines = (sentence: ReturnType<typeof homeSentence>) => ({ lead: sentence.lead, emphasis: sentence.emphasis });

/** A confirmed, business-free bill with the given fields. */
export const bill = (over: Partial<Bill> & Pick<Bill, "id" | "biller" | "amount" | "due" | "category">): Bill => ({ businessBp: 0, status: "confirmed", ...over });

/** Webhook events that must not take a payment get this one: it fails the test if called. */
export const noCapture: CaptureOrder = async () => { throw new Error("A payment must not be taken here"); };

/** The fictional PayPal settings the env schema reads when the PayPal modules run. */
export const PAYPAL_TEST_ENV = {
  PAYPAL_ENVIRONMENT: "SANDBOX", PAYPAL_CLIENT_ID: "client-fictional", PAYPAL_CLIENT_SECRET: "secret-fictional",
  PAYPAL_PARTNER_ATTRIBUTION_ID: "FIPA_TEST_BN", PAYPAL_PARTNER_MERCHANT_ID: "PARTNERFICTIONAL", PAYPAL_WEBHOOK_ID: "WH-ID-FICTIONAL",
  APP_URL: "https://fipa.example.test",
} as const;
export function setPayPalEnv() { Object.assign(process.env, PAYPAL_TEST_ENV); }

/** Remember the named settings; the returned function puts each one back (or removes it if it was not set). */
export function saveEnv(names: readonly string[]) {
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
  return () => { for (const [name, value] of Object.entries(previous)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; } };
}

/** Components import stylesheets; a test only renders markup, so a stylesheet loads as nothing (a CSS module as its own class names). */
export function stubStylesheets() {
  const extensions = require.extensions as unknown as Record<string, (module: { exports: unknown }) => void>;
  extensions[".css"] = module => { module.exports = new Proxy({}, { get: (_, key) => String(key) }); };
}

/** Render a component to markup inside a router that does nothing. */
export const renderWithRouter = (element: ReturnType<typeof createElement>) => {
  const router = { push() {}, replace() {}, refresh() {}, back() {}, forward() {}, prefetch() {} };
  return renderToStaticMarkup(createElement(AppRouterContext.Provider, { value: router as never }, element));
};
