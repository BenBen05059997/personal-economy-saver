import { toRateMicro } from "./money";
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
