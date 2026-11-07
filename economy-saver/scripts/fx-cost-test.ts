// What foreign money costs (D62): the pure rule in src/lib/money/fx-cost.ts. A charge's cost is exact when the billed amount is known, an
// estimate from the card's fee when the billed amount is the reader's reference-rate conversion, unknown otherwise; a paid USD invoice's
// receive fee and conversion markup from PayPal Japan's published rates; the twelve-month window, per-card and per-client totals, the words.
// Fictional data only; no database. Run from the project root: npx tsx --tsconfig ./tsconfig.json scripts/fx-cost-test.ts
import assert from "node:assert/strict";
import { FX_WINDOW_DAYS, PAYPAL_RATES, foreignCostWords, foreignCosts, payoutFeesUsd, rateOn, type FxCharge, type FxInput, type FxInvoice } from "@/lib/money/fx-cost";

let passed = 0;
function check(name: string, run: () => void) { run(); passed++; console.log(`✓ ${name}`); }

const TODAY = "2026-11-14";
const CARD_A = { id: "card-a", label: "Card A", currency: "JPY", foreignFeeBp: 220 };
const CARD_B = { id: "card-b", label: "Card B", currency: "JPY", foreignFeeBp: null };
const RATES = [{ date: "2026-10-20", perUsd: 160 }, { date: "2026-02-01", perUsd: 140 }, { date: "2026-10-01", perUsd: 150 }]; // any order
const charge = (over: Partial<FxCharge> & Pick<FxCharge, "id">): FxCharge => ({
  cardId: "card-a", merchant: `Fictional shop ${over.id}`, date: "2026-10-10", amountMinor: 3_000, original: { amountMinor: 2_000, currency: "USD" }, fxEstimated: false, ...over,
});
const invoice = (over: Partial<FxInvoice> & Pick<FxInvoice, "id">): FxInvoice => ({ clientId: "c-1", clientName: "Fictional Client One", amountUsdMinor: 100_000, paidOn: "2026-10-01", perUsd: 150, ...over });
const input = (over: Partial<FxInput> = {}): FxInput => ({ today: TODAY, homeCurrency: "JPY", rates: RATES, cards: [CARD_A, CARD_B], charges: [], invoices: [], ...over });

check("the rate on a date is the latest on or before it; none before the first is null", () => {
  assert.equal(rateOn(RATES, "2026-10-19"), 150);
  assert.equal(rateOn(RATES, "2026-10-20"), 160);
  assert.equal(rateOn(RATES, "2026-12-01"), 160);
  assert.equal(rateOn(RATES, "2026-01-31"), null);
  assert.equal(rateOn([], "2026-10-20"), null);
});

check("an exact cost is the billed amount minus the original at the reference rate of its day ($20.00 at 150 is ¥3,000; billed ¥3,090 costs ¥90)", () => {
  const [c] = foreignCosts(input({ charges: [charge({ id: "x1", amountMinor: 3_090 })] })).charges;
  assert.deepEqual([c.referenceMinor, c.costMinor, c.costKind], [3_000, 90, "exact"]);
});

check("the reference rate is the one on or before the charge's date, not the latest", () => {
  const out = foreignCosts(input({ charges: [charge({ id: "a", date: "2026-10-19", amountMinor: 3_000 }), charge({ id: "b", date: "2026-10-20", amountMinor: 3_200 })] })).charges;
  const by = Object.fromEntries(out.map(c => [c.id, c]));
  assert.deepEqual([by.a.referenceMinor, by.a.costMinor], [3_000, 0]);
  assert.deepEqual([by.b.referenceMinor, by.b.costMinor], [3_200, 0], "$20.00 at 160 is ¥3,200");
});

check("an estimate (the reader's conversion) is the reference amount times the card's fee: ¥3,000 at 2.2% is ¥66; a card with no fee is unknown", () => {
  const out = foreignCosts(input({ charges: [
    charge({ id: "est", amountMinor: 3_000, fxEstimated: true }),
    charge({ id: "none", cardId: "card-b", amountMinor: 3_000, fxEstimated: true }),
  ] })).charges;
  const by = Object.fromEntries(out.map(c => [c.id, c]));
  assert.deepEqual([by.est.costMinor, by.est.costKind], [66, "estimated"]);
  assert.deepEqual([by.none.costMinor, by.none.costKind], [null, "unknown"]);
});

check("a fee of 0 is a real fee: the estimate is zero, not unknown", () => {
  const [c] = foreignCosts(input({ cards: [{ ...CARD_A, foreignFeeBp: 0 }], charges: [charge({ id: "z", fxEstimated: true })] })).charges;
  assert.deepEqual([c.costMinor, c.costKind], [0, "estimated"]);
});

check("no rate on or before the date: the reference is null and the cost unknown, estimated or not", () => {
  const out = foreignCosts(input({ charges: [charge({ id: "old1", date: "2026-01-15" }), charge({ id: "old2", date: "2026-01-15", fxEstimated: true })] })).charges;
  for (const c of out) assert.deepEqual([c.referenceMinor, c.costMinor, c.costKind], [null, null, "unknown"]);
});

check("a yen purchase of a USD-home household converts the other way (¥3,000 at 150 is $20.00)", () => {
  const [c] = foreignCosts(input({ homeCurrency: "USD", cards: [{ ...CARD_A, currency: "USD" }], charges: [charge({ id: "u", amountMinor: 2_100, original: { amountMinor: 3_000, currency: "JPY" } })] })).charges;
  assert.deepEqual([c.referenceMinor, c.costMinor, c.costKind], [2_000, 100, "exact"]);
});

check("the twelve months: 365 days back is in, 366 is out, tomorrow is out; totals count only the window", () => {
  const edge = "2025-11-14", before = "2025-11-13", future = "2026-11-15";
  const out = foreignCosts(input({ rates: [{ date: "2025-01-01", perUsd: 150 }], charges: [
    charge({ id: "edge", date: edge, amountMinor: 3_100 }), charge({ id: "before", date: before, amountMinor: 3_100 }), charge({ id: "future", date: future, amountMinor: 3_100 }), charge({ id: "today", date: TODAY, amountMinor: 3_100 }),
  ] }));
  assert.equal(FX_WINDOW_DAYS, 365);
  assert.deepEqual(out.charges.map(c => [c.id, c.inWindow]).sort(), [["before", false], ["edge", true], ["future", false], ["today", true]]);
  assert.deepEqual(out.chargeTotals, { count: 2, exactMinor: 200, estimatedMinor: 0, unknownCount: 0 });
  assert.deepEqual(out.charges.map(c => c.id), ["future", "today", "edge", "before"], "newest first");
});

check("per card and overall totals keep exact and estimated apart and count the unknown ones", () => {
  const out = foreignCosts(input({ charges: [
    charge({ id: "e1", amountMinor: 3_090 }), charge({ id: "e2", amountMinor: 3_010, date: "2026-10-12" }),
    charge({ id: "s1", fxEstimated: true }),
    charge({ id: "b1", cardId: "card-b", amountMinor: 4_000, fxEstimated: true }),
    charge({ id: "b2", cardId: "card-b", amountMinor: 3_300 }),
  ] }));
  assert.deepEqual(out.chargeTotals, { count: 5, exactMinor: 90 + 10 + 300, estimatedMinor: 66, unknownCount: 1 });
  const a = out.perCard.find(c => c.cardId === "card-a")!, b = out.perCard.find(c => c.cardId === "card-b")!;
  assert.deepEqual([a.label, a.count, a.exactMinor, a.estimatedMinor, a.unknownCount], ["Card A", 3, 100, 66, 0]);
  assert.deepEqual([b.label, b.count, b.exactMinor, b.estimatedMinor, b.unknownCount], ["Card B", 2, 300, 0, 1]);
});

check("the PayPal rates live in one constant: 3.60% + 0.50% + $0.30, then 3.00%, with the source and its date", () => {
  assert.deepEqual([PAYPAL_RATES.receiveBp, PAYPAL_RATES.crossBorderBp, PAYPAL_RATES.fixedUsdMinor, PAYPAL_RATES.conversionBp], [360, 50, 30, 300]);
  assert.match(PAYPAL_RATES.sourceUrl, /^https:\/\/www\.paypal\.com\/jp\//);
  assert.match(PAYPAL_RATES.asOf, /^\d{4}-\d{2}-\d{2}$/);
});

check("a $1,000 payout at ¥150, by hand: receive fee $1,000 x 4.1% + $0.30 = $41.30 (¥6,195); markup on $958.70 at 3% = $28.76 (¥4,314); landed ¥150,000 - ¥6,195 - ¥4,314 = ¥139,491", () => {
  assert.deepEqual(payoutFeesUsd(100_000), { receiveFee: 4_130, markup: 2_876 });
  const out = foreignCosts(input({ invoices: [invoice({ id: "i1" })] }));
  const [p] = out.payouts;
  assert.deepEqual([p.grossMinor, p.receiveFeeMinor, p.markupMinor, p.landedMinor], [150_000, 6_195, 4_314, 139_491]);
  assert.deepEqual(out.payoutTotals, { count: 1, grossMinor: 150_000, receiveFeeMinor: 6_195, markupMinor: 4_314, costMinor: 10_509, landedMinor: 139_491 });
});

check("the rate on the invoice row is used, not the reference: $1,000 at ¥140 gives ¥140,000 gross", () => {
  const [p] = foreignCosts(input({ invoices: [invoice({ id: "i1", perUsd: 140 })] })).payouts;
  assert.equal(p.grossMinor, 140_000);
  assert.equal(p.receiveFeeMinor, Math.round(41.3 * 140));
});

check("a $500 payout at ¥150, by hand: fee $500 x 4.1% + $0.30 = $20.80 (¥3,120); markup on $479.20 at 3% = $14.38 (¥2,157); landed ¥75,000 - ¥3,120 - ¥2,157 = ¥69,723", () => {
  const [p] = foreignCosts(input({ invoices: [invoice({ id: "i2", amountUsdMinor: 50_000 })] })).payouts;
  assert.deepEqual([p.grossMinor, p.receiveFeeMinor, p.markupMinor, p.landedMinor], [75_000, 3_120, 2_157, 69_723]);
});

check("payout totals per client and overall, biggest cost first; the window applies to the paid date", () => {
  const out = foreignCosts(input({ invoices: [
    invoice({ id: "i1" }), invoice({ id: "i2", amountUsdMinor: 50_000, paidOn: "2026-10-15" }),
    invoice({ id: "i3", clientId: "c-2", clientName: "Fictional Client Two", amountUsdMinor: 50_000, paidOn: "2026-09-01" }),
    invoice({ id: "edge", clientId: "c-2", clientName: "Fictional Client Two", paidOn: "2025-11-14" }),
    invoice({ id: "late", paidOn: "2025-11-13" }), invoice({ id: "future", paidOn: "2026-11-15" }),
  ] }));
  assert.deepEqual(out.payouts.map(p => p.id), ["i2", "i1", "i3", "edge"]);
  assert.deepEqual(out.perClient.map(c => [c.clientName, c.count, c.costMinor]), [["Fictional Client One", 2, 10_509 + 5_277], ["Fictional Client Two", 2, 5_277 + 10_509]], "equal costs: by name");
  assert.equal(out.payoutTotals.count, 4);
  assert.equal(out.payoutTotals.costMinor, 2 * (10_509 + 5_277));
  assert.equal(out.payoutTotals.landedMinor, out.perClient.reduce((sum, c) => sum + c.landedMinor, 0));
});

check("a USD-home household has no payout side", () => {
  const out = foreignCosts(input({ homeCurrency: "USD", invoices: [invoice({ id: "i1" })] }));
  assert.deepEqual([out.payouts.length, out.payoutTotals.count, out.perClient.length], [0, 0, 0]);
});

check("the words: an exact total, an estimate labelled about, the unknown sentence, the payout line", () => {
  const out = foreignCosts(input({
    charges: [charge({ id: "e1", amountMinor: 3_090 }), charge({ id: "s1", fxEstimated: true }), charge({ id: "u1", cardId: "card-b", fxEstimated: true })],
    invoices: [invoice({ id: "i1" })],
  }));
  const words = foreignCostWords(out);
  assert.equal(words.charges, "In the last 12 months, paying in another currency cost you ¥90 above the reference rate on 1 purchase with the statement amount known and about ¥66 on 1 purchase, estimated from the card's fee.");
  assert.equal(words.unknown, "1 purchase in another currency has no cost yet. The cost shows once the statement amount is typed in or the card's fee is set.");
  assert.match(words.payouts!, /^In the last 12 months, 1 paid invoice cost ¥10,509 to receive and convert through PayPal: ¥6,195 in fees to receive and ¥4,314 in the conversion rate, out of ¥150,000\. ¥139,491 reached your bank\./);
  assert.match(words.payouts!, /3\.6% \+ 0\.5% \+ \$0\.30 to receive, then 3% over the base rate/);
});

check("the words give nothing when there is nothing, and never advise leaving PayPal, name another provider or forecast a rate", () => {
  const none = foreignCostWords(foreignCosts(input()));
  assert.deepEqual(none, { charges: null, payouts: null, unknown: null });
  const all = Object.values(foreignCostWords(foreignCosts(input({ charges: [charge({ id: "a", amountMinor: 3_090 }), charge({ id: "b", fxEstimated: true, cardId: "card-b" })], invoices: [invoice({ id: "i" })] })))).join(" ");
  assert.doesNotMatch(all, /\b(leave|switch|wise|revolut|convert now|wait|will rise|will fall)\b/i);
});

console.log(`Foreign cost checks passed (${passed}).`);
