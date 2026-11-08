// One tool catalogue for the in-app agent and the MCP server (D40). Tools read the engine or call the same
// src/db functions as the forms. They never send: sending is the tap in src/app/api/approve/route.ts (D12).
import { and, desc, eq } from "drizzle-orm";
import { zodToJsonSchema } from "zod-to-json-schema";
import { strictJsonSchema } from "@/lib/ai/schema";
import { z } from "zod";
import { householdDate } from "@/db/account";
import { requireHousehold, type Db, type Maker } from "@/db/household";
import { bankBalanceInput, setBankBalance } from "@/db/bank-balance";
import { billInput, insertBill } from "@/db/bills";
import { readerInbox } from "@/db/reader-inbox";
import { chargeInput, insertCharge } from "@/db/charges";
import { foreignCosts } from "@/db/fx-cost";
import { openSuggestions } from "@/db/suggestions";
import { Currency } from "@/lib/catalogue/types";
import { catalogueMove } from "@/lib/catalogue/engine";
import { PAYPAL_RATES, foreignCostWords } from "@/lib/money/fx-cost";
import { InputError } from "@/db/input-error";
import { draftInput, saveInvoiceDraft } from "@/db/invoice-draft";
import { memberByName, memberCount } from "@/db/people";
import { potInput, savePot } from "@/db/pots";
import { loadHouseholdSnapshot } from "@/db/snapshot";
import { loadPeriodBills, loadSpending } from "@/db/spending";
import { toMinor } from "@/db/money";
import { clients, invoices } from "@/db/schema";
import { minorPerUnit } from "@/lib/money/format";
import { dayView } from "@/lib/money/window";
import { gapAmountWords, gapDateWords, gapQuestion, openGaps } from "@/lib/money/gaps";
import { dueAnswer, spendAnswer, statusAnswer } from "@/lib/money/ask";
import { BusinessBp, CATEGORY_KEYS, CategoryKeySchema, categoryLabel } from "@/lib/money/categories";
import { guessCategory } from "@/lib/money/categorise";
import { monthByCategory, monthText, monthWhen } from "@/lib/money/month";
import { HISTORY_MONTHS, monthBounds, monthsBack, SEARCH_QUERY_MAX, searchLine, searchSpending, spendingItems } from "@/lib/money/spending";
import { latestDate } from "@/lib/money/horizon";
import { billsForMonth } from "@/lib/money/period";
import { REGULAR_MONTHS, regularCosts } from "@/lib/money/regular";
import { fundingOptions } from "@/lib/money/options";
import { RepeatUnitSchema } from "@/lib/money/repeat";
import { clientPace } from "@/lib/money/pace";
import { goalPaces } from "@/lib/money/goals";
import { planFor, planLine } from "@/lib/money/plan";
import { low, series, timeline as engineTimeline } from "@/lib/money/runway";
import { directionOf } from "@/lib/schema/cash-flow";
import { canvasTools } from "./canvas-tools";
import { memoryTools } from "./memory-tools";
import type { ContextTurn } from "./context";
import { historyTools } from "./history-tools";
import { briefTools } from "./brief-tools";
import type { Brief } from "./brief";
import { offerTools } from "./offer-tools";
import type { KeepOffer } from "./keep-offer";
import { checkTools } from "./check-tools";
import { splitBalance, splitSummary } from "@/lib/money/split";
import type { Recipe } from "@/lib/canvas/schema";
import type { DeviceMemory } from "@/lib/store/memory-ops";
import type { MoneyState } from "@/lib/money/types";

export type ToolContext = {
  db: Db;
  householdId: string;
  state: () => Promise<MoneyState>;
  appUrl: URL;
  /** D50: who is calling; every row a tool writes carries it (and `askId` for Ask). */
  madeBy: "ask" | "mcp";
  askId?: string;
  /** How the question arrived; a charge logged from it keeps this as its source. */
  source?: "voice" | "manual";
  /** The agent shows these as buttons under the answer. */
  addLink?: (link: { label: string; href: string }) => void;
  /** Called when a tool leaves a row waiting in To check. */
  onPending?: () => void;
  /** Ask only (D60): `make_canvas` hands over its last valid recipe; `clarify` and `out_of_scope` end the question. */
  onCanvas?: (recipe: Recipe) => void;
  onClarify?: (clarify: { question: string; choices: string[] }) => void;
  onOutOfScope?: (reason: "off_topic" | "not_offered") => void;
  /** Ask only (D59): when the household keeps its memory on one device, the list the question carried and the changes `remember` and `forget` made to it (sent back in the reply, never stored). */
  deviceMemory?: DeviceMemory;
  /** Ask only (D67): collect offers for the reply without writing any records. */
  onOffer?: (offer: KeepOffer) => void;
  spaceId?: string;
  memorySpaceId?: string;
  canRemember?: boolean;
  deviceHistory?: ContextTurn[];
  onMemoryRead?: (id: string) => void;
  onBrief?: (brief: Brief) => void;
};

const by = (ctx: ToolContext): Maker => ({ madeBy: ctx.madeBy, ...(ctx.askId && { askId: ctx.askId }) });

export type Tool = {
  name: string;
  description: string;
  input: z.ZodObject<z.ZodRawShape>;
  scope: "read" | "draft" | "ask";
  /** `input` is already validated against `input`. */
  run: (ctx: ToolContext, input: never) => Promise<string>;
};

function defineTool<S extends z.ZodObject<z.ZodRawShape>>(tool: {
  name: string; description: string; input: S; scope: "read" | "draft" | "ask";
  run: (ctx: ToolContext, input: z.infer<S>) => Promise<string>;
}): Tool {
  return tool as unknown as Tool;
}

const none = z.object({});
// D45: the agent names people, not ids. `shared` and `paidBy` replace the form's member ids.
const categoryField = CategoryKeySchema.nullable().default(null)
  .describe(`One of: ${CATEGORY_KEYS.join(", ")}. null when the user did not say; the app then proposes one from the name and the user confirms it in To check.`);
const businessField = BusinessBp.nullable().default(null)
  .describe("The business share in basis points: 0 personal, 10000 business, 3000 for 30% business. null = personal.");
// D54's "amount varies" is set by the user on the form or in Settings, not by the agent; an agent's one-off still links on confirm.
const addBillInput = billInput.omit({ paidByMemberId: true, category: true, businessBp: true, repeat: true, nextAmount: true, nextAmountFrom: true, cancelBy: true, repeatUntil: true, amountVaries: true, amountUnknown: true, dueUnknown: true, amount: true, due: true, periodStart: true, periodEnd: true }).extend({
  amount: z.string().trim().nullable().describe("A plain number in the household's home currency (3800 for ¥3,800), or null when the user does not know the amount yet (D55: the app estimates it from earlier bills of the same name and asks the user to fill it in)."),
  due: z.string().date().nullable().describe("YYYY-MM-DD, or null when the user does not know the date yet (it counts as due today until the user fills it in). A bill that repeats, or has cancel_by, needs its date."),
  repeat: RepeatUnitSchema.nullable().default(null).describe("month = every month on the due date's day, year = every year on its month and day, null = a one-off."),
  next_amount: z.string().trim().nullable().default(null).describe("The amount from next_amount_from on, a plain number in the home currency (a price rise); needs repeat. null = unchanged."),
  next_amount_from: z.string().date().nullable().default(null).describe("YYYY-MM-DD, after the due date; the first date the next_amount applies on. null with no next_amount."),
  cancel_by: z.string().date().nullable().default(null).describe("YYYY-MM-DD, before the next time the bill is charged: the last day to cancel or change it. null = none."),
  repeat_until: z.string().date().nullable().default(null).describe("YYYY-MM-DD: the last time a repeating bill is charged (a gym membership that ends after December: its December due date); null = it goes on. Needs repeat; on or after due."),
  period_start: z.string().date().nullable().default(null).describe("YYYY-MM-DD: the first day the bill covers, only when the user says or the bill shows the month or dates it is for (a November electricity bill: 11-01). Information only: the bill still counts on its due date. Set together with period_end; a one-off only; null = not known."),
  period_end: z.string().date().nullable().default(null).describe("YYYY-MM-DD: the last day the bill covers (11-30 for November); on or after period_start. null with no period_start."),
  category: categoryField,
  business_bp: businessField,
  shared: z.boolean().nullable().default(null),
  paidBy: z.string().trim().min(1).max(80).nullable().default(null),
});
const logChargeInput = chargeInput.omit({ category: true, businessBp: true, originalAmount: true, originalCurrency: true }).extend({
  category: categoryField, business_bp: businessField,
  original_amount: z.string().trim().nullable().default(null).describe("D62: when the purchase was in another currency, the plain number the person paid in original_currency (12.50 for $12.50); amount stays what the card billed in the home currency. null = not in another currency."),
  original_currency: Currency.nullable().default(null).describe("USD or JPY: the currency the person paid in; it must differ from the card's currency. null = not in another currency."),
});

/** The category a tool saves: the one given, or the keyword table's guess from the name; and the sentence that tells the agent which. */
function categoryFor(name: string, given: z.infer<typeof categoryField>): { category: z.infer<typeof CategoryKeySchema>; note: string } {
  if (given !== null) return { category: given, note: `Category: ${categoryLabel(given)}.` };
  const guess = guessCategory(name);
  return { category: guess.category, note: guess.sure
    ? `No category was given, so it was guessed from the name: ${categoryLabel(guess.category)}. The user can change it in To check.`
    : `No category was given and the name matched none, so it is ${categoryLabel(guess.category)}. The user can choose one in To check.` };
}

/** Checks one add_bill item and turns it into what insertBill takes. Throws an InputError the model can read. */
async function prepareBill(ctx: ToolContext, input: z.infer<typeof addBillInput>) {
  const { shared, paidBy, category: given, business_bp, next_amount, next_amount_from, cancel_by, repeat_until, period_start, period_end, ...bill } = input;
  let paidByMemberId: string | null = null;
  if (paidBy !== null && !shared) throw new InputError("paidBy names who pays a shared bill; set shared to true");
  if (shared) {
    if (bill.memberId !== null) throw new InputError("A shared bill belongs to nobody in particular; leave memberId empty");
    if (paidBy === null) throw new InputError("Say who pays a shared bill (paidBy)");
    if (await memberCount(ctx.db, ctx.householdId) < 2) throw new InputError("Splitting a bill needs a second person; add one in Settings, People");
    paidByMemberId = (await memberByName(ctx.db, ctx.householdId, paidBy)).id;
  }
  const { category, note } = categoryFor(bill.biller, given);
  return {
    biller: bill.biller, note, status: "pending" as const,
    bill: { ...bill, amount: bill.amount ?? "", amountUnknown: bill.amount === null, dueUnknown: bill.due === null, category, businessBp: business_bp ?? 0, paidByMemberId, nextAmount: next_amount, nextAmountFrom: next_amount_from, cancelBy: cancel_by, repeatUntil: repeat_until, periodStart: period_start, periodEnd: period_end },
  };
}

function prepareCharge(input: z.infer<typeof logChargeInput>) {
  const { category: given, business_bp, original_amount, original_currency, ...charge } = input;
  const { category, note } = categoryFor(charge.merchant, given);
  return { merchant: charge.merchant, note, charge: {
    ...charge, category, businessBp: business_bp ?? 0,
    ...(original_amount !== null && { originalAmount: original_amount }), ...(original_currency !== null && { originalCurrency: original_currency }),
  } };
}

/** Runs one item of a bulk call; an InputError says which item (index counts from 0, like the paths in an invalid-input error). */
async function atItem<T>(index: number, run: () => Promise<T> | T): Promise<T> {
  try { return await run(); }
  catch (failure) {
    if (failure instanceof InputError) throw new InputError(`items[${index}]: ${failure.message}`);
    throw failure;
  }
}
/** The most recent rows of each long list that the agent's snapshot carries (the export has them all). */
export const SNAPSHOT_TOOL_WINDOW = 100;
const SCENARIOS = { as_usual: "expected", late: "worst" } as const;

export const tools: Tool[] = [
  defineTool({
    name: "where_am_i", scope: "read", input: none,
    description: "The household's 30-day outlook in one sentence: whether it is fine if clients pay as usual, and how short it is if they pay late.",
    run: async ctx => statusAnswer(await ctx.state()),
  }),
  defineTool({
    name: "whats_due", scope: "read", input: none,
    description: "The next confirmed bill or card statement due, and whether it is covered even if clients pay late.",
    run: async ctx => dueAnswer(await ctx.state()),
  }),
  defineTool({
    name: "open_gaps", scope: "read", input: none,
    description: "Bills and readings in To check that are missing an amount or a date (D55), urgent ones first. Each has missing (amount, date), the question to ask the user, amountWords (an estimate with its range and basis, or \"amount not known\"), dateWords, urgent and why (due_soon, or could_change_sentence when the estimate's high end or an uncounted amount could change the 30-day sentence). A missing amount is counted at the estimate, or for nothing when there is none; a missing date counts as due today. Quote the words as they are; the user fills a gap in To check.",
    run: async ctx => {
      const [state, inbox] = await Promise.all([ctx.state(), readerInbox(ctx.db, ctx.householdId)]);
      const gaps = openGaps(state, inbox.readings.map(({ id, value }) => ({ id, value })));
      return JSON.stringify({ gaps: gaps.map(gap => ({
        source: gap.source, id: gap.id, name: gap.name, status: gap.status, missing: gap.missing, due: gap.due, countedOn: gap.countedOn,
        question: gapQuestion(gap), ...(gap.missing.includes("amount") && { amountWords: gapAmountWords(gap) }), ...(gap.missing.includes("date") && { dateWords: gapDateWords(gap) }),
        urgent: gap.urgent, why: gap.why,
      })) });
    },
  }),
  defineTool({
    name: "can_i_spend", scope: "read",
    input: z.object({ amount_minor: z.number().int().positive().safe(), card_id: z.string().uuid().nullish() }),
    description: "Check a purchase. amount_minor is in the household's home currency minor units: whole yen for JPY, cents for USD. card_id (from list_clients_and_cards) limits the check to one card; null checks all cards.",
    run: async (ctx, input) => {
      const state = await ctx.state();
      if (input.card_id && !state.cards.some(card => card.id === input.card_id)) throw new Error("Unknown card");
      return spendAnswer(state, input.amount_minor, input.card_id ?? undefined);
    },
  }),
  defineTool({
    name: "list_clients_and_cards", scope: "read", input: none,
    description: "List client and card names and IDs for this household. Each client also has usualDaysToPay (the usual days from sending an invoice to being paid) and slowestDaysToPay, both null when the client has no paid invoice yet. Mention a client's pace when it bears on the answer.",
    run: async ctx => {
      const state = await ctx.state();
      const pace = (c: (typeof state.clients)[number]) => { const p = clientPace(c); return { usualDaysToPay: p?.usual ?? null, slowestDaysToPay: p?.slowest ?? null }; };
      return JSON.stringify({ clients: state.clients.map(c => ({ id: c.id, name: c.name, ...pace(c) })), cards: state.cards.map(c => ({ id: c.id, label: c.label })) });
    },
  }),
  defineTool({
    name: "timeline", scope: "read",
    input: z.object({ scenario: z.enum(["as_usual", "late"]), on: z.string().date().nullish().describe("YYYY-MM-DD: one day from today to two years ahead; null = the next 30 days.") }),
    description: "The next 30 days of dated money events (bills, card statements, expected client payments) with the running balance after each, and the lowest point with its date. Amounts are signed home-currency minor units: negative goes out. scenario as_usual means clients pay on their usual day; late means on their slowest day. Pass `on` for one day up to two years ahead, e.g. what's due or how much is left on Dec 31: the answer is that day's events and balanceAfterMinor, the balance at the end of that day.",
    run: async (ctx, input) => {
      const state = await ctx.state();
      const kind = SCENARIOS[input.scenario];
      const minor = (amount: number) => toMinor(amount, state.homeCurrency);
      const eventOut = (event: ReturnType<typeof engineTimeline>[number]) => ({
        date: event.date, label: event.label, kind: event.kind, amountMinor: minor(event.amount),
        currency: state.homeCurrency, direction: directionOf(minor(event.amount)), balanceAfterMinor: minor(event.balance), ...(event.pending ? { pending: true } : {}), ...(event.estimated ? { estimated: true } : {}), ...(event.uncounted ? { uncounted: true } : {}),
      });
      if (input.on != null) {
        let view;
        try { view = dayView(state, kind, input.on); } catch (error) { throw new InputError(error instanceof Error ? error.message : "That day cannot be read"); }
        return JSON.stringify({ scenario: input.scenario, today: state.today, currency: state.homeCurrency, on: view.date, balanceAfterMinor: minor(view.balance), events: view.events.map(eventOut) });
      }
      const lowest = low(series(state, kind));
      return JSON.stringify({
        scenario: input.scenario, today: state.today, currency: state.homeCurrency,
        low: { date: lowest.date, amountMinor: minor(lowest.amount) },
        events: engineTimeline(state, kind).map(eventOut),
      });
    },
  }),
  defineTool({
    name: "options_when_short", scope: "read", input: none,
    description: "When the household would run short if clients pay late: the ranked options to close the gap, cheapest first, with cost and status. Information only. Returns 'not short' when the runway is fine.",
    run: async ctx => {
      const state = await ctx.state();
      const plan = fundingOptions(state);
      if (!plan.gap) return "not short";
      const minor = (amount: number) => toMinor(amount, state.homeCurrency);
      return JSON.stringify({
        currency: state.homeCurrency, gapMinor: minor(plan.gap), shortOn: plan.date, repayOn: plan.repayOn,
        options: plan.rows.map(row => ({
          id: row.id, title: row.title, detail: row.detail, status: row.status, recommended: row.pick,
          costMinor: minor(row.cost), principalMinor: minor(row.principal),
          ...(row.repaymentCovered === undefined ? {} : { repaymentCovered: row.repaymentCovered }),
        })),
      });
    },
  }),
  defineTool({
    name: "list_invoices", scope: "read", input: none,
    description: "The household's 50 most recent invoices: client name, status, USD amount in cents, sent, due and paid dates, and the client's usualDaysToPay and slowestDaysToPay (days from sending to being paid; null when the client has no paid invoice yet).",
    run: async ctx => {
      const hid = requireHousehold(ctx.householdId);
      const state = await ctx.state();
      const rows = await ctx.db.select({
        clientId: clients.id, client: clients.name, number: invoices.number, item: invoices.item, status: invoices.status,
        amountMinor: invoices.amountMinor, currency: invoices.currency,
        sentOn: invoices.sentOn, dueOn: invoices.dueOn, paidOn: invoices.paidOn,
      }).from(invoices)
        .innerJoin(clients, and(eq(clients.householdId, invoices.householdId), eq(clients.id, invoices.clientId)))
        .where(eq(invoices.householdId, hid)).orderBy(desc(invoices.createdAt)).limit(50);
      return JSON.stringify(rows.map(({ clientId, ...row }) => {
        const pace = clientPace(state.clients.find(c => c.id === clientId) ?? { daysToPay: [] } as never);
        return { ...row, usualDaysToPay: pace?.usual ?? null, slowestDaysToPay: pace?.slowest ?? null };
      }));
    },
  }),
  defineTool({
    name: "household_snapshot", scope: "read", input: z.object({}).strict(),
    description: `The whole household as one JSON document (schema version 3; this tool gives the record only): household, members (with their shares of shared costs), cards, statements, charges, stored bills (a repeating bill appears once, with repeatUnit, repeatDay for a monthly one, and any nextAmountMinor from nextAmountFrom, cancelBy and repeatUntil, the last payment), clients, invoices, pots, settlements, bank balance updates and document references. Money is integer minor units next to a currency; dates are ISO strings. Use it as context for the household as a whole, to find ids and see what exists. It is not an answer: what the household can spend, what is due and how short it would be come from the engine tools (where_am_i, whats_due, can_i_spend, timeline). Rows with status pending are waiting in To check and count for nothing yet. Each of bills, charges, statements, invoices, balanceUpdates and documents holds at most its ${SNAPSHOT_TOOL_WINDOW} most recent rows, oldest first; truncated says which lists were cut. No audit-trail events and no secrets are included.`,
    run: async ctx => JSON.stringify(await loadHouseholdSnapshot(ctx.db, ctx.householdId, { events: false, recent: SNAPSHOT_TOOL_WINDOW })),
  }),
  defineTool({
    name: "goals", scope: "read", input: none,
    description: "Read the household’s dated savings goals and their progress, including what should be saved by now, the gap, what to save each month, and the date at the current pace if available. Amounts named Minor are home-currency minor units. Quote summary as written. To show the goals on a canvas use a progress block with query q goals.",
    run: async ctx => {
      const state = await ctx.state();
      const goals = goalPaces(state);
      return JSON.stringify({ currency: state.homeCurrency, goals, summary: goals.length ? null : "No dated savings goals yet." });
    },
  }),
  defineTool({
    name: "plan_for", scope: "read",
    input: z.object({
      target_minor: z.number().int().positive().safe().nullish(),
      target_date: z.string().date().nullish(),
      monthly_minor: z.number().int().positive().safe().nullish(),
      pot_id: z.string().uuid().nullish(),
    }),
    description: "Plan saving for something: how much to set aside each month to reach a target by a date, the date the target is reached at a monthly pace, and whether the next 30 days leave enough room. target_minor is the amount to reach, in home-currency minor units (whole yen for JPY, cents for USD). target_date (YYYY-MM-DD) asks for the monthly amount needed by then. monthly_minor tests a pace you were given; without it the pace is what the next 30 days leave over if clients pay as usual. pot_id (from the pots the user has) plans for an existing pot: its saved amount counts, and its target and date are used when you give none. Quote summary to the user as it is; it is built in code. Information only; use add_pot to put a pot in To check.",
    run: async (ctx, input) => {
      const state = await ctx.state();
      const pot = input.pot_id ? state.pots.find(p => p.id === input.pot_id) : undefined;
      if (input.pot_id && !pot) throw new Error("Unknown pot");
      const minor = (amount: number) => toMinor(amount, state.homeCurrency);
      const unit = (n: number) => n / minorPerUnit(state.homeCurrency);
      const target = input.target_minor != null ? unit(input.target_minor) : pot?.target;
      if (target === undefined) throw new Error("A target amount is required");
      const targetDate = input.target_date ?? pot?.targetDate;
      const monthly = input.monthly_minor != null ? unit(input.monthly_minor) : undefined;
      const request = { target, saved: pot?.saved ?? 0, ...(targetDate && { targetDate }), ...(monthly !== undefined && { monthly }) };
      const plan = planFor(request, state);
      return JSON.stringify({
        summary: planLine(request, plan, state), currency: state.homeCurrency,
        targetMinor: minor(target), savedMinor: minor(request.saved), neededMinor: minor(plan.needed), monthlyRoomMinor: minor(plan.monthlyRoom),
        ...(plan.months !== undefined && { months: plan.months }),
        ...(plan.monthlyNeeded !== undefined && { monthlyNeededMinor: minor(plan.monthlyNeeded) }),
        ...(plan.fits !== undefined && { fits: plan.fits }),
        ...(plan.pace !== undefined && { paceMinor: minor(plan.pace), monthsAtPace: plan.monthsAtPace, reachedOn: plan.reachedOn }),
      });
    },
  }),
  defineTool({
    name: "who_owes_whom", scope: "read", input: none,
    description: "Who owes whom for the household's shared bills and card charges since the last settlement, split by each person's share: the fewest payments that bring everyone to zero, and what each person has paid and owes. Quote summary to the user as it is; it is built in code. Information only; the user taps Mark settled in the app.",
    run: async ctx => {
      const state = await ctx.state();
      const balance = splitBalance(state.split, state.today);
      return JSON.stringify({
        summary: splitSummary(state.split, balance, state.homeCurrency), currency: state.homeCurrency,
        split: state.split.members.length > 1, since: state.split.since, settledThrough: state.split.settledThrough, items: balance.items,
        transfers: balance.transfers.map(t => ({ from: t.fromName, to: t.toName, amountMinor: t.amountMinor })),
        members: balance.members.map((m, i) => ({
          name: m.name, shareBp: state.split.members[i].shareBp, paidMinor: m.paidMinor, shareMinor: m.shareMinor, netMinor: m.netMinor,
        })),
      });
    },
  }),
  defineTool({
    name: "month_by_category", scope: "read",
    input: z.object({
      month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "month is YYYY-MM").nullable().default(null)
        .describe(`YYYY-MM, one of the last ${HISTORY_MONTHS} months including the current one; null = the current month.`),
    }),
    description: "Where a calendar month goes (the current one unless month is given): confirmed bills (a repeating bill once) and card charges in the home currency, grouped by category, each split into its business and personal part, with the items under each. Quote it to the user as it is; it is built in code. Information only: categories and business shares move no money and do not change what is safe to spend.",
    run: async (ctx, input) => {
      const today = await householdDate(ctx.db, ctx.householdId);
      const month = input.month ?? today.slice(0, 7);
      if (month > today.slice(0, 7) || month < monthsBack(today.slice(0, 7), HISTORY_MONTHS)) throw new InputError(`month must be one of the last ${HISTORY_MONTHS} months, ${monthsBack(today.slice(0, 7), HISTORY_MONTHS)} to ${today.slice(0, 7)}`);
      const { first, last } = monthBounds(month);
      const view = monthByCategory(await loadSpending(ctx.db, ctx.householdId, { from: first, to: last }), today, month);
      return monthText(view, monthWhen(month === today.slice(0, 7) ? undefined : view.name));
    },
  }),
  defineTool({
    name: "search_spending", scope: "read",
    input: z.object({
      query: z.string().max(SEARCH_QUERY_MAX).default("").describe("Words to find in bill and charge names or categories (hotel, rent, travel, food); every word must match. An empty string lists everything."),
      months: z.number().int().min(1).max(HISTORY_MONTHS).nullable().default(null).describe(`How many calendar months to look back, 1 to ${HISTORY_MONTHS}, the current month included; null = 3.`),
    }),
    description: `Where did the money go: confirmed bills (a repeating bill once per occurrence, at the amount of that day) and card charges up to today that match the query (plus bills due later this month whose amount is not known, listed as "amount not known" and never summed), by month, newest first, with totals per month and per category and the items. A word matches an item's name, its category key or its category label, so "hotel" and "travel" both find a hotel. Amounts are home-currency minor units (whole yen for JPY, cents for USD). Quote summary to the user as it is; it is built in code. Information only.`,
    run: async (ctx, input) => {
      const today = await householdDate(ctx.db, ctx.householdId);
      const from = `${monthsBack(today.slice(0, 7), input.months ?? 3)}-01`;
      const monthEnd = monthBounds(today.slice(0, 7)).last;
      const data = await loadSpending(ctx.db, ctx.householdId, { from, to: monthEnd });
      const result = searchSpending(spendingItems(data, from, monthEnd), input.query, data.homeCurrency, { from, to: today, uncountedTo: monthEnd });
      return JSON.stringify({ summary: searchLine(result), from, to: today, ...result });
    },
  }),
  defineTool({
    name: "bills_for_month", scope: "read",
    input: z.object({
      month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "month is YYYY-MM").describe("The month the bill is FOR, YYYY-MM (November's electricity is the bill that says 11月分 or a November service period, though it is usually paid in December)."),
      text: z.string().max(SEARCH_QUERY_MAX).default("").describe("Each word must match the biller's name or identify its category (electricity, gas). An empty string lists every bill for that month."),
    }),
    description: "What was a month's bill: every stored bill (confirmed or waiting in To check, past or due later) whose period, the month it is for, overlaps the month, each with its biller, amount (or amount not known), due date, period and status, and the totals per currency. Use it for \"what was November's electricity\" or \"the bill for October\": the month a bill is FOR. Use month_by_category or search_spending for the month money was PAID or is due. A bill with no period is not listed here; it is counted by its due date, so say so and use month_by_category. Amounts named Minor are minor units of the item's own currency (whole yen for JPY, cents for USD). Quote summary to the user as it is; it is built in code. Information only: the period moves no money and changes no forecast.",
    run: async (ctx, input) => {
      const today = await householdDate(ctx.db, ctx.householdId);
      if (input.month > latestDate(today).slice(0, 7)) throw new InputError(`month must be no later than ${latestDate(today).slice(0, 7)}, two years from today`);
      return JSON.stringify(billsForMonth(await loadPeriodBills(ctx.db, ctx.householdId, input.month), input.month, input.text));
    },
  }),
  defineTool({
    name: "suggestions", scope: "read", input: none,
    description: "Read the open findings shown on Home under From your assistant, most urgent first. Use it when the person asks what needs their attention or what the assistant noticed. Quote the title and reason as written. Information only.",
    run: async ctx => JSON.stringify(await openSuggestions(ctx.db, ctx.householdId)),
  }),
  defineTool({
    name: "regular_costs", scope: "read",
    input: z.object({
      months: z.number().int().min(2).max(6).nullable().default(null).describe(`How many calendar months to compare, 2 to 6, the current month included; null = ${REGULAR_MONTHS}.`),
    }),
    description: "Regular costs (D54): bills and card charges that come back month after month (a monthly repeating bill, or the same name and category in at least two of the months), each with its amount in every month (oldest first), this month against last month and a status: up, down, same, started, stopped, or not_yet (nothing this month yet; it usually comes later, on usualDay). This month is the month so far plus confirmed bills still due in it; card charges count up to today, and soFar says the amount can still grow. Amounts are home-currency minor units (whole yen for JPY, cents for USD). Quote summary to the user as it is; it is built in code. Information only.",
    run: async (ctx, input) => {
      const today = await householdDate(ctx.db, ctx.householdId);
      const months = input.months ?? REGULAR_MONTHS;
      const from = `${monthsBack(today.slice(0, 7), months)}-01`, to = monthBounds(today.slice(0, 7)).last;
      const data = await loadSpending(ctx.db, ctx.householdId, { from, to });
      const result = regularCosts(spendingItems(data, from, to), data.homeCurrency, today, months);
      return JSON.stringify({ summary: result.changedLine, from, to, ...result });
    },
  }),
  defineTool({
    name: "foreign_costs", scope: "read", input: none,
    description: "What foreign money cost the household over the last twelve months (D62): paid USD invoices received through PayPal (the fee to receive and the conversion markup, per client) and card purchases made in another currency (the cost above the reference rate, per card; exact when the billed amount is known, an estimate from the card's fee when it is not, unknown otherwise). Call it when the person asks what their foreign payments, card purchases abroad, PayPal fees or currency conversion cost them, or how to pay less for them. To show it, call make_canvas with a table or number block whose query is q foreign_costs (the same numbers, drawn so the person can pin it). Amounts named Minor are home-currency minor units. Quote words as they are; when guidance is present, the general ways to lower the cost come from it (never name another provider, never tell the person to leave PayPal, never forecast a rate). Information only.",
    run: async ctx => {
      const costs = await foreignCosts(ctx.db, ctx.householdId);
      const nothing = costs.chargeTotals.count === 0 && costs.payoutTotals.count === 0;
      const move = catalogueMove("JP", "jp-payout-cost");
      if (!move) throw new Error("The catalogue has no jp-payout-cost move");
      const source = move.sources[0];
      return JSON.stringify({
        months: 12, homeCurrency: costs.homeCurrency,
        charges: {
          ...costs.chargeTotals,
          perCard: costs.perCard,
          items: costs.charges.filter(c => c.inWindow).slice(0, 20).map(c => ({
            merchant: c.merchant, date: c.date, original: { minor: c.originalMinor, currency: c.originalCurrency }, billedMinor: c.billedMinor, costMinor: c.costMinor, kind: c.costKind,
          })),
        },
        payouts: { ...costs.payoutTotals, perClient: costs.perClient },
        nothing, words: foreignCostWords(costs),
        rates: { receivePct: (PAYPAL_RATES.receiveBp + PAYPAL_RATES.crossBorderBp) / 100, fixedUsdMinor: PAYPAL_RATES.fixedUsdMinor, conversionPct: PAYPAL_RATES.conversionBp / 100 },
        ...(!nothing && { guidance: { maySay: move.maySay, mustNotSay: move.mustNotSay, steps: move.steps, traps: move.traps, source: { title: source.title, url: source.url } } }),
      });
    },
  }),
  defineTool({
    name: "draft_invoice", scope: "draft", input: draftInput,
    description: "Save a local USD invoice draft for the user to review; nothing is sent. amount is dollars, like 18.52. id is a new UUID; reuse the same id when retrying. client_id comes from list_clients_and_cards.",
    run: async (ctx, input) => {
      const id = await saveInvoiceDraft(ctx.db, ctx.householdId, input, by(ctx));
      const href = new URL("/invoices/" + id, ctx.appUrl).href;
      ctx.addLink?.({ label: "Review invoice draft", href });
      return `Review the draft at ${href}.`;
    },
  }),
  defineTool({
    name: "add_bill", scope: "draft", input: addBillInput,
    description: `Add a bill the user tells you about (period_start and period_end name the month or dates it covers when known: "November's electricity"; the bill still counts on its due date). It waits in To check until the user confirms it; it does not count yet. amount is a plain number in the household's home currency (3800 for ¥3,800), or null when the user does not know it yet. due is YYYY-MM-DD, or null when the user does not know the date yet. A bill with a missing amount or date is saved anyway and shows in open_gaps until it is filled in. memberId is null for a household bill. repeat is "month" when the bill repeats every month on the due date's day (rent, phone, a subscription), "year" when it repeats every year on the due date's month and day (insurance, a domain, an annual plan), null for a one-off; it only starts repeating once the user confirms it. next_amount with next_amount_from says the amount changes from that date (a rent increase, a price rise; needs repeat, and the date is after the due date). cancel_by is the last day to cancel before the bill is charged again: the app shows it as a dated reminder and never cancels anything; it must be before the next time the bill is charged. repeat_until is the last day a repeating bill may be charged (a gym that ends after December: its December due date); nothing after it counts; null = it goes on. In a household of two or more people, shared is true when the bill is split between them and paidBy is the display name of the person who pays it (every month, for a monthly bill); otherwise leave both null. A shared bill has no memberId. category is one of ${CATEGORY_KEYS.join(", ")}, or null when the user did not say (the app proposes one from the name and the user confirms it in To check). business_bp is the part that is business, in basis points: 0 personal, 10000 all business, 3000 for 30%; null means personal. id is a new UUID; reuse the same id when retrying.`,
    run: async (ctx, input) => {
      const { bill, status, biller, note } = await prepareBill(ctx, input);
      await insertBill(ctx.db, ctx.householdId, bill, status, by(ctx));
      ctx.onPending?.();
      return `${biller} is waiting in To check for the user to confirm. ${note}`;
    },
  }),
  defineTool({
    name: "add_bills", scope: "draft", input: z.object({ items: z.array(addBillInput).min(1).max(10) }),
    description: "Add 1 to 10 bills the user tells you about in one call, when they give several at once. Each item has exactly the fields of add_bill and the same meaning (see add_bill). All of them are saved together and wait in To check until the user confirms them; if one item is invalid, none is saved and the error names the item's index (counting from 0), so fix it and send the whole list again. Each id is a new UUID; reuse the same ids when retrying.",
    run: async (ctx, input) => {
      const prepared: Awaited<ReturnType<typeof prepareBill>>[] = [];
      for (const [i, item] of input.items.entries()) prepared.push(await atItem(i, () => prepareBill(ctx, item)));
      const maker = by(ctx);
      await ctx.db.transaction(async tx => {
        for (const [i, p] of prepared.entries()) await atItem(i, () => insertBill(tx, ctx.householdId, p.bill, p.status, maker));
      });
      ctx.onPending?.();
      return `${prepared.length} bills are waiting in To check for the user to confirm: ${prepared.map(p => `${p.biller} (${p.note})`).join(" ")}`;
    },
  }),
  defineTool({
    name: "log_charge", scope: "draft", input: logChargeInput,
    description: `Log a card purchase the user tells you about. It waits in To check until the user confirms it. amount is a plain number in the household's home currency. date is YYYY-MM-DD (today if the user does not say). card_id comes from list_clients_and_cards. shared is true when the purchase is split between the household's people (needs two or more people and a card that belongs to one of them, who paid); false otherwise. category is one of ${CATEGORY_KEYS.join(", ")}, or null when the user did not say (the app proposes one from the merchant and the user confirms it in To check). business_bp is the part that is business, in basis points: 0 personal, 10000 all business, 3000 for 30%; null means personal. When the person says a purchase was in another currency, give the amount they paid in it as original_amount with original_currency (USD or JPY, different from the card's currency), and the billed home-currency amount in amount if they know it; if they know only the foreign amount, ask for the billed amount (clarify) rather than converting it yourself. id is a new UUID; reuse the same id when retrying.`,
    run: async (ctx, input) => {
      const { charge, merchant, note } = prepareCharge(input);
      await insertCharge(ctx.db, ctx.householdId, charge, "pending", ctx.source ?? "manual", by(ctx));
      ctx.onPending?.();
      return `${merchant} is waiting in To check for the user to confirm. ${note}`;
    },
  }),
  defineTool({
    name: "log_charges", scope: "draft", input: z.object({ items: z.array(logChargeInput).min(1).max(10) }),
    description: "Log 1 to 10 card purchases the user tells you about in one call, when they give several at once. Each item has exactly the fields of log_charge and the same meaning (see log_charge). All of them are saved together and wait in To check until the user confirms them; if one item is invalid, none is saved and the error names the item's index (counting from 0), so fix it and send the whole list again. Each id is a new UUID; reuse the same ids when retrying.",
    run: async (ctx, input) => {
      const prepared = input.items.map(prepareCharge);
      const maker = by(ctx);
      await ctx.db.transaction(async tx => {
        for (const [i, p] of prepared.entries()) await atItem(i, () => insertCharge(tx, ctx.householdId, p.charge, "pending", ctx.source ?? "manual", maker));
      });
      ctx.onPending?.();
      return `${prepared.length} charges are waiting in To check for the user to confirm: ${prepared.map(p => `${p.merchant} (${p.note})`).join(" ")}`;
    },
  }),
  defineTool({
    name: "add_pot", scope: "draft", input: potInput.pick({ id: true, name: true, target: true, targetDate: true, fillPct: true }),
    description: "Suggest a pot, money set aside with a reason, only when the user talks about saving for something or a payment just landed and they ask what to do. It waits in To check until the user confirms it; money in a pot is not safe to spend once confirmed. name is the reason (Car, Trip, Tax). target is a plain number in the household's home currency, or null. targetDate is YYYY-MM-DD, or null. fillPct is the share of each client payment to set aside, such as 25 for 25 percent, or null. id is a new UUID; reuse the same id when retrying.",
    run: async (ctx, input) => {
      await savePot(ctx.db, ctx.householdId, { ...input, saved: "0", memberId: null }, "pending", by(ctx));
      ctx.onPending?.();
      return `The ${input.name} pot is waiting in To check for the user to confirm.`;
    },
  }),
  defineTool({
    name: "update_bank_balance", scope: "draft", input: bankBalanceInput,
    description: "Update the household's bank balance to the amount the user tells you. It waits in To check until the user confirms it; the balance does not change yet. amount is the new balance as a plain number in the household's home currency (182000 for ¥182,000; a negative number if overdrawn). id is a new UUID; reuse the same id when retrying.",
    run: async (ctx, input) => {
      await setBankBalance(ctx.db, ctx.householdId, input, "pending", by(ctx));
      ctx.onPending?.();
      return "The new bank balance is waiting in To check for the user to confirm.";
    },
  }),
  ...canvasTools,
  ...checkTools,
  ...memoryTools,
  ...offerTools,
  ...briefTools,
  ...historyTools,
];

/**
 * The tool's input as a JSON Schema for the Messages API with strict tool use: every property required (optional
 * ones are nullable in the zod schema), no extra properties, constraints the API ignores moved into descriptions.
 */
export function toolInputSchema(tool: Tool): Record<string, unknown> {
  const raw = zodToJsonSchema(tool.input, { $refStrategy: "none" }) as Record<string, unknown>;
  delete raw.$schema;
  return strictJsonSchema(strictShape(raw));
}

// type: ["string", "null"] becomes anyOf, and every object lists all of its properties as required.
function strictShape(node: unknown): Record<string, unknown> {
  const schema = { ...(node as Record<string, unknown>) };
  if (Array.isArray(schema.type)) {
    const { type, description, ...rest } = schema;
    const variants = (type as string[]).map(t => t === "null" ? { type: "null" } : strictShape({ ...rest, type: t }));
    return { ...(description === undefined ? {} : { description }), anyOf: variants };
  }
  if (schema.properties) {
    const props = Object.fromEntries(Object.entries(schema.properties as Record<string, unknown>).map(([k, v]) => [k, strictShape(v)]));
    schema.properties = props;
    schema.required = Object.keys(props);
  }
  if (schema.items) schema.items = strictShape(schema.items);
  if (Array.isArray(schema.anyOf)) schema.anyOf = schema.anyOf.map(strictShape);
  return schema;
}
