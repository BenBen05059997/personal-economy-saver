// The refresh reads PayPal only for a connected household, through a fake PayPalCall. No network calls.
import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as s from "@/db/schema";
import { seedBen } from "@/db/seed";
import { refreshPayPal } from "@/db/paypal-refresh";
import { observeRunway } from "@/db/runway-events";
import { listEvents, loadMoneyState, recordEvent } from "@/db/household";
import { setBankBalance } from "@/db/bank-balance";
import { randomUUID } from "node:crypto";
import { householdClock } from "@/db/account";
import { clockForHousehold } from "@/db/clock";
import { PayPalError } from "@/lib/paypal/client";
import type { PayPalCall, PayPalRequest } from "@/lib/paypal/contracts";
import { potInput, savePot } from "@/db/pots";
import { eventFeed } from "@/db/event-feed";
import { paidTitle } from "@/lib/money/paid-title";

async function test() {
  process.env.PAYPAL_ENVIRONMENT = "SANDBOX";
  process.env.PAYPAL_CLIENT_ID = "fictional-test-client";
  process.env.PAYPAL_CLIENT_SECRET = "fictional-test-secret";
  process.env.PAYPAL_PARTNER_ATTRIBUTION_ID = "FIPA_TEST_BN";
  process.env.PAYPAL_PARTNER_MERCHANT_ID = "PARTNERFICTIONAL";
  const pg = new PGlite({ extensions: { pg_trgm } });
  try {
    const queries: string[] = [];
    const db = drizzle(pg, { schema: s, logger: { logQuery(query) { queries.push(query); } } });
    await migrate(db, { migrationsFolder: "./drizzle" });
    const a = await seedBen(db, { isDemo: true }), b = await seedBen(db, { isDemo: true }), owner = await seedBen(db), other = await seedBen(db);
    for (const hid of [owner, other]) await db.insert(s.fxRates).values({ householdId: hid, base:"USD", quote:"JPY", date:"2020-01-01", rateMicro:150000000 });
    const now = new Date("2026-11-03T04:00:00Z");
    const later = (mins: number) => new Date(now.getTime() + mins * 60000);
    const conn = async (hid: string) => (await db.select().from(s.paypalConnections).where(eq(s.paypalConnections.householdId, hid)))[0];
    const untouched = await seedBen(db, { isDemo: true });
    const untouchedBalance = (await conn(untouched)).balanceMinor;
    const calls: PayPalRequest[] = [];
    const noCall: PayPalCall = async req => { calls.push(req); throw new Error("A household that is not connected must not call PayPal"); };
    for (const hid of [untouched, a, owner]) {
      assert.deepEqual(await refreshPayPal(db, hid, noCall, now), { stale: null, asOf: null }, "not connected: nothing to read");
      assert.deepEqual(await refreshPayPal(db, hid, noCall, later(3)), { stale: null, asOf: null });
      assert.equal((await conn(hid)).refreshAttemptedAt, null, "no lease is taken, so connecting is noticed at once");
    }
    assert.deepEqual(calls, []);
    assert.equal((await conn(untouched)).balanceMinor, untouchedBalance, "Try it keeps the balance its verified payments built");
    await db.update(s.paypalConnections).set({ refreshError: "Previous provider failure" }).where(eq(s.paypalConnections.householdId, untouched));
    assert.deepEqual(await refreshPayPal(db, untouched, noCall, later(4)), { stale: null, asOf: null });
    assert.equal((await conn(untouched)).refreshError, null, "obsolete provider errors are cleared");
    const [untouchedHousehold] = await db.select().from(s.households).where(eq(s.households.id, untouched));
    assert.equal(untouchedHousehold.runwayShort, null, "Home establishes the first rendered runway baseline");
    console.log("✓ A household that is not connected, Try it included, makes no PayPal call and keeps its balance");
    await db.transaction(async tx => {
      const [household] = await tx.select().from(s.households).where(eq(s.households.id, untouched)).for("update");
      assert.deepEqual({ ...clockForHousehold(household), currency: household.homeCurrency }, await householdClock(tx, untouched));
      queries.length = 0;
      const money = await loadMoneyState(tx, untouched, clockForHousehold(household).today, household);
      await observeRunway(tx, untouched, money, household);
      assert.equal(queries.length, 13, "workspace reuses its household for twelve money queries (two for who owes whom) and one baseline update");
      assert.ok(!queries.some(query => /from "households"|for update/i.test(query)), "no repeated household reads or locks");
      assert.equal(money.bank, 67000);
      await assert.rejects(loadMoneyState(tx, a, money.today, household), /does not match/);
      await assert.rejects(observeRunway(tx, a, money, household), /does not match/);
    });
    assert.equal((await db.select().from(s.households).where(eq(s.households.id, untouched)))[0].runwayShort, true);
    console.log("✓ Workspace shares one household snapshot for clock, money and locked runway observation; cross-household snapshots fail");
    // ---- a connected household
    const SELLER = "SELLERFICTIONAL";
    const [acme] = await db.select().from(s.clients).where(and(eq(s.clients.householdId, owner), eq(s.clients.name, "Acme Corp")));
    await db.update(s.paypalConnections).set({ connectionStatus: "connected", sellerMerchantId: SELLER, connectedAt: new Date("2026-11-01T00:00:00Z"), balanceMinor: 0 })
      .where(eq(s.paypalConnections.householdId, owner));
    await savePot(db, owner, potInput.parse({ id: randomUUID(), name: "Tax", saved: "0", fillPct: "25" }), "confirmed", { madeBy: "form" });
    const pot = async () => (await db.select().from(s.pots).where(eq(s.pots.householdId, owner)))[0];
    await db.insert(s.invoices).values({ householdId: owner, madeBy: "form", clientId: acme.id, status: "paid", item: "Own link", amountMinor: 5000,
      currency: "USD", paidOn: "2026-11-02", paypalCaptureId: "CAP-OWN-LINK" });
    const report = (cutoff: Date, over: object = {}, value = "10000") => ({ account_id: SELLER, as_of_time: cutoff.toISOString(), last_refresh_time: cutoff.toISOString(),
      balances: [{ available_balance: { currency_code: "JPY", value } }], ...over });
    const tx = (id: string, at: string, value: string, email: string | null, over: { status?: string; code?: string; name?: string } = {}) => ({
      transaction_info: { transaction_id: id, transaction_event_code: over.code ?? "T0006", transaction_initiation_date: at,
        transaction_amount: { currency_code: "USD", value }, transaction_status: over.status ?? "S" },
      ...(email ? { payer_info: { email_address: email, payer_name: { alternate_full_name: over.name ?? "Some Payer" } } } : {}),
    });
    const transactions = [
      tx("T-OLD", "2026-10-20T03:00:00Z", "100.00", "old-payer@example.test", { name: "Old Payer" }),
      tx("T-NEW", "2026-11-02T10:00:00Z", "200.00", acme.email.toUpperCase()),
      tx("T-NEWCLIENT", "2026-11-02T11:00:00Z", "40.00", "Fresh.Payer@Example.Test", { name: "Fresh Payer" }),
      tx("CAP-OWN-LINK", "2026-11-02T12:00:00Z", "50.00", acme.email),
      tx("T-FEE", "2026-11-02T10:00:00Z", "-6.00", acme.email, { code: "T0006" }),
      tx("T-PENDING", "2026-11-02T10:00:00Z", "30.00", acme.email, { status: "P" }),
      tx("T-FUNDING", "2026-11-02T10:00:00Z", "30.00", "bank@example.test", { code: "T0300" }),
      tx("T-NOEMAIL", "2026-11-02T10:00:00Z", "30.00", null),
      { transaction_info: { transaction_id: "T-BROKEN" } },
    ];
    const seen: PayPalRequest[] = [];
    const call = (over: { report?: object; list?: unknown[] } = {}): PayPalCall => async req => {
      seen.push(req);
      assert.equal(req.method, "GET");
      assert.equal(req.actAs, SELLER, "every read is made as this household's own seller");
      if (req.path.startsWith("/v1/reporting/balances")) { assert.equal(req.path, "/v1/reporting/balances?currency_code=ALL"); return over.report ?? report(now); }
      assert.ok(req.path.startsWith("/v1/reporting/transactions?"));
      return { transaction_details: over.list ?? transactions, total_pages: 1 };
    };
    await refreshPayPal(db, owner, call(), now);
    assert.deepEqual(seen.map(r => r.path.split("?")[0]), ["/v1/reporting/balances", "/v1/reporting/transactions"]);
    const query = new URLSearchParams(seen[1].path.split("?")[1]);
    assert.equal(query.get("start_date"), "2026-10-03T04:01:00.000Z", "the first read goes 31 days back");
    assert.equal(query.get("end_date"), now.toISOString());
    assert.deepEqual([query.get("fields"), query.get("page_size"), query.get("page")], ["transaction_info,payer_info", "100", "1"]);
    const row = await conn(owner);
    assert.equal(row.balanceMinor, 10000, "the balance is PayPal's report");
    assert.equal(row.transactionsReadUntil?.toISOString(), now.toISOString());
    const paidRows = await db.select().from(s.invoices).where(and(eq(s.invoices.householdId, owner), eq(s.invoices.madeBy, "paypal")));
    assert.deepEqual(paidRows.map(r => r.paypalCaptureId).sort(), ["T-NEW", "T-NEWCLIENT", "T-OLD"], "only incoming completed payments count, each once");
    assert.ok(paidRows.every(r => r.status === "paid" && r.sentOn === null && r.currency === "USD"));
    assert.equal(paidRows.find(r => r.paypalCaptureId === "T-NEW")?.amountMinor, 20000);
    assert.equal(paidRows.find(r => r.paypalCaptureId === "T-NEW")?.paidOn, "2026-11-02");
    assert.equal((await db.select().from(s.invoices).where(eq(s.invoices.paypalCaptureId, "CAP-OWN-LINK"))).length, 1, "fipa's own link is not counted twice");
    const clientsNow = await db.select().from(s.clients).where(eq(s.clients.householdId, owner));
    assert.equal(clientsNow.filter(c => c.email === acme.email).length, 1, "a known payer is not added again");
    assert.deepEqual(clientsNow.filter(c => ["old-payer@example.test", "fresh.payer@example.test"].includes(c.email)).map(c => c.name).sort(), ["Fresh Payer", "Old Payer"], "a new payer becomes a client");
    const received = (await listEvents(db, owner)).filter(e => e.kind === "payment_received");
    assert.equal(received.length, 2, "only payments after the connection raise an event");
    assert.ok(received.every(e => e.notify && e.madeBy === "paypal"));
    assert.deepEqual(received.map(e => e.title).sort(), ["Acme Corp paid $200", "Fresh Payer paid $40"]);
    assert.equal((await pot()).savedMinor, 9000, "pots fill from post-connect payments only");
    console.log("✓ Connected: balance read and transactions read as the seller; payments deduped against capture ids; pre-connect history fills no pots and raises no event; a new payer becomes a client");

    const before = seen.length;
    assert.equal((await refreshPayPal(db, owner, call(), later(3))).stale, null, "the five-minute cooldown returns the stored state");
    assert.equal(seen.length, before);
    await refreshPayPal(db, owner, call(), later(6));
    assert.equal(seen.length, before + 2);
    assert.equal(new URLSearchParams(seen.at(-1)!.path.split("?")[1]).get("start_date"), "2026-10-27T04:00:00.000Z", "a later read starts a week before the last one ended");
    assert.equal((await db.select().from(s.invoices).where(and(eq(s.invoices.householdId, owner), eq(s.invoices.madeBy, "paypal")))).length, 3, "reading again adds nothing");
    assert.equal((await listEvents(db, owner)).filter(e => e.kind === "payment_received").length, 2);
    assert.equal((await pot()).savedMinor, 9000);
    console.log("✓ Cooldown; an overlapping read changes nothing");

    const balanceBefore = (await conn(owner)).balanceMinor, paidBefore = (await db.select().from(s.invoices).where(eq(s.invoices.householdId, owner))).length;
    const mismatch = await refreshPayPal(db, owner, call({ report: report(later(20), { account_id: "SOMEONE-ELSE" }, "99999"), list: [tx("T-MISMATCH", "2026-11-03T04:10:00Z", "10.00", acme.email)] }), later(24));
    assert.ok(mismatch.stale?.includes("different account"));
    assert.equal((await conn(owner)).balanceMinor, balanceBefore);
    assert.equal((await db.select().from(s.invoices).where(eq(s.invoices.householdId, owner))).length, paidBefore, "nothing is read from another account's report");
    console.log("✓ A report for another account is refused and keeps the stored state");

    const noAccount = report(later(30), {}, "12000") as Record<string, unknown>;
    delete noAccount.account_id;
    assert.equal((await refreshPayPal(db, owner, call({ report: noAccount as object, list: [] }), later(36))).stale, null);
    assert.equal((await conn(owner)).balanceMinor, 12000, "a report without the account field is accepted");

    await db.update(s.paypalConnections).set({ latestCreditAt: later(60) }).where(eq(s.paypalConnections.householdId, owner));
    const stale = await refreshPayPal(db, owner, call({ report: report(later(42), {}, "55555"), list: [] }), later(48));
    assert.ok(stale.stale?.includes("predates"));
    assert.equal((await conn(owner)).balanceMinor, 12000, "a stale report cannot erase a newer credit");
    console.log("✓ Missing account field accepted; a stale report keeps the stored balance");

    let attempts = 0;
    const refused: PayPalCall = async () => { attempts++; throw new PayPalError("Forbidden", 403, "debug", undefined, "NOT_AUTHORIZED"); };
    const failed = await refreshPayPal(db, owner, refused, later(54));
    assert.equal(failed.stale, "PayPal could not refresh. Showing the last stored household data.");
    await refreshPayPal(db, owner, refused, later(56));
    assert.equal(attempts, 1, "a refused read waits five minutes too");
    assert.equal((await conn(owner)).balanceMinor, 12000);
    console.log("✓ A refused read keeps the stored state and shows the failure words");

    // Every page is read before the marker moves; a failed page stores nothing.
    const paged = (failPage?: number): PayPalCall => async req => {
      if (req.path.startsWith("/v1/reporting/balances")) return report(later(80));
      const page = Number(new URLSearchParams(req.path.split("?")[1]).get("page"));
      if (page === failPage) throw new PayPalError("Server error", 500, "debug");
      return { transaction_details: [tx(page === 1 ? "T-PAGE-1" : "T-PAGE-2", "2026-11-03T05:0" + page + ":00Z", "10.00", "page" + page + "@example.test")], total_pages: 2 };
    };
    const readUntil = (await conn(owner)).transactionsReadUntil?.toISOString();
    assert.equal((await refreshPayPal(db, owner, paged(2), later(80))).stale, "PayPal could not refresh. Showing the last stored household data.");
    assert.equal((await db.select().from(s.invoices).where(eq(s.invoices.paypalCaptureId, "T-PAGE-1"))).length, 0, "a half-read search stores nothing");
    assert.equal((await conn(owner)).transactionsReadUntil?.toISOString(), readUntil, "the marker does not move after a failed page");
    await refreshPayPal(db, owner, paged(), later(90));
    assert.deepEqual((await db.select().from(s.invoices).where(eq(s.invoices.householdId, owner))).filter(r => r.paypalCaptureId?.startsWith("T-PAGE")).map(r => r.paypalCaptureId).sort(), ["T-PAGE-1", "T-PAGE-2"]);
    assert.equal((await conn(owner)).transactionsReadUntil?.toISOString(), later(90).toISOString());
    assert.equal(paidTitle("Acme", 20000, "USD"), "Acme paid $200");
    assert.equal(paidTitle("Acme", 20000, "USD", "outside"), "Acme paid $200 (outside PayPal)");
    console.log("✓ Every page is read before the marker moves; a failed page keeps the stored state");

    // ---- slices, odd rows and the time budget. A windowed fake: it answers each search from the rows inside the asked dates.
    const asked: { from: number; to: number; page: number }[] = [];
    const windowed = (rows: ReturnType<typeof tx>[], balances: { currency_code: string; value: string }[], opts: { perPage?: number; failFrom?: number; slow?: number } = {}): PayPalCall => async req => {
      if (req.path.startsWith("/v1/reporting/balances")) return { ...report(later(300)), balances: balances.map(b => ({ available_balance: b })) };
      const q = new URLSearchParams(req.path.split("?")[1]);
      const from = Date.parse(q.get("start_date")!), to = Date.parse(q.get("end_date")!), page = Number(q.get("page"));
      asked.push({ from, to, page });
      assert.ok(to - from <= 31 * 86_400_000, "one search never spans more than 31 days");
      if (opts.failFrom !== undefined && to > opts.failFrom) throw new PayPalError("Server error", 500, "debug");
      if (opts.slow) await new Promise(r => setTimeout(r, opts.slow));
      const inside = rows.filter(r => { const t = Date.parse(r.transaction_info.transaction_initiation_date); return t >= from && t <= to; });
      const per = opts.perPage ?? 100;
      return { transaction_details: inside.slice((page - 1) * per, page * per), total_pages: Math.max(1, Math.ceil(inside.length / per)) };
    };
    const reset = async (readUntil: Date | null, hid = owner) => db.update(s.paypalConnections).set({ refreshAttemptedAt: null, transactionsReadUntil: readUntil, refreshError: null }).where(eq(s.paypalConnections.householdId, hid));
    const captured = async (prefix: string) => (await db.select().from(s.invoices).where(eq(s.invoices.householdId, owner))).filter(r => r.paypalCaptureId?.startsWith(prefix)).map(r => r.paypalCaptureId!).sort();
    const clock0 = later(400);

    // An unusual payer email cannot become a client: that payment is skipped and counted, and the read goes on.
    await reset(later(0));
    const odd = await refreshPayPal(db, owner, windowed([tx("T-ODD", "2026-11-03T06:00:00Z", "10.00", "pay@my_company.example"), tx("T-AFTER-ODD", "2026-11-03T07:00:00Z", "10.00", "fine@example.test")],
      [{ currency_code: "JPY", value: "20000" }]), clock0);
    assert.equal(odd.stale, null);
    assert.equal((odd as { skipped?: number }).skipped, 1);
    assert.deepEqual(await captured("T-ODD"), [], "the payment that cannot name a client is skipped");
    assert.deepEqual(await captured("T-AFTER-ODD"), ["T-AFTER-ODD"], "the rows after it are stored");
    assert.equal((await conn(owner)).transactionsReadUntil?.toISOString(), clock0.toISOString());
    assert.equal((await conn(owner)).balanceMinor, 20000);
    await reset(clock0);
    assert.equal((await refreshPayPal(db, owner, windowed([], [{ currency_code: "JPY", value: "21000" }]), later(410))).stale, null, "later reads still work");
    console.log("✓ An unusual payer email is skipped and counted; the read, the marker and later reads go on");

    // A balance in a currency fipa does not support is left out of the number.
    await reset(clock0);
    assert.equal((await refreshPayPal(db, owner, windowed([], [{ currency_code: "JPY", value: "30000" }, { currency_code: "EUR", value: "5.00" }]), later(420))).stale, null);
    assert.equal((await conn(owner)).balanceMinor, 30000, "the EUR balance is not in the number");
    console.log("✓ A balance in an unsupported currency is left out, not failed");

    // A gap of more than 31 days is read in full, over slices; more pages than the cap halves the slice; nothing is stored twice.
    const gapStart = new Date("2026-08-01T00:00:00Z"), gapNow = new Date("2026-11-10T00:00:00Z");
    const gapRows = Array.from({ length: 12 }, (_, i) => tx("T-GAP-" + String(i).padStart(2, "0"), new Date(gapStart.getTime() + i * 8 * 86_400_000 + 3600_000).toISOString(), "5.00", "gap" + i + "@example.test"));
    const heavy = Array.from({ length: 1100 }, (_, i) => tx("T-HEAVY-" + String(i).padStart(4, "0"), new Date(gapStart.getTime() + 30 * 86_400_000 + i * 60_000).toISOString(), "1.00", "heavy@example.test"));
    asked.length = 0;
    await db.update(s.paypalConnections).set({ latestCreditAt: null, balanceAsOf: null }).where(eq(s.paypalConnections.householdId, owner));
    await reset(gapStart);
    const rowsAll = [...gapRows, ...heavy];
    const gapRead = await refreshPayPal(db, owner, windowed(rowsAll, [{ currency_code: "JPY", value: "1" }]), gapNow);
    assert.equal(gapRead.stale, null);
    assert.equal((await captured("T-GAP-")).length, 12, "a gap of more than 31 days is read in full");
    assert.equal((await captured("T-HEAVY-")).length, 1100, "a slice over the page cap is halved and every row is stored");
    assert.ok(asked.some(a => a.to - a.from < 31 * 86_400_000 - 120_000 && a.page === 1), "a slice was halved");
    assert.equal((await conn(owner)).transactionsReadUntil?.toISOString(), gapNow.toISOString());
    await reset((await conn(owner)).transactionsReadUntil);
    await refreshPayPal(db, owner, windowed(rowsAll, [{ currency_code: "JPY", value: "1" }]), new Date(gapNow.getTime() + 600_000));
    assert.equal((await captured("T-HEAVY-")).length, 1100);
    assert.equal((await captured("T-GAP-")).length, 12, "reading again stores nothing twice");
    console.log("✓ A gap over 31 days is read in slices, an over-full slice is halved, nothing is stored twice");

    // A payment pending at one read and completed later is stored once, with its event.
    const pendingAt = "2026-11-10T08:00:00Z", t1 = new Date("2026-11-10T09:00:00Z"), t2 = new Date("2026-11-12T09:00:00Z");
    await reset(gapNow);
    await refreshPayPal(db, owner, windowed([tx("T-SLOW", pendingAt, "25.00", acme.email, { status: "P" })], [{ currency_code: "JPY", value: "1" }]), t1);
    assert.deepEqual(await captured("T-SLOW"), []);
    await reset(t1);
    const pots0 = (await pot()).savedMinor;
    await refreshPayPal(db, owner, windowed([tx("T-SLOW", pendingAt, "25.00", acme.email)], [{ currency_code: "JPY", value: "1" }]), t2);
    assert.deepEqual(await captured("T-SLOW"), ["T-SLOW"], "it is stored once it completes, a day later");
    assert.ok((await pot()).savedMinor > pots0, "and fills the pots");
    await reset(t2);
    await refreshPayPal(db, owner, windowed([tx("T-SLOW", pendingAt, "25.00", acme.email)], [{ currency_code: "JPY", value: "1" }]), new Date(t2.getTime() + 600_000));
    assert.deepEqual(await captured("T-SLOW"), ["T-SLOW"]);
    console.log("✓ A payment pending at one read and completed later is read once");

    // A failed slice keeps the slices before it and the marker at their end.
    const failStart = new Date("2026-05-01T00:00:00Z"), failNow = new Date("2026-08-01T00:00:00Z");
    const failRows = [tx("T-FAIL-EARLY", "2026-05-02T00:00:00Z", "5.00", "early@example.test"), tx("T-FAIL-LATE", "2026-07-30T00:00:00Z", "5.00", "late@example.test")];
    await reset(failStart);
    const failed2 = await refreshPayPal(db, owner, windowed(failRows, [{ currency_code: "JPY", value: "1" }], { failFrom: Date.parse("2026-07-01T00:00:00Z") }), failNow);
    assert.equal(failed2.stale, "PayPal could not refresh. Showing the last stored household data.");
    assert.deepEqual(await captured("T-FAIL-"), ["T-FAIL-EARLY"], "the slice before the failure is kept");
    const kept = (await conn(owner)).transactionsReadUntil!;
    assert.ok(kept > failStart && kept < failNow, "the marker is at the end of the last finished slice");
    console.log("✓ A failed slice keeps earlier slices and leaves the marker at the last finished one");

    // The time budget stops a long backlog; the next read continues from the marker.
    const budgetStart = new Date("2025-01-01T00:00:00Z"), budgetNow = new Date("2025-06-01T00:00:00Z");
    const budgetRows = [tx("T-BUD-1", "2025-01-05T00:00:00Z", "5.00", "bud1@example.test"), tx("T-BUD-2", "2025-05-30T00:00:00Z", "5.00", "bud2@example.test")];
    await reset(budgetStart);
    const slice1 = await refreshPayPal(db, owner, windowed(budgetRows, [{ currency_code: "JPY", value: "1" }], { slow: 2600 }), budgetNow);
    assert.ok(slice1.stale?.includes("catching up"), "the budget ends the read with a note");
    const partial = (await conn(owner)).transactionsReadUntil!;
    assert.ok(partial > budgetStart && partial < budgetNow, "finished slices are kept and the marker moved");
    assert.deepEqual(await captured("T-BUD-"), ["T-BUD-1"]);
    await reset(partial);
    const slice2 = await refreshPayPal(db, owner, windowed(budgetRows, [{ currency_code: "JPY", value: "1" }]), new Date(budgetNow.getTime() + 600_000));
    assert.equal(slice2.stale, null);
    assert.deepEqual(await captured("T-BUD-"), ["T-BUD-1", "T-BUD-2"], "the next read continues and nothing is skipped");
    console.log("✓ The time budget stops a long backlog, keeps what finished and the next read continues");

    // A link is in flight while its order is under three hours old.
    const [sentInvoice] = await db.select().from(s.invoices).where(and(eq(s.invoices.householdId, owner), eq(s.invoices.status, "sent")));
    const flight = async (hoursAgo: number | null) => {
      await db.update(s.invoices).set({ paypalOrderId: hoursAgo === null ? null : "ORDER-FLIGHT", paypalOrderCreatedAt: hoursAgo === null ? null : new Date(now.getTime() - hoursAgo * 3_600_000) })
        .where(eq(s.invoices.id, sentInvoice.id));
      return (await eventFeed(db, owner, now)).inFlight;
    };
    assert.deepEqual([await flight(1), await flight(4), await flight(null)], [true, false, false]);
    console.log("✓ In flight means the order was made in the last three hours");

    await db.transaction(async tx=>{await observeRunway(tx,b)});
    await setBankBalance(db,b,{id:randomUUID(),amount:"950000"},"confirmed",{madeBy:"form"});
    await setBankBalance(db,b,{id:randomUUID(),amount:"0"},"confirmed",{madeBy:"form"});
    await db.transaction(async tx=>{await recordEvent(tx,b,{ madeBy: "form",kind:"daily_reminder",title:"Due soon",notify:true})});
    const changes=(await listEvents(db,b)).filter(e=>["runway_clear","runway_short","daily_reminder"].includes(e.kind));
    assert.equal(changes.filter(e=>e.kind==="runway_clear").length,1);
    assert.equal(changes.filter(e=>e.kind==="runway_short").length,1);
    assert.equal(changes.filter(e=>e.notify).length,1);
    console.log("✓ Fine/short transitions stay in Activity; one non-money alert per local day");
  } finally {await pg.close();}
}
test().catch(e=>{ console.error("Refresh tests failed", e instanceof Error ? e.stack?.split("\n").filter(line=>line.trim().startsWith("at ")).slice(0,4).join("\n") : ""); process.exitCode=1; });
