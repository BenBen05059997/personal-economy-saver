import { and, desc, eq, inArray, isNotNull, isNull, lt, lte, or } from "drizzle-orm";
import { z } from "zod";
import { closedInvoiceStates } from "@/lib/paypal/status";
import { env } from "@/lib/env";
import { paypalFetch } from "@/lib/paypal/client";
import { type Db, requireHousehold } from "./household";
import { convertMinor, fromRateMicro } from "./money";
import { amountMinor } from "./settings";
import { fxRates, households, invoices, members, paypalConnections } from "./schema";
import { beginMoneyChange, observeRunway } from "./runway-events";

const remoteInvoice = z.object({ id: z.string(), status: z.string().min(1), detail: z.object({
  invoice_number: z.string().min(1), payment_term: z.object({ due_date: z.string().date().optional() }).optional(),
}) });
const timestamp = z.string().datetime({ offset: true });
const balanceReport = z.object({
  account_id: z.string().min(1), as_of_time: timestamp, last_refresh_time: timestamp,
  balances: z.array(z.object({ available_balance: z.object({ currency_code: z.string(), value: z.string() }) })),
});
type BalanceReport = z.infer<typeof balanceReport>;
type InvoiceReport = z.infer<typeof remoteInvoice>;
type ReadRemote = (path: string, signal: AbortSignal) => Promise<unknown>;
const sandboxRead: ReadRemote = (path, signal) => paypalFetch(path, { signal });
const waitingPayment = ["PAID", "PARTIALLY_PAID", "PAYMENT_PENDING", "PAID_EXTERNAL", "MARKED_AS_PAID"];
const COOLDOWN_MS = 5 * 60_000;
class FreshnessError extends Error {}

async function readBalance(db: Db, hid: string, report: BalanceReport, currency: string, asOf: Date) {
  let total = 0, fx: number | null = null;
  for (const { available_balance: money } of report.balances) {
    if (!/^-?\d+(\.\d{1,2})?$/.test(money.value)) throw new FreshnessError("Invalid available balance in PayPal’s report.");
    if (Number(money.value) === 0) continue;
    if (!["JPY", "USD"].includes(money.currency_code)) throw new FreshnessError("PayPal reports an unsupported balance currency.");
    const raw = money.currency_code === "JPY" ? money.value.replace(/\.0{1,2}$/, "") : money.value;
    const amount = amountMinor(raw, money.currency_code);
    if (money.currency_code === currency) total += amount;
    else {
      const [rate] = await db.select({ rate: fxRates.rateMicro }).from(fxRates)
        .where(and(eq(fxRates.householdId, hid), eq(fxRates.base, "USD"), eq(fxRates.quote, "JPY"), lte(fxRates.date, asOf.toISOString().slice(0, 10))))
        .orderBy(desc(fxRates.date)).limit(1);
      if (!rate) throw new FreshnessError("A household USD/JPY rate is needed for the PayPal balance.");
      fx = rate.rate;
      total += convertMinor(amount, money.currency_code, currency, fromRateMicro(fx));
    }
  }
  if (!Number.isSafeInteger(total)) throw new FreshnessError("PayPal’s balance exceeds the supported range.");
  return { total, fx };
}

/** The caller is Home. A short persisted lease includes failed attempts and concurrent opens. */
export async function refreshPayPal(db: Db, id: string, read: ReadRemote = sandboxRead, now = new Date()) {
  const hid = requireHousehold(id);
  const [connection] = await db.select({ id: paypalConnections.id, demo: households.isDemo, stale: paypalConnections.refreshError,
    asOf: paypalConnections.balanceAsOf }).from(paypalConnections)
    .innerJoin(members, and(eq(members.id, paypalConnections.memberId), eq(members.householdId, hid)))
    .innerJoin(households, eq(households.id, paypalConnections.householdId))
    .where(and(eq(paypalConnections.householdId, hid), eq(members.role, "owner")));
  if (!connection) return { stale: "Household PayPal connection is missing.", asOf: null };
  const where = and(eq(paypalConnections.householdId, hid), eq(paypalConnections.id, connection.id));
  const lease = await db.update(paypalConnections).set({ refreshAttemptedAt: now, refreshError: "Refreshing PayPal. Showing stored household data." })
    .where(and(where, or(isNull(paypalConnections.refreshAttemptedAt), lt(paypalConnections.refreshAttemptedAt, new Date(now.getTime() - COOLDOWN_MS)))))
    .returning({ id: paypalConnections.id });
  if (!lease.length) {
    const [latest] = await db.select({ stale: paypalConnections.refreshError, asOf: paypalConnections.balanceAsOf }).from(paypalConnections).where(where);
    return latest ?? { stale: "Household PayPal connection is missing.", asOf: null };
  }
  const ownsLease = and(where, eq(paypalConnections.refreshAttemptedAt, now));
  try {
    const bound = process.env.PAYPAL_BALANCE_HOUSEHOLD_ID?.trim().toLowerCase();
    const balanceEnabled = !connection.demo && bound === hid;
    let stale: string | null = null;
    if (!connection.demo && !bound) stale = "PAYPAL_BALANCE_HOUSEHOLD_ID is not set. Showing the stored PayPal balance.";
    else if (!connection.demo && !z.string().uuid().safeParse(bound).success) stale = "PAYPAL_BALANCE_HOUSEHOLD_ID must be a household UUID.";
    const tracked = await db.select({ id: invoices.id, remote: invoices.paypalInvoiceId }).from(invoices)
      .where(and(eq(invoices.householdId, hid), inArray(invoices.status, ["draft", "sent"]), isNotNull(invoices.paypalInvoiceId)));
    // Fictional seeded invoices have no PayPal id. Never enumerate the merchant’s invoices.
    const signal = AbortSignal.timeout(8000);
    if (balanceEnabled || tracked.length) {
      try { env(); } catch (error) { throw new FreshnessError((error as Error).message); }
    }
    const snapshots: { id: string; data: InvoiceReport }[] = [];
    for (let start = 0; start < tracked.length; start += 3) {
      const batch = await Promise.all(tracked.slice(start, start + 3).map(async invoice => {
        const data = remoteInvoice.parse(await read("/v2/invoicing/invoices/" + encodeURIComponent(invoice.remote!), signal));
        if (data.id !== invoice.remote) throw new FreshnessError("PayPal returned a different invoice. Keeping the stored data.");
        return { id: invoice.id, data };
      }));
      snapshots.push(...batch);
    }
    const awaiting = snapshots.some(({ data }) => waitingPayment.includes(data.status));
    if (awaiting) stale = "A PayPal payment needs verification. Showing the last verified household balance.";
    const report = balanceEnabled && !awaiting ? balanceReport.parse(await read("/v1/reporting/balances", signal)) : null;
    return await db.transaction(async tx => {
      await beginMoneyChange(tx, hid);
      const [current] = await tx.select().from(paypalConnections).where(ownsLease).for("update");
      if (!current) return { stale: "PayPal refresh superseded.", asOf: connection.asOf };
      for (const { id: invoiceId, data } of snapshots) {
        await tx.update(invoices).set({
          paypalStatus: data.status, paypalFetchedAt: now, number: data.detail.invoice_number,
          ...(closedInvoiceStates.includes(data.status) && { status: "closed" as const }),
          ...(!connection.demo && data.detail.payment_term?.due_date && { dueOn: data.detail.payment_term.due_date }),
        }).where(and(eq(invoices.householdId, hid), eq(invoices.id, invoiceId), eq(invoices.paypalInvoiceId, data.id), inArray(invoices.status, ["sent", "draft"])));
      }
      let asOf = current.balanceAsOf;
      if (report) {
        const cutoff = new Date(Math.min(Date.parse(report.as_of_time), Date.parse(report.last_refresh_time)));
        if (current.merchantId && current.merchantId !== report.account_id) throw new FreshnessError("Sandbox merchant changed. Keeping the stored balance.");
        if ((current.latestCreditAt && current.latestCreditAt > cutoff) || (asOf && asOf > cutoff)) {
          stale = "PayPal’s balance report predates a newer household balance. Keeping the stored balance.";
        } else {
          const { total, fx } = await readBalance(tx, hid, report, current.balanceCurrency, cutoff);
          await tx.update(paypalConnections).set({ balanceMinor: total, balanceAsOf: cutoff, balanceFxRateMicro: fx,
            merchantId: report.account_id }).where(ownsLease);
          asOf = cutoff;
        }
      }
      await tx.update(paypalConnections).set({ ...(snapshots.length || report ? { fetchedAt: now } : {}), refreshError: stale }).where(ownsLease);
      await observeRunway(tx, hid);
      return { stale, asOf };
    });
  } catch (error) {
    const stale = error instanceof FreshnessError ? error.message : "PayPal could not refresh. Showing the last stored household data.";
    await db.update(paypalConnections).set({ refreshError: stale }).where(ownsLease);
    return { stale, asOf: connection.asOf };
  }
}
