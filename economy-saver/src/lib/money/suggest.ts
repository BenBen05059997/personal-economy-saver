// What the assistant notices (D64, D80): each kind is one function that works out its facts from the engine, then writes its title and reason from
// those facts, so a finding says nothing its facts do not (D79). The facts are the ones the matching picture carries for the same subject.
import { AMOUNT_NOT_KNOWN } from "./gaps";
import { engineFact, fact, type Fact } from "./facts";
import { dayLabel, fromMinor, minorMoney, plural, toMinor } from "./format";
import { goalPaces } from "./goals";
import { invoiceAbout } from "./pace";
import { cancelNotices, resolveBills } from "./repeat";
import { REGULAR_MONTHS, regularCosts } from "./regular";
import { arrivals, dueItems, expectedPayBasis, overdue, safeToSpend } from "./runway";
import { foundWins, isTaxPot, lastFoundPot, matchCandidates, medalAbout, medals, medalTitle } from "./saving";
import { monthBounds, monthName, monthPeriod, monthsBack, spendingItems, type SpendItem } from "./spending";
import type { Finding, StandingRule, StandingRules } from "./suggestion-types";
import { TAX_AHEAD_DAYS, taxAhead } from "./tax-ahead";
import type { MoneyState, Pot, SavingRecord } from "./types";
import { stateThrough } from "./window";
import { storedId } from "./name-key";
import { addDays, daysBetween } from "./dates";

const FROM = "suggestions";
const threshold = (rule: StandingRule) => rule.enabled ? rule.threshold : null;
const daysWords = (n: number) => n === 1 ? "1 day" : n + " days";
/** A money fact read back as words. */
const said = (item: Fact) => minorMoney(item.value as number, item.currency!);
/** A finding's own fact by name: its words read the figure back, never by position. */
const named = (facts: readonly Fact[], name: Parameters<typeof fact>[1]): Fact => { const found = fact(facts, name); if (!found) throw new Error(`A finding has no ${name} fact`); return found; };

/** A sent invoice with a payment link that is overdue by more than the rule's days (D64, D78: overdue is the forecast's own expected pay day gone by). */
function invoiceNudgeFindings(state: MoneyState, rules: StandingRules): Finding[] {
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
      engineFact("client_pays", toMinor(arrival.amountHome, state.homeCurrency), { from: FROM, case: "as_usual", currency, about, period: { on: arrival.expectedOn } }),
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
function dueFindings(state: MoneyState, rules: StandingRules): Finding[] {
  const { today, homeCurrency: currency } = state;
  const billAhead = threshold(rules.bill_ahead), statementAhead = threshold(rules.statement_ahead);
  const horizon = Math.max(billAhead ?? 0, statementAhead ?? 0);
  const dueState = stateThrough(state, addDays(today, horizon));
  const findings: Finding[] = [];
  for (const item of dueItems(dueState, horizon + 1)) {
    const days = item.kind === "bill" ? billAhead : statementAhead;
    if (days === null || item.dueUnknown || item.date > addDays(today, days)) continue;
    const refId = item.kind === "statement" ? item.cardId! : storedId(item.id);
    const about = { type: item.kind === "statement" ? "card" as const : "bill" as const, id: refId, name: item.label };
    const facts: Fact[] = [engineFact("due", item.date, { from: FROM, about })];
    if (item.uncounted) facts.push(engineFact("not_counted", 1, { from: FROM, about }));
    else {
      const name = item.kind === "bill" ? "bill_amount" : item.open ? "statement_open" : "statement_closed";
      facts.push(engineFact(name, toMinor(item.amount, state.homeCurrency), { from: FROM, currency, about, period: { on: item.date } }));
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

/** A regular cost that is up more than the rule's percent on last month. The percent is the pass's rule only; the facts are the amount of the change, as Regular costs says it. */
function costUpFindings(state: MoneyState, rules: StandingRules): Finding[] {
  const percent = threshold(rules.cost_up);
  if (percent === null) return [];
  const { today, homeCurrency: currency } = state;
  const month = today.slice(0, 7);
  const from = monthsBack(month, REGULAR_MONTHS) + "-01", to = monthBounds(month).last;
  const bills = resolveBills(state.storedBills, today, currency);
  const items = spendingItems({ ...state, bills }, from, to);
  const period = monthPeriod(month);
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
function cancelByFindings(state: MoneyState): Finding[] {
  const { today, homeCurrency: currency } = state;
  const findings: Finding[] = [];
  for (const notice of cancelNotices(state.storedBills, today, currency)) {
    if (notice.cancelBy > addDays(today, 3)) continue;
    const about = { type: "bill" as const, id: notice.billId, name: notice.biller };
    const facts: Fact[] = [engineFact("due", notice.renewsOn, { from: FROM, about })];
    if (notice.amount === null) facts.push(engineFact("not_counted", 1, { from: FROM, about }));
    else facts.push(engineFact("bill_amount", toMinor(notice.amount, state.homeCurrency), { from: FROM, currency, about, period: { on: notice.renewsOn } }));
    facts.push(engineFact("cancel_by", notice.cancelBy, { from: FROM, about }));
    findings.push({ kind: "cancel_by", key: "cancel:" + notice.billId + ":" + notice.cancelBy,
      title: "Cancel " + notice.biller + " by " + dayLabel(String(named(facts, "cancel_by").value)),
      reason: "It renews " + dayLabel(String(named(facts, "due").value)) + " (" + (notice.amount === null ? AMOUNT_NOT_KNOWN : said(named(facts, "bill_amount"))) + ").",
      action: "bill", refId: notice.billId, urgency: 1, facts });
  }
  return findings;
}

/** A pot with a target date that is behind where it should be today. The facts are the goal pace picture's. */
function goalBehindFindings(state: MoneyState): Finding[] {
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
function taxShortFindings(state: MoneyState): Finding[] {
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
function safeBelowFindings(state: MoneyState, rules: StandingRules): Finding[] {
  const { today, homeCurrency: currency } = state;
  const minimum = threshold(rules.safe_below);
  if (minimum === null || rules.safe_below.currency !== currency) return [];
  const safe = engineFact("safe_to_spend", toMinor(safeToSpend(state).amount, state.homeCurrency), { from: FROM, currency });
  if (Number(safe.value) >= minimum) return [];
  return [{ kind: "safe_below", key: "safe:" + today, title: "Safe to spend is below your rule",
    reason: said(safe) + " safe to spend, below " + minorMoney(minimum, currency) + ".", action: "runway", refId: null, urgency: 0, facts: [safe] }];
}

// ---- Saving wins (D81): three kinds that need the saving_wins rule, ask only what the engine found, and come after every other kind ----

const SAVING_URGENCY = 5;
const MEDAL_DAYS = 7;
const openSaving = (pot: Pot) => pot.doneOn === undefined && !isTaxPot(pot);

/** The pot a found win goes to: the one the newest found win went into, else the only open saving pot, else none. */
export function foundPot(record: SavingRecord, pots: readonly Pot[]): Pot | null {
  const learned = lastFoundPot(record, pots);
  if (learned) return learned;
  const open = pots.filter(openSaving);
  return open.length === 1 ? open[0] : null;
}

/** The largest saving found in the last closed month that was not kept yet, with the pot it would go to and what safe to spend would be after the move. */
function foundSavingFindings(state: MoneyState, rules: StandingRules, record: SavingRecord | null, items: readonly SpendItem[]): Finding[] {
  if (!rules.saving_wins.enabled || !record) return [];
  const { today, homeCurrency: currency } = state;
  const month = monthsBack(today.slice(0, 7), 2);
  const kept = new Set(record.choices.map(choice => choice.foundKey));
  const win = foundWins(items, currency, month, record, today).find(row => !kept.has(row.key));
  if (!win || !state.pots.some(openSaving)) return [];
  const pot = foundPot(record, state.pots);
  const about = { type: "choice" as const, id: win.key, name: win.label }, money = { from: FROM, currency, about };
  const facts: Fact[] = [engineFact("found_win", win.winMinor, { ...money, period: monthPeriod(month) })];
  if (win.kind === "under_usual") {
    const group = { type: "category" as const, id: win.ownId ?? win.category!, name: win.label };
    facts.push(engineFact("category_total", win.monthMinor, { from: FROM, currency, period: monthPeriod(month), about: group }), engineFact("usual_spending", win.baselineMinor, { ...money, period: monthPeriod(month) }));
  } else {
    const cost = { type: "cost" as const, id: win.key.slice(month.length + ":cost:".length), name: win.label };
    facts.push(engineFact("change_from_last_month", win.monthMinor - win.baselineMinor, { from: FROM, currency, period: monthPeriod(month), about: cost }));
  }
  let after: number | null = null;
  if (pot) {
    const moved = { ...state, pots: state.pots.map(row => row.id === pot.id ? { ...row, saved: row.saved + fromMinor(win.winMinor, currency) } : row) };
    const safe = safeToSpend(moved);
    const minimum = threshold(rules.safe_below);
    if (safe.low.amount < 0 || (minimum !== null && rules.safe_below.currency === currency && toMinor(safe.amount, currency) < minimum)) return [];
    after = toMinor(safe.amount, currency);
    facts.push(engineFact("safe_to_spend_after_change", after, { from: FROM, currency }),
      engineFact("pot", toMinor(pot.saved, currency), { from: FROM, currency, about: { type: "pot", id: pot.id, name: pot.name } }));
  }
  const label = String(win.label), name = monthName(month), got = said(named(facts, "found_win"));
  const put = pot ? "Put " + got + " in " + pot.name + "? Safe to spend would be " + said(named(facts, "safe_to_spend_after_change")) + "." : "Put it in a pot?";
  const [title, reason] = win.kind === "under_usual"
    ? [label + " came in " + got + " under your usual", name + ": " + said(named(facts, "category_total")) + " against your usual " + said(named(facts, "usual_spending")) + ". " + put]
    : win.kind === "cost_stopped"
      ? [label + " stopped in " + name, name + ": " + label + " cost " + got + " less than the month before. " + put]
      : [label + " cost " + got + " less in " + name, name + ": " + label + " cost " + got + " less than the month before. " + put];
  return [{ kind: "found_saving", key: "found:" + month, title, reason, action: "keep_win", refId: win.key, urgency: SAVING_URGENCY, facts }];
}

/** A purchase as the Saving page's move route names it: `charge:<id>`, or `bill:<id>|<day>` for a one-off bill. */
export const purchaseRef = (purchase: { kind: "charge" | "bill"; id: string; on: string | null }) => purchase.kind === "bill" ? "bill:" + purchase.id + "|" + purchase.on : "charge:" + purchase.id;

/** A purchase of the last 14 days that may have come from a pot: asked once, because its key is remembered when the finding is made. */
function potMatchFindings(state: MoneyState, rules: StandingRules, record: SavingRecord | null, items: readonly SpendItem[]): Finding[] {
  if (!rules.saving_wins.enabled || !record) return [];
  const { homeCurrency: currency } = state;
  const findings: Finding[] = [];
  for (const { purchase, pots } of matchCandidates(state, record, items)) {
    const candidates = pots.filter(openSaving);
    if (candidates.length === 0) continue;
    const bill = purchase.kind === "bill";
    const about = { type: purchase.kind, id: purchase.id, name: purchase.label } as const;
    const facts: Fact[] = [engineFact(bill ? "bill_amount" : "charge_amount", purchase.amountMinor, { from: FROM, currency, about, period: { on: purchase.date } })];
    for (const pot of candidates) facts.push(engineFact("pot", toMinor(pot.saved, currency), { from: FROM, currency, about: { type: "pot", id: pot.id, name: pot.name } }));
    const holds = facts.filter(item => item.name === "pot").map(item => item.about!.name + " holds " + said(item));
    findings.push({ kind: "pot_match", key: "match:" + (bill ? "bill:" + purchase.id + ":" + purchase.on : "charge:" + purchase.id),
      title: candidates.length === 1 ? "From your " + candidates[0].name + "?" : "One of the things you saved for?",
      reason: purchase.label + " " + said(named(facts, bill ? "bill_amount" : "charge_amount")) + " on " + dayLabel(purchase.date) + ". " + holds.join(". ") + ".",
      action: "match", refId: purchaseRef(purchase), urgency: SAVING_URGENCY, facts });
  }
  return findings;
}


/** The newest medal earned in the last week. */
function medalFindings(state: MoneyState, rules: StandingRules, record: SavingRecord | null): Finding[] {
  if (!rules.saving_wins.enabled || !record) return [];
  const { today, homeCurrency: currency } = state;
  const [medal] = medals(record, state.pots).filter(row => row.earnedOn !== null && row.earnedOn <= today && daysBetween(row.earnedOn, today) <= MEDAL_DAYS)
    .sort((a, b) => (a.earnedOn! < b.earnedOn! ? 1 : a.earnedOn! > b.earnedOn! ? -1 : b.level - a.level));
  if (!medal) return [];
  const about = medalAbout(medal);
  const facts: Fact[] = [engineFact("medal_earned_on", medal.earnedOn!, { from: FROM, about }),
    medal.kind === "choices" ? engineFact("choices_saved", medal.threshold, { from: FROM, currency, about })
      : medal.kind === "goals" ? engineFact("goals_reached", medal.threshold, { from: FROM, about }) : engineFact("months_set_aside", medal.threshold, { from: FROM, about })];
  const value = medal.kind === "choices" ? said(facts[1]) : plural(Number(facts[1].value), medal.kind === "goals" ? "goal" : "month");
  return [{ kind: "medal", key: "medal:" + medal.kind + ":" + medal.level, title: "New medal: " + medalTitle(medal),
    reason: value + "; earned " + dayLabel(String(named(facts, "medal_earned_on").value)) + ".", action: "wins", refId: null, urgency: SAVING_URGENCY, facts }];
}

/** `record` is the confirmed pot moves and choices and `items` the spending back to the four months before the last closed month; both are null and empty while the saving_wins rule is off. */
export function findSuggestions(state: MoneyState, rules: StandingRules, record: SavingRecord | null, items: readonly SpendItem[]): Finding[] {
  return [
    ...invoiceNudgeFindings(state, rules),
    ...dueFindings(state, rules),
    ...costUpFindings(state, rules),
    ...cancelByFindings(state),
    ...(rules.goal_behind.enabled ? [...goalBehindFindings(state), ...taxShortFindings(state)] : []),
    ...safeBelowFindings(state, rules),
    ...foundSavingFindings(state, rules, record, items),
    ...potMatchFindings(state, rules, record, items),
    ...medalFindings(state, rules, record),
  ];
}
