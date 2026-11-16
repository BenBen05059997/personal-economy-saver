import { and, eq } from "drizzle-orm";
import { fromRateMicro, toRateMicro } from "./money";
import { requireHousehold, type Db } from "./household";
import { fxRates } from "./schema";
import { z } from "zod";

const ECB_DAILY = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";

export function parseReferenceRate(xml: string) {
  const date = z.string().date().parse(/\btime=['"]([\d-]+)['"]/.exec(xml)?.[1]);
  function quote(currency: string) {
    const pattern = new RegExp("currency=['\"]" + currency + "['\"]\\s+rate=['\"]([0-9.]+)['\"]");
    return z.coerce.number().finite().positive().parse(pattern.exec(xml)?.[1]);
  }
  return { date, rateMicro: toRateMicro(quote("JPY") / quote("USD")) };
}

export async function fetchReferenceRate() {
  const response = await fetch(ECB_DAILY, { signal: AbortSignal.timeout(10000), cache: "no-store" });
  if (!response.ok) throw new Error("ECB reference rate unavailable");
  return parseReferenceRate(await response.text());
}

export async function storeReferenceRate(db: Db, id: string, rate: ReturnType<typeof parseReferenceRate>) {
  await db.insert(fxRates).values({ householdId: requireHousehold(id), base: "USD", quote: "JPY", ...rate })
    .onConflictDoNothing();
}

/** Every USD reference rate the household holds into its home currency (the yen rate for a dollar household), for reading a rate on any day. */
export async function referenceRates(db: Db, householdId: string, home: string): Promise<{ date: string; perUsd: number }[]> {
  const rows = await db.select({ date: fxRates.date, rateMicro: fxRates.rateMicro }).from(fxRates)
    .where(and(eq(fxRates.householdId, requireHousehold(householdId)), eq(fxRates.base, "USD"), eq(fxRates.quote, home === "USD" ? "JPY" : home)));
  return rows.map(r => ({ date: r.date, perUsd: fromRateMicro(r.rateMicro) }));
}

/** The latest rate in `rates` on or before `date`, or null with none. */
export function rateOnDay(rates: { date: string; perUsd: number }[], date: string): number | null {
  const best = rates.filter(r => r.date <= date).sort((a, b) => b.date.localeCompare(a.date))[0];
  return best?.perUsd ?? null;
}

/** What a paid USD invoice converts at: the rate stored on the row (what the payout was converted at), else the reference rate of its paid day, else null. */
export function paidInvoicePerUsd(row: { fxRateMicro: number | null; paidOn: string }, rates: { date: string; perUsd: number }[]): number | null {
  return row.fxRateMicro !== null ? fromRateMicro(row.fxRateMicro) : rateOnDay(rates, row.paidOn);
}
