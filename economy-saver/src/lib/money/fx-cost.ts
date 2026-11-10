// What foreign money costs (D62). Pure: no database, no clock. Two costs the household never sees on a statement:
//  - a card purchase in another currency: the cost above the reference rate of its day (exact when the billed amount is known,
//    an estimate from the card's foreign fee when the billed amount is only the reader's reference-rate conversion, else unknown);
//  - a paid USD invoice received through PayPal and converted to the home currency: the fee to receive and the conversion markup,
//    from PayPal Japan's published business rates, at the rate stored on the invoice row.
// All money is integer minor units. Rates are "units of the non-USD currency per 1 USD" (the only pair the app holds), so a
// USD-home household would convert a JPY purchase as original / rate. What it does not cover: payout sides other than USD
// invoices (a household whose home currency is USD has no conversion to price, so its payouts are empty), withdrawal fees,
// refunds, custom PayPal rates, and any currency other than JPY and USD.
import { convertMinor, minorMoney, percentText, plural } from "./format";
import { addDays } from "./dates";
import type { Currency } from "@/lib/catalogue/types";

/** PayPal Japan's published standard business rates, in one place. 3.60% + 0.50% cross-border + $0.30 to receive; 3.00% over the base rate to convert. */
export const PAYPAL_RATES = {
  receiveBp: 360,
  crossBorderBp: 50,
  fixedUsdMinor: 30,
  conversionBp: 300,
  sourceUrl: "https://www.paypal.com/jp/webapps/mpp/merchant-fees",
  asOf: "2026-11-01",
} as const;

/** The last twelve months: a date within this many days of today (inclusive), on or before today. */
export const FX_WINDOW_DAYS = 365;

export type FxRate = { date: string; perUsd: number };
export type FxCard = { id: string; label: string; currency: string; foreignFeeBp: number | null };
export type FxCharge = {
  id: string; cardId: string; merchant: string; date: string;
  amountMinor: number; // as billed, in the card's (home) currency
  original: { amountMinor: number; currency: string };
  fxEstimated: boolean; // true: amountMinor is the reference-rate conversion, not what the issuer billed
};
export type FxInvoice = { id: string; clientId: string; clientName: string; amountUsdMinor: number; paidOn: string; perUsd: number };

export type FxInput = { today: string; homeCurrency: string; rates: FxRate[]; cards: FxCard[]; charges: FxCharge[]; invoices: FxInvoice[] };

export type CostKind = "exact" | "estimated" | "unknown";
export type ChargeCost = {
  id: string; cardId: string; merchant: string; date: string; inWindow: boolean;
  originalMinor: number; originalCurrency: string; billedMinor: number;
  referenceMinor: number | null; // the original at the reference rate on or before its date; null when no rate exists yet
  costMinor: number | null; costKind: CostKind;
};
export type ChargeTotals = { count: number; exactMinor: number; estimatedMinor: number; unknownCount: number };
export type PayoutCost = {
  id: string; clientId: string; clientName: string; paidOn: string; amountUsdMinor: number; perUsd: number;
  grossMinor: number; receiveFeeMinor: number; markupMinor: number; landedMinor: number; // landed = gross - receiveFee - markup
};
export type PayoutTotals = { count: number; grossMinor: number; receiveFeeMinor: number; markupMinor: number; costMinor: number; landedMinor: number };

export type FxCosts = {
  homeCurrency: string;
  charges: ChargeCost[];
  chargeTotals: ChargeTotals;
  perCard: (ChargeTotals & { cardId: string; label: string })[];
  payouts: PayoutCost[];
  payoutTotals: PayoutTotals;
  perClient: (PayoutTotals & { clientId: string; clientName: string })[];
};

/** The reference rate on a date: the latest one on or before it; null when none exists. */
export function rateOn(rates: readonly FxRate[], date: string): number | null {
  let best: FxRate | null = null;
  for (const rate of rates) if (rate.date <= date && (best === null || rate.date > best.date)) best = rate;
  return best === null ? null : best.perUsd;
}

/** The fees of one USD payout, in USD minor units: to receive (3.6% + 0.5% + $0.30), and the conversion markup on what is left (3%). */
export function payoutFeesUsd(amountUsdMinor: number): { receiveFee: number; markup: number } {
  const receiveFee = Math.round(amountUsdMinor * (PAYPAL_RATES.receiveBp + PAYPAL_RATES.crossBorderBp) / 10_000) + PAYPAL_RATES.fixedUsdMinor;
  const markup = Math.round((amountUsdMinor - receiveFee) * PAYPAL_RATES.conversionBp / 10_000);
  return { receiveFee, markup };
}

const emptyCharges = (): ChargeTotals => ({ count: 0, exactMinor: 0, estimatedMinor: 0, unknownCount: 0 });
const emptyPayouts = (): PayoutTotals => ({ count: 0, grossMinor: 0, receiveFeeMinor: 0, markupMinor: 0, costMinor: 0, landedMinor: 0 });

function addCharge(total: ChargeTotals, c: ChargeCost): void {
  total.count += 1;
  if (c.costKind === "exact" && c.costMinor !== null) total.exactMinor += c.costMinor;
  else if (c.costKind === "estimated" && c.costMinor !== null) total.estimatedMinor += c.costMinor;
  else total.unknownCount += 1;
}

function addPayout(total: PayoutTotals, p: PayoutCost): void {
  total.count += 1;
  total.grossMinor += p.grossMinor;
  total.receiveFeeMinor += p.receiveFeeMinor;
  total.markupMinor += p.markupMinor;
  total.costMinor += p.receiveFeeMinor + p.markupMinor;
  total.landedMinor += p.landedMinor;
}

export function foreignCosts(input: FxInput): FxCosts {
  const { today, homeCurrency } = input;
  const from = addDays(today, -FX_WINDOW_DAYS);
  const inWindow = (date: string) => date >= from && date <= today;
  const cardOf = new Map(input.cards.map(card => [card.id, card]));

  const charges: ChargeCost[] = input.charges.map(charge => {
    const card = cardOf.get(charge.cardId);
    const rate = rateOn(input.rates, charge.date);
    const referenceMinor = rate === null ? null : convertMinor(charge.original.amountMinor, charge.original.currency, homeCurrency, rate);
    let costMinor: number | null = null, costKind: CostKind = "unknown";
    if (referenceMinor !== null) {
      if (!charge.fxEstimated) { costMinor = charge.amountMinor - referenceMinor; costKind = "exact"; }
      else if (card && card.foreignFeeBp !== null) { costMinor = Math.round(referenceMinor * card.foreignFeeBp / 10_000); costKind = "estimated"; }
    }
    return {
      id: charge.id, cardId: charge.cardId, merchant: charge.merchant, date: charge.date, inWindow: inWindow(charge.date),
      originalMinor: charge.original.amountMinor, originalCurrency: charge.original.currency, billedMinor: charge.amountMinor,
      referenceMinor, costMinor, costKind,
    };
  }).sort((a, b) => b.date.localeCompare(a.date) || a.merchant.localeCompare(b.merchant) || a.id.localeCompare(b.id));

  const chargeTotals = emptyCharges();
  const byCard = new Map<string, ChargeTotals>();
  for (const c of charges) {
    if (!c.inWindow) continue;
    addCharge(chargeTotals, c);
    if (!byCard.has(c.cardId)) byCard.set(c.cardId, emptyCharges());
    addCharge(byCard.get(c.cardId)!, c);
  }
  const perCard = [...byCard].map(([cardId, totals]) => ({ cardId, label: cardOf.get(cardId)?.label ?? "", ...totals }))
    .sort((a, b) => (b.exactMinor + b.estimatedMinor) - (a.exactMinor + a.estimatedMinor) || a.label.localeCompare(b.label));

  // Only a household that converts USD into its home currency has a payout side.
  const payouts: PayoutCost[] = homeCurrency === "USD" ? [] : input.invoices.filter(i => inWindow(i.paidOn)).map(invoice => {
    const { receiveFee, markup } = payoutFeesUsd(invoice.amountUsdMinor);
    const grossMinor = convertMinor(invoice.amountUsdMinor, "USD", homeCurrency, invoice.perUsd);
    const receiveFeeMinor = convertMinor(receiveFee, "USD", homeCurrency, invoice.perUsd);
    const markupMinor = convertMinor(markup, "USD", homeCurrency, invoice.perUsd);
    return {
      id: invoice.id, clientId: invoice.clientId, clientName: invoice.clientName, paidOn: invoice.paidOn, amountUsdMinor: invoice.amountUsdMinor, perUsd: invoice.perUsd,
      grossMinor, receiveFeeMinor, markupMinor, landedMinor: grossMinor - receiveFeeMinor - markupMinor,
    };
  }).sort((a, b) => b.paidOn.localeCompare(a.paidOn) || a.id.localeCompare(b.id));

  const payoutTotals = emptyPayouts();
  const byClient = new Map<string, PayoutTotals & { clientId: string; clientName: string }>();
  for (const p of payouts) {
    addPayout(payoutTotals, p);
    if (!byClient.has(p.clientId)) byClient.set(p.clientId, { clientId: p.clientId, clientName: p.clientName, ...emptyPayouts() });
    addPayout(byClient.get(p.clientId)!, p);
  }
  const perClient = [...byClient.values()].sort((a, b) => b.costMinor - a.costMinor || a.clientName.localeCompare(b.clientName));

  return { homeCurrency, charges, chargeTotals, perCard, payouts, payoutTotals, perClient };
}

export const FX_WORDS = {
  unknown: "The cost shows once the statement amount is typed in or the card's fee is set.",
} as const;

/** The fixed sentences (D7: the person's own number; no advice to leave PayPal, no provider names, no rate forecast). `null` when there is nothing to say on that side. */
export function foreignCostWords(costs: FxCosts): { charges: string | null; payouts: string | null; unknown: string | null } {
  const home = costs.homeCurrency as Currency;
  const money = (minor: number) => minorMoney(minor, home);
  const t = costs.chargeTotals;
  const inWindowOf = (kind: CostKind) => costs.charges.filter(c => c.inWindow && c.costKind === kind).length;
  const exactCount = inWindowOf("exact"), estimatedCount = inWindowOf("estimated");
  const parts: string[] = [];
  if (exactCount > 0) parts.push(`${money(t.exactMinor)} above the reference rate on ${plural(exactCount, "purchase")} with the statement amount known`);
  if (estimatedCount > 0) parts.push(`about ${money(t.estimatedMinor)} on ${plural(estimatedCount, "purchase")}, estimated from the card's fee`);
  const charges = parts.length === 0 ? null : `In the last 12 months, paying in another currency cost you ${parts.join(" and ")}.`;
  const p = costs.payoutTotals;
  const payouts = p.count === 0 ? null
    : `In the last 12 months, ${p.count} paid ${p.count === 1 ? "invoice" : "invoices"} cost ${money(p.costMinor)} to receive and convert through PayPal: ${money(p.receiveFeeMinor)} in fees to receive and ${money(p.markupMinor)} in the conversion rate, out of ${money(p.grossMinor)}. ${money(p.landedMinor)} reached your bank. This uses PayPal's published business rates (${percentText(PAYPAL_RATES.receiveBp)}% + ${percentText(PAYPAL_RATES.crossBorderBp)}% + $0.30 to receive, then ${percentText(PAYPAL_RATES.conversionBp)}% over the base rate to convert).`;
  const unknown = t.unknownCount > 0 ? `${plural(t.unknownCount, "purchase")} in another currency ${t.unknownCount === 1 ? "has" : "have"} no cost yet. ${FX_WORDS.unknown}` : null;
  return { charges, payouts, unknown };
}
