// What the assistant notices (D40): each kind is one function that works out its facts from the engine, then writes its title and reason from
// those facts, so a finding says nothing its facts do not (D79). The facts are the ones the matching picture carries for the same subject.
import { AMOUNT_NOT_KNOWN } from "./gaps";
import { engineFact, fact, type Fact } from "./facts";
import { dayLabel, minorMoney, minorPerUnit } from "./format";
import { goalPaces } from "./goals";
import { invoiceAbout } from "./pace";
import { cancelNotices, resolveBills } from "./repeat";
import { REGULAR_MONTHS, regularCosts } from "./regular";
import { addDays, arrivals, daysBetween, dueItems, expectedPayBasis, overdue, safeToSpend } from "./runway";
import { monthBounds, monthsBack, spendingItems } from "./spending";
import type { Finding, StandingRule, StandingRules } from "./suggestion-types";
import { TAX_AHEAD_DAYS, taxAhead } from "./tax-ahead";
import type { MoneyState } from "./types";
import { stateThrough } from "./window";

const FROM = "suggestions";
const threshold = (rule: StandingRule) => rule.enabled ? rule.threshold : null;
const daysWords = (n: number) => n === 1 ? "1 day" : n + " days";
const minorOf = (state: MoneyState, amount: number) => Math.round(amount * minorPerUnit(state.homeCurrency));
/** A money fact read back as words. */
const said = (item: Fact) => minorMoney(item.value as number, item.currency!);
/** A finding's own fact by name: its words read the figure back, never by position. */
const named = (facts: readonly Fact[], name: Parameters<typeof fact>[1]): Fact => { const found = fact(facts, name); if (!found) throw new Error(`A finding has no ${name} fact`); return found; };

/** A sent invoice with a payment link that is overdue by more than the rule's days (D64, D78: overdue is the forecast's own expected pay day gone by). */
export function invoiceNudgeFindings(state: MoneyState, rules: StandingRules): Finding[] {
  const nudge = threshold(rules.nudge_after);
  if (nudge === null) return [];
  const { today, homeCurrency: currency } = state;
  const findings: Finding[] = [];
  for (const invoice of state.invoices) {
    if (invoice.status !== "sent" || !invoice.sentOn || !invoice.hasLink) continue;
    const client = state.clients.find(row => row.id === invoice.clientId);
    if (!client) continue;
    const { daysOverdue } = overdue(state, invoice);
    if (daysOverdue <= nudge) continue;
    const arrival = arrivals(state).find(row => row.invoiceId === invoice.id)!;
    const about = invoiceAbout(invoice, client.name);
    const facts = [
      engineFact("days_overdue", daysOverdue, { from: FROM, about }),
      engineFact("client_pays", minorOf(state, arrival.amountHome), { from: FROM, case: "as_usual", currency, about, period: { on: arrival.expectedOn } }),
    ];
    const expected = expectedPayBasis(state, invoice);
    const why = expected.basis === "history" ? client.name + " usually pays in " + daysWords(expected.days)
      : expected.basis === "due" ? client.name + "'s invoice was due " + dayLabel(expected.dueOn)
      : client.name + "'s terms are " + daysWords(expected.days);
    findings.push({ kind: "invoice_nudge", key: "nudge:" + invoice.id, title: "Send " + client.name + " the link again",
      reason: why + "; it is " + daysWords(Number(named(facts, "days_overdue").value)) + " overdue, and it has been " + daysWords(daysBetween(invoice.sentOn, today)) + " since the link was made.",
      action: "remind", refId: invoice.id, urgency: 1, facts });
  }
  return findings;
}

/** Card statements and bills coming due inside their rules' days, in the order they fall due. */
export function dueFindings(state: MoneyState, rules: StandingRules): Finding[] {
  const { today, homeCurrency: currency } = state;
  const billAhead = threshold(rules.bill_ahead), statementAhead = threshold(rules.statement_ahead);
  const horizon = Math.max(billAhead ?? 0, statementAhead ?? 0);
  const dueState = stateThrough(state, addDays(today, horizon));
  const findings: Finding[] = [];
  for (const item of dueItems(dueState, horizon + 1)) {
    const days = item.kind === "bill" ? billAhead : statementAhead;
    if (days === null || item.dueUnknown || item.date > addDays(today, days)) continue;
    const refId = item.kind === "statement" ? item.cardId! : item.id.split("@")[0];
    const about = { type: item.kind === "statement" ? "card" as const : "bill" as const, id: refId, name: item.label };
    const facts: Fact[] = [engineFact("due", item.date, { from: FROM, about })];
    if (item.uncounted) facts.push(engineFact("not_counted", 1, { from: FROM, about }));
    else {
      const name = item.kind === "bill" ? "bill_amount" : item.open ? "statement_open" : "statement_closed";
      facts.push(engineFact(name, minorOf(state, item.amount), { from: FROM, currency, about, period: { on: item.date } }));
      if (item.estimated) facts.push(engineFact("about_estimate", 1, { from: FROM, about }));
    }
    const amount = item.uncounted ? AMOUNT_NOT_KNOWN : (item.estimated ? "about " : "") + said(facts.find(f => f.unit === "money")!);
    const covered = item.covered ? "covered even if clients pay late" : item.expectedCovered ? "short if clients pay late" : "short even if clients pay as usual";
    const urgency = item.covered ? 3 : 0;
    const title = item.label + " due " + dayLabel(String(named(facts, "due").value)), reason = amount + ", " + covered + ".";
    findings.push(item.kind === "statement"
      ? { kind: "statement_due", key: "statement:" + item.id, title, reason, action: "statement", refId, urgency, facts }
      : { kind: "bill_due", key: "bill:" + refId + ":" + item.date, title, reason, action: item.pending ? "check_bill" : "bill", refId, urgency, facts });
  }
  return findings;
}
export const statementDueFindings = (state: MoneyState, rules: StandingRules) => dueFindings(state, rules).filter(row => row.kind === "statement_due");
export const billDueFindings = (state: MoneyState, rules: StandingRules) => dueFindings(state, rules).filter(row => row.kind === "bill_due");

/** A regular cost that is up more than the rule's percent on last month. The percent is the pass's rule only; the facts are the amount of the change, as Regular costs says it. */
export function costUpFindings(state: MoneyState, rules: StandingRules): Finding[] {
  const percent = threshold(rules.cost_up);
  if (percent === null) return [];
  const { today, homeCurrency: currency } = state;
  const month = today.slice(0, 7);
  const from = monthsBack(month, REGULAR_MONTHS) + "-01", to = monthBounds(month).last;
  const bills = resolveBills(state.storedBills, today, currency);
  const items = spendingItems({ ...state, bills }, from, to);
  const period = { from: monthBounds(month).first, to };
  const findings: Finding[] = [];
  for (const cost of regularCosts(items, currency, today).items) {
    if (cost.status !== "up" || cost.lastMinor <= 0 || cost.changeMinor === null || cost.changeMinor * 100 <= cost.lastMinor * percent) continue;
    const about = { type: "cost" as const, id: cost.key, name: cost.label };
    const change = engineFact("change_from_last_month", cost.changeMinor, { from: FROM, currency, period, about });
    const facts = [change, ...(cost.estimated ? [engineFact("about_estimate", 1, { from: FROM, period, about })] : [])];
    findings.push({ kind: "cost_up", key: "cost:" + month + ":" + cost.key, title: cost.label + " costs more this month",
      reason: (cost.estimated ? "About " : "") + said(change) + " more than last month" + (cost.soFar ? " so far." : "."), action: "regular", refId: null, urgency: 4, facts });
  }
  return findings;
}

/** A subscription whose cancel-by day is within three days. */
export function cancelByFindings(state: MoneyState): Finding[] {
  const { today, homeCurrency: currency } = state;
  const findings: Finding[] = [];
  for (const notice of cancelNotices(state.storedBills, today, currency)) {
    if (notice.cancelBy > addDays(today, 3)) continue;
    const about = { type: "bill" as const, id: notice.billId, name: notice.biller };
    const facts: Fact[] = [engineFact("due", notice.renewsOn, { from: FROM, about })];
    if (notice.amount === null) facts.push(engineFact("not_counted", 1, { from: FROM, about }));
    else facts.push(engineFact("bill_amount", minorOf(state, notice.amount), { from: FROM, currency, about, period: { on: notice.renewsOn } }));
    facts.push(engineFact("cancel_by", notice.cancelBy, { from: FROM, about }));
    findings.push({ kind: "cancel_by", key: "cancel:" + notice.billId + ":" + notice.cancelBy,
      title: "Cancel " + notice.biller + " by " + dayLabel(String(named(facts, "cancel_by").value)),
      reason: "It renews " + dayLabel(String(named(facts, "due").value)) + " (" + (notice.amount === null ? AMOUNT_NOT_KNOWN : said(named(facts, "bill_amount"))) + ").",
      action: "bill", refId: notice.billId, urgency: 1, facts });
  }
  return findings;
}

/** A pot with a target date that is behind where it should be today. The facts are the goal pace picture's. */
export function goalBehindFindings(state: MoneyState): Finding[] {
  const currency = state.homeCurrency;
  const findings: Finding[] = [];
  for (const goal of goalPaces(state)) {
    if (goal.deltaMinor >= 0) continue;
    const about = { type: "pot" as const, id: goal.id, name: goal.name }, money = { from: FROM, currency, about };
    const facts = [
      engineFact("goal_pace", goal.deltaMinor, money),
      engineFact("goal_target_date", goal.targetDate, { from: FROM, about }),
      engineFact("goal_monthly_needed", goal.monthlyNeededMinor, money),
      engineFact("goal_still_to_set_aside", goal.neededMinor, money),
    ];
    findings.push({ kind: "goal_behind", key: "goal:" + goal.id + ":" + goal.targetDate, title: goal.name + " is behind its target",
      reason: minorMoney(-Number(named(facts, "goal_pace").value), currency) + " behind pace. " + said(named(facts, "goal_still_to_set_aside")) + " still to set aside by " + dayLabel(String(named(facts, "goal_target_date").value)) + ".",
      action: "pot", refId: goal.id, urgency: 4, facts });
  }
  return findings;
}

/** A pot with a fill rule that would fall short of its tax bills inside the tax-ahead days. The facts are the tax-ahead picture's. */
export function taxShortFindings(state: MoneyState): Finding[] {
  const currency = state.homeCurrency;
  const findings: Finding[] = [];
  for (const pot of state.pots) {
    const ahead = taxAhead(state, pot.id, TAX_AHEAD_DAYS);
    if (!ahead || !ahead.low.short) continue;
    const { low } = ahead, shortOn = addDays(state.today, low.index);
    const about = { type: "pot" as const, id: pot.id, name: pot.name };
    const facts: Fact[] = [
      engineFact("tax_ahead", low.shortMinor, { from: FROM, currency, about }),
      engineFact("tax_short_on", shortOn, { from: FROM, about }),
    ];
    const bills = ahead.taxBills.filter(bill => bill.index === low.index);
    for (const bill of bills) {
      const billAbout = { type: "bill" as const, id: bill.id, name: bill.biller };
      facts.push(...(bill.counted
        ? [engineFact("bill_amount", bill.amountMinor, { from: FROM, currency, about: billAbout, period: { on: bill.date } }), engineFact("due", bill.date, { from: FROM, about: billAbout })]
        : [engineFact("not_counted", 1, { from: FROM, about: billAbout })]));
    }
    const billWords = bills.filter(bill => bill.counted).map(bill => bill.biller + " " + minorMoney(bill.amountMinor, currency));
    findings.push({ kind: "tax_short", key: "tax:" + pot.id + ":" + shortOn, title: pot.name + " falls short of the tax bills",
      reason: said(named(facts, "tax_ahead")) + " short on " + dayLabel(String(named(facts, "tax_short_on").value)) + (billWords.length ? ", when " + billWords.join(" and ") + " is due." : "."),
      action: "pot", refId: pot.id, urgency: 4, facts });
  }
  return findings;
}

/** Safe to spend under the rule's own minimum, in the household's currency. */
export function safeBelowFindings(state: MoneyState, rules: StandingRules): Finding[] {
  const { today, homeCurrency: currency } = state;
  const minimum = threshold(rules.safe_below);
  if (minimum === null || rules.safe_below.currency !== currency) return [];
  const safe = engineFact("safe_to_spend", minorOf(state, safeToSpend(state).amount), { from: FROM, currency });
  if (Number(safe.value) >= minimum) return [];
  return [{ kind: "safe_below", key: "safe:" + today, title: "Safe to spend is below your rule",
    reason: said(safe) + " safe to spend, below " + minorMoney(minimum, currency) + ".", action: "runway", refId: null, urgency: 0, facts: [safe] }];
}

export function findSuggestions(state: MoneyState, rules: StandingRules): Finding[] {
  return [
    ...invoiceNudgeFindings(state, rules),
    ...dueFindings(state, rules),
    ...costUpFindings(state, rules),
    ...cancelByFindings(state),
    ...(rules.goal_behind.enabled ? [...goalBehindFindings(state), ...taxShortFindings(state)] : []),
    ...safeBelowFindings(state, rules),
  ];
}
