import { type SQL, and, desc, eq, isNull, lt, lte, or } from "drizzle-orm";
import { z } from "zod";
import { paypalRead } from "@/lib/paypal/client";
import type { PayPalCall } from "@/lib/paypal/contracts";
import { type IncomingPayment, incomingPayments } from "@/lib/paypal/transactions";
import { clientInput, insertClient } from "./clients";
import { type Db, recordEvent, requireHousehold, usdRateMicro, withHousehold } from "./household";
import { paidTitle } from "@/lib/money/paid-title";
import { convertMinor, fromMinor, fromRateMicro, toMinor } from "./money";
import { clients, fxRates, invoices, paypalConnections } from "./schema";
import { ownerPayPal } from "./paypal-connection";
import { fillPots } from "./pots";
import { beginMoneyChange, observeRunway } from "./runway-events";

const timestamp = z.string().datetime({ offset: true });
// account_id is optional because the field naming the account is not yet confirmed against a real seller's report.
const balanceReport = z.object({
  account_id: z.string().min(1).optional(), as_of_time: timestamp, last_refresh_time: timestamp,
  balances: z.array(z.object({ available_balance: z.object({ currency_code: z.string(), value: z.string() }) })),
});
type BalanceReport = z.infer<typeof balanceReport>;
const COOLDOWN_MS = 5 * 60_000;
const DAY_MS = 86_400_000;
// PayPal limits one search to 31 days of initiation dates, not how far back the history goes, so the read walks in slices of just under that.
const SLICE_MS = 31 * DAY_MS - 60_000;
const MIN_SLICE_MS = 3_600_000;
// A payment can sit pending (an eCheck, a review) for several days and is searched by its initiation date, so every read starts a week
// before the last marker. Rows are deduped on the capture id, and a household's week is a page or two, so the extra rows cost little.
const SEARCH_OVERLAP_MS = 7 * DAY_MS;
// A slice with more pages than this is halved; it bounds one slice to a handful of requests.
const SEARCH_MAX_PAGES = 10;
// What a person waits on at Home: each PayPal call gets 8 seconds, no new slice starts after 10 seconds, and nothing runs past 20.
const CALL_TIMEOUT_MS = 8_000;
const SLICE_BUDGET_MS = 10_000;
const HARD_TIMEOUT_MS = 20_000;
class FreshnessError extends Error {}

async function readBalance(db: Db, hid: string, report: BalanceReport, currency: string, asOf: Date) {
  let total = 0, fx: number | null = null;
  for (const { available_balance: money } of report.balances) {
    // The forecast is in the currencies fipa supports; a balance held in another is left out of the number, not converted.
    if (!["JPY", "USD"].includes(money.currency_code)) continue;
    if (!/^-?\d+(\.\d{1,2})?$/.test(money.value)) throw new FreshnessError("Invalid available balance in PayPal’s report.");
    if (Number(money.value) === 0) continue;
    const raw = money.currency_code === "JPY" ? money.value.replace(/\.0{1,2}$/, "") : money.value;
    // PayPal's own figure, already checked against the pattern above: not typed by a person, so the form limits do not apply.
    const amount = toMinor(Number(raw), money.currency_code);
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

/**
 * The caller is Home. Only a household whose PayPal is connected (D76) reads PayPal, as the seller: the balance (D37) and the
 * payments that arrived (D64). Every other household, Try it included, makes no PayPal call and keeps the balance its verified
 * payments built. A short persisted lease includes failed attempts and concurrent opens.
 */
export async function refreshPayPal(db: Db, id: string, call: PayPalCall = paypalRead, now = new Date()) {
  const hid = requireHousehold(id);
  const claim = await withHousehold(db, hid, async tx => {
    const connection = await ownerPayPal(tx, hid);
    if (!connection) return { done: true, result: { stale: "Household PayPal connection is missing.", asOf: null } } as const;
    const where = and(eq(paypalConnections.householdId, hid), eq(paypalConnections.id, connection.id));
    // Not connected: nothing to read. Leave the attempt clock untouched so connecting is noticed at once.
    if (connection.connectionStatus !== "connected" || !connection.sellerMerchantId || !connection.connectedAt) {
      if (connection.refreshError !== null) await tx.update(paypalConnections).set({ refreshError: null }).where(where);
      return { done: true, result: { stale: null, asOf: connection.balanceAsOf } } as const;
    }
    const lease = await tx.update(paypalConnections).set({ refreshAttemptedAt: now, refreshError: "Refreshing PayPal. Showing stored household data." })
      .where(and(where, or(isNull(paypalConnections.refreshAttemptedAt), lt(paypalConnections.refreshAttemptedAt, new Date(now.getTime() - COOLDOWN_MS)))))
      .returning({ id: paypalConnections.id });
    if (!lease.length) {
      const [latest] = await tx.select({ stale: paypalConnections.refreshError, asOf: paypalConnections.balanceAsOf }).from(paypalConnections).where(where);
      return { done: true, result: latest ?? { stale: "Household PayPal connection is missing.", asOf: null } } as const;
    }
    return { done: false, connection: { seller: connection.sellerMerchantId, connectedAt: connection.connectedAt, readUntil: connection.transactionsReadUntil, asOf: connection.balanceAsOf, timeZone: connection.timeZone, home: connection.home }, where } as const;
  });
  if (claim.done) return claim.result;
  const { connection, where } = claim;
  const ownsLease = and(where, eq(paypalConnections.refreshAttemptedAt, now));
  const started = Date.now(), hard = AbortSignal.timeout(HARD_TIMEOUT_MS);
  const perCall = () => AbortSignal.any([AbortSignal.timeout(CALL_TIMEOUT_MS), hard]);
  let skipped = 0;
  try {
    let stale: string | null = null;
    const report = balanceReport.parse(await call({ method: "GET", path: "/v1/reporting/balances?currency_code=ALL", actAs: connection.seller }, perCall()));
    if (report.account_id && report.account_id !== connection.seller) throw new FreshnessError("PayPal’s report is for a different account. Keeping the stored balance.");
    // The first read goes 31 days back. Later reads start a week before the marker, however old the marker is.
    let cursor = connection.readUntil ? new Date(connection.readUntil.getTime() - SEARCH_OVERLAP_MS) : new Date(now.getTime() - SLICE_MS);
    let readTo = connection.readUntil;
    // Each finished slice is stored with the marker moved to its end, in one transaction; a failed slice stores nothing and stops the read.
    while (cursor < now) {
      if (Date.now() - started > SLICE_BUDGET_MS) { stale = "Still catching up on older PayPal payments. Showing what is read so far."; break; }
      let end = new Date(Math.min(cursor.getTime() + SLICE_MS, now.getTime()));
      let payments: IncomingPayment[] | null = null;
      while (!payments) {
        payments = [];
        for (let page = 1, pages = 1; page <= pages; page++) {
          const query = new URLSearchParams({ start_date: cursor.toISOString(), end_date: end.toISOString(),
            fields: "transaction_info,payer_info", page_size: "100", page: String(page) });
          const read = incomingPayments(await call({ method: "GET", path: "/v1/reporting/transactions?" + query, actAs: connection.seller }, perCall()));
          pages = read.pages;
          if (pages > SEARCH_MAX_PAGES) {
            const half = Math.floor((end.getTime() - cursor.getTime()) / 2);
            if (half < MIN_SLICE_MS) throw new FreshnessError("PayPal has too many payments in one hour to read. Keeping the stored state.");
            end = new Date(cursor.getTime() + half);
            payments = null;
            break;
          }
          payments.push(...read.payments);
        }
      }
      const stored = await storeSlice(db, hid, connection, ownsLease, payments, end);
      if (stored === null) return { stale: "PayPal refresh superseded.", asOf: connection.asOf };
      skipped += stored;
      readTo = cursor = end;
    }

    return await withHousehold(db, hid, async tx => {
      await beginMoneyChange(tx, hid);
      const [current] = await tx.select().from(paypalConnections).where(ownsLease).for("update");
      if (!current) return { stale: "PayPal refresh superseded.", asOf: connection.asOf };
      if (current.connectionStatus !== "connected" || current.sellerMerchantId !== connection.seller) {
        return { stale: "PayPal refresh superseded.", asOf: connection.asOf };
      }
      let asOf = current.balanceAsOf;
      const cutoff = new Date(Math.min(Date.parse(report.as_of_time), Date.parse(report.last_refresh_time)));
      if ((current.latestCreditAt && current.latestCreditAt > cutoff) || (asOf && asOf > cutoff)) {
        stale = "PayPal’s balance report predates a newer household balance. Keeping the stored balance.";
      } else {
        const { total, fx } = await readBalance(tx, hid, report, current.balanceCurrency, cutoff);
        await tx.update(paypalConnections).set({ balanceMinor: total, balanceAsOf: cutoff, balanceFxRateMicro: fx }).where(ownsLease);
        asOf = cutoff;
      }
      await tx.update(paypalConnections).set({ fetchedAt: now, transactionsReadUntil: readTo, refreshError: stale }).where(ownsLease);
      await observeRunway(tx, hid);
      return { stale, asOf, skipped };
    });
  } catch (error) {
    const stale = error instanceof FreshnessError ? error.message : "PayPal could not refresh. Showing the last stored household data.";
    await withHousehold(db, hid, async tx => tx.update(paypalConnections).set({ refreshError: stale }).where(ownsLease));
    return { stale, asOf: connection.asOf };
  }
}

/**
 * Stores one finished slice and moves the marker to its end, in one transaction. Returns how many payments could not be kept
 * (a payer email the client schema refuses cannot become a client, and an invoice needs a client), or null when the lease was lost.
 */
async function storeSlice(db: Db, hid: string, connection: { connectedAt: Date; timeZone: string; home: string }, ownsLease: SQL | undefined,
  payments: IncomingPayment[], end: Date) {
  return withHousehold(db, hid, async tx => {
    await beginMoneyChange(tx, hid);
    const [current] = await tx.select().from(paypalConnections).where(ownsLease).for("update");
    if (!current || current.connectionStatus !== "connected") return null;
    const byEmail = new Map((await tx.select({ id: clients.id, email: clients.email, name: clients.name }).from(clients).where(eq(clients.householdId, hid)))
      .map(c => [c.email.toLowerCase(), { id: c.id, name: c.name }]));
    const dayFormat = new Intl.DateTimeFormat("en-CA", { timeZone: connection.timeZone });
    let skipped = 0;
    for (const payment of payments.sort((x, y) => x.at.getTime() - y.at.getTime())) {
      let client = byEmail.get(payment.payerEmail);
      if (!client) {
        const created = clientInput.safeParse({ id: crypto.randomUUID(), name: payment.payerName, email: payment.payerEmail, termsDays: 0 });
        if (!created.success) { skipped++; continue; }
        await insertClient(tx, hid, created.data);
        client = { id: created.data.id, name: created.data.name };
        byEmail.set(payment.payerEmail, client);
      }
      // A payment through fipa's own link already carries its capture id (D12): the unique capture id keeps it from counting twice.
      const [row] = await tx.insert(invoices).values({
        householdId: hid, madeBy: "paypal", clientId: client.id, status: "paid", number: null, item: "PayPal payment",
        amountMinor: payment.amountMinor, currency: payment.currency, sentOn: null, dueOn: null,
        paidOn: dayFormat.format(payment.at), paypalCaptureId: payment.transactionId,
      }).onConflictDoNothing({ target: invoices.paypalCaptureId }).returning({ id: invoices.id });
      // Payments from before the connection are paid history only (D64): no event and no pots.
      if (!row || payment.at <= connection.connectedAt) continue;
      await recordEvent(tx, hid, { madeBy: "paypal", kind: "payment_received",
        title: paidTitle(client.name, payment.amountMinor, payment.currency),
        amount: { value: fromMinor(payment.amountMinor, payment.currency), currency: payment.currency },
        ref: { type: "invoice", id: row.id }, notify: true, occurredAt: payment.at });
      // D43: a payment that reaches the account fills the pots that have a rule, counted in the home currency.
      const homeCredit = payment.currency === connection.home ? payment.amountMinor
        : convertMinor(payment.amountMinor, payment.currency, connection.home,
          fromRateMicro(await usdRateMicro(tx, hid, connection.home, dayFormat.format(payment.at))));
      await fillPots(tx, hid, homeCredit, `${client.name}'s payment`);
    }
    await tx.update(paypalConnections).set({ transactionsReadUntil: end }).where(ownsLease);
    await observeRunway(tx, hid);
    return skipped;
  });
}
