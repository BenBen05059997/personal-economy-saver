import { AMOUNT_NOT_KNOWN } from "./gaps";
import { dayLabel, majorMoney, minorMoney, minorPerUnit } from "./format";
import { clientPace, expectedPayDate } from "./pace";
import { goalPaces } from "./goals";
import { cancelNotices, resolveBills } from "./repeat";
import { REGULAR_MONTHS, regularCosts } from "./regular";
import { addDays, daysBetween, dueItems, safeToSpend } from "./runway";
import { monthBounds, monthsBack, spendingItems } from "./spending";
import type { Finding, StandingRule, StandingRules } from "./suggestion-types";
import type { MoneyState } from "./types";
import { stateThrough } from "./window";

const threshold = (rule: StandingRule) => rule.enabled ? rule.threshold : null;
const daysWords = (n: number) => n === 1 ? "1 day" : n + " days";

export function findSuggestions(state: MoneyState, rules: StandingRules, remindable: ReadonlySet<string>): Finding[] {
  const { today, homeCurrency } = state;
  const findings: Finding[] = [];
  const format = (amount: number) => majorMoney(amount, homeCurrency);
  const nudge = threshold(rules.nudge_after);
  for (const invoice of state.invoices) {
    if (invoice.status !== "sent") continue;
    const client = state.clients.find(row => row.id === invoice.clientId);
    if (!client) continue;
    const usual = invoice.sentOn && clientPace(client) ? expectedPayDate(client, invoice.sentOn) : null;
    const due = invoice.dueOn ?? (invoice.sentOn ? expectedPayDate(client, invoice.sentOn) : null);
    if (nudge !== null && due && remindable.has(invoice.id) && daysBetween(due, today) >= nudge) {
      findings.push({ kind: "invoice_nudge", key: "nudge:" + invoice.id, title: "Nudge " + client.name,
        reason: "The invoice is " + daysWords(daysBetween(due, today)) + " past due.", action: "remind", refId: invoice.id, urgency: 1 });
    }
    if (usual && today > usual) {
      findings.push({ kind: "late_client", key: "late:" + invoice.id, title: client.name + " is past their usual payment day",
        reason: "The invoice usually would have been paid by " + dayLabel(usual) + ".", action: "invoice", refId: invoice.id, urgency: 2 });
    }
  }

  const billAhead = threshold(rules.bill_ahead);
  const statementAhead = threshold(rules.statement_ahead);
  const horizon = Math.max(billAhead ?? 0, statementAhead ?? 0);
  const dueState = stateThrough(state, addDays(today, horizon));
  for (const item of dueItems(dueState, horizon + 1)) {
    const days = item.kind === "bill" ? billAhead : statementAhead;
    if (days === null || item.dueUnknown || item.date > addDays(today, days)) continue;
    const due = "due " + dayLabel(item.date);
    const amount = item.uncounted ? AMOUNT_NOT_KNOWN : (item.estimated ? "about " : "") + format(item.amount);
    const covered = item.covered ? "covered even if clients pay late" : item.expectedCovered ? "short if clients pay late" : "short even if clients pay as usual";
    const urgency = item.covered ? 3 : 0;
    if (item.kind === "statement") {
      findings.push({ kind: "statement_due", key: "statement:" + item.id, title: item.label + " " + due,
        reason: amount + ", " + covered + ".", action: "statement", refId: item.cardId!, urgency });
    } else {
      const refId = item.id.split("@")[0];
      findings.push({ kind: "bill_due", key: "bill:" + refId + ":" + item.date, title: item.label + " " + due,
        reason: amount + ", " + covered + ".", action: item.pending ? "check_bill" : "bill", refId, urgency });
    }
  }

  const percent = threshold(rules.cost_up);
  if (percent !== null) {
    const month = today.slice(0, 7);
    const from = monthsBack(month, REGULAR_MONTHS) + "-01";
    const to = monthBounds(month).last;
    const bills = resolveBills(state.storedBills, today, homeCurrency);
    const items = spendingItems({ ...state, bills }, from, to);
    for (const cost of regularCosts(items, homeCurrency, today).items) {
      if (cost.status !== "up" || cost.lastMinor <= 0 || cost.changeMinor === null || cost.changeMinor * 100 <= cost.lastMinor * percent) continue;
      const delta = minorMoney(cost.changeMinor, homeCurrency);
      findings.push({ kind: "cost_up", key: "cost:" + month + ":" + cost.key, title: cost.label + " costs more this month",
        reason: (cost.estimated ? "About " : "") + delta + " more than last month" + (cost.soFar ? " so far." : "."), action: "regular", refId: null, urgency: 4 });
    }
  }

  for (const notice of cancelNotices(state.storedBills, today, homeCurrency)) {
    if (notice.cancelBy > addDays(today, 3)) continue;
    findings.push({ kind: "cancel_by", key: "cancel:" + notice.billId + ":" + notice.cancelBy,
      title: "Cancel " + notice.biller + " by " + dayLabel(notice.cancelBy),
      reason: "It renews " + dayLabel(notice.renewsOn) + " (" + (notice.amount === null ? AMOUNT_NOT_KNOWN : format(notice.amount)) + ").",
      action: "bill", refId: notice.billId, urgency: 1 });
  }

  if (rules.goal_behind.enabled) for (const goal of goalPaces(state)) {
    if (goal.deltaMinor >= 0) continue;
    findings.push({ kind: "goal_behind", key: "goal:" + goal.id + ":" + goal.targetDate, title: goal.name + " is behind its target",
      reason: minorMoney(-goal.deltaMinor, homeCurrency) + " behind pace. " + minorMoney(goal.neededMinor, homeCurrency)
        + " still to set aside by " + dayLabel(goal.targetDate) + ".", action: "pot", refId: goal.id, urgency: 4 });
  }

  const minimum = threshold(rules.safe_below);
  if (minimum !== null && rules.safe_below.currency === homeCurrency) {
    const safe = safeToSpend(state, 0).amount;
    if (Math.round(safe * minorPerUnit(homeCurrency)) < minimum) {
      findings.push({ kind: "safe_below", key: "safe:" + today, title: "Safe to spend is below your rule",
        reason: format(safe) + " safe to spend, below " + minorMoney(minimum, homeCurrency) + ".", action: "runway", refId: null, urgency: 0 });
    }
  }
  return findings;
}
