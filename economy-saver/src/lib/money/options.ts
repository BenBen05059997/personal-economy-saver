import { minorPerUnit } from "./format";
import type { MoneyState } from "./types";
import { addDays, arrivals, daysBetween, EARLY_DISCOUNT, ladder, low, project, series } from "./runway";

export const BORROWING_CHECKED = "2026-11-02";
export const BORROWING_SOURCES = {
  bank: "https://www.bk.mufg.jp/kariru/banquic/hensai/kikan.html",
  advance: "https://www.jcb.co.jp/cashing/pop/term-of-use.html",
  atm: "https://www.jcb.co.jp/cashing/use/cd-atm/index.html",
  welfare: "https://www.mhlw.go.jp/content/12000000/000931068.pdf",
};
type FundingOption = {
  id: string; title: string; detail: string; cost: number; principal: number;
  status: string; pick: boolean; href?: string; action?: string;
  source?: keyof typeof BORROWING_SOURCES;
  assumed?: boolean; repaymentCovered?: boolean; repayFrom?: string;
};

/** Financing comparison only. Only a sent invoice with a payment link (`hasLink`) can be offered again. It neither infers eligibility nor places a loan in the runway. */
export function fundingOptions(state: MoneyState) {
  const worst = series(state, "worst");
  const point = low(worst);
  const fundingDate = addDays(state.today, Math.max(0, worst.findIndex(amount => amount < 0)));
  const gap = Math.max(0, -point.amount);
  const days = 30;
  if (!gap) return { gap, date: point.date, days, repayOn: addDays(point.date, days), rows: [] as FundingOption[] };
  const base = ladder(state);
  const largest = [...arrivals(state)].sort((a, b) => b.amountHome - a.amountHome)[0];
  // The late invoice is the sent one with a link expected earliest: its page holds the link to copy.
  const earliest = [...arrivals(state)].filter(arrival => state.invoices.find(invoice => invoice.id === arrival.invoiceId)?.hasLink).sort((a, b) => a.expectedOn < b.expectedOn ? -1 : a.expectedOn > b.expectedOn ? 1 : 0)[0];
  const unbilled = state.invoices.find(invoice => invoice.status === "unbilled");
  const rows: FundingOption[] = base.filter(row => row.id !== "advance").map(row => {
    const projection = row.id === "invoice" && unbilled ? project(state, unbilled, state.today) : null;
    const covers = projection && projection.amountHome >= gap && projection.worstOn <= fundingDate &&
      low(series({ ...state, invoices: state.invoices.map(invoice => invoice.id === unbilled?.id ? { ...invoice, status: "sent", sentOn: state.today } : invoice) }, "worst")).amount >= 0;
    const discount = largest ? largest.amountHome * EARLY_DISCOUNT : 0;
    const per = minorPerUnit(state.homeCurrency);
    const cost = row.id === "discount" ? Math.round(discount * per) / per : row.cost;
    return { id: row.id, title: row.title, cost, principal: 0, pick: !!covers,
      detail: row.id === "remind" ? "Sent invoices are already in the forecast. Sending the link again does not guarantee an earlier payment." : row.detail ?? "",
      status: row.id === "invoice" ? covers ? "Projected to cover the gap if paid within the observed timing" : "Amount or arrival date does not cover the whole gap" :
        row.id === "discount" ? "Requires the client’s agreement and payment before the gap" : "Earlier arrival unconfirmed",
      ...(row.id === "invoice" && unbilled ? { href: `/invoices/${unbilled.id}`, action: "Review invoice" } :
        row.id === "remind" && earliest ? { href: `/invoices/${earliest.invoiceId}`, action: "Copy link again" } : {}),
    };
  });
  if (state.homeCurrency === "JPY") {
    const principal = Math.ceil(gap);
    rows.push({ id: "welfare", title: "Emergency small loan", principal: Math.min(principal, 100000), cost: 0,
      detail: "0% reference; up to ¥100,000. For eligible low-income, disabled or older households facing a temporary emergency. Assessment and local welfare consultation take time.",
      status: principal > 100000 ? "Limit is below your gap; eligibility and timing unconfirmed" : "Eligibility and arrival before your gap are unconfirmed", pick: false, source: "welfare" });
    rows.push({ id: "bank", title: "Bank credit line", principal, cost: Math.ceil(principal * 0.146 * days / 365),
      detail: "14.6% annual reference for a limit up to ¥1 million; no ATM fee in this reference. Your contract, income, residency, underwriting and transfer timing determine availability.",
      status: "Eligibility, facility and arrival before your gap are unconfirmed", pick: false, source: "bank" });
    const advancePrincipal = Math.ceil(principal / 10000) * 10000;
    const fee = advancePrincipal <= 10000 ? 110 : 220;
    const interest = Math.ceil(advancePrincipal * 0.18 * days / 365);
    const repaymentFee = advancePrincipal + interest <= 10000 ? 110 : 220;
    rows.push({ id: "advance", title: "Card cash advance, repaid in full", principal: advancePrincipal,
      cost: interest + fee + repaymentFee,
      detail: `18% annual reference; ATM withdrawal rounded up to ¥10,000 units, plus ¥${fee} withdrawal and ¥${repaymentFee} ATM repayment fees. Needs a separate cash-advance limit; the shopping limit is not evidence. Early full repayment must be arranged with the issuer.`,
      status: "Cash facility, early repayment and deadline coverage are unconfirmed", pick: false, source: "advance" });
  } else {
    rows.push({ id: "advance", title: "Card cash advance, illustrative US terms", principal: gap,
      cost: Math.ceil((gap * 0.28 * days / 365 + Math.max(10, gap * 0.05)) * 100) / 100,
      detail: "Unverified assumptions: 28% annual interest plus a 5% advance fee ($10 minimum). Your issuer’s actual APR, fees, cash limit and full-repayment terms may differ.",
      status: "US reference, eligibility and deadline coverage are unconfirmed", pick: false, assumed: true });
  }
  // Stable sort preserves the user's own free actions ahead of eligibility-dependent 0% credit.
  rows.sort((a, b) => a.cost - b.cost);
  const pick = rows.find(row => row.pick)?.id;
  const repayOn = addDays(fundingDate, days);
  const repaymentSeries = series(state, "worst", daysBetween(state.today, repayOn) + 1);
  const repaymentBalance = repaymentSeries[repaymentSeries.length - 1];
  const receipts = [...new Set(arrivals(state).filter(arrival => arrival.worstOn > fundingDate && arrival.worstOn <= repayOn).map(arrival => arrival.clientName))].join(" and ");
  return { gap, date: fundingDate, days, repayOn, rows: rows.map(row => ({ ...row, pick: row.id === pick,
    ...(row.principal > 0 ? { repaymentCovered: repaymentBalance >= row.cost && Math.min(...repaymentSeries.slice(daysBetween(state.today, fundingDate))) + row.principal >= 0,
      repayFrom: receipts } : {}) })) };
}
