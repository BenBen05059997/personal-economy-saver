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
import { findOwnCategory, guessOwnCategory, listOwnCategoriesGrouped } from "@/db/own-categories";
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
import { BusinessBp, CategoryKeySchema, categoryLabel, type CategoryKey } from "@/lib/money/categories";
import { ownLabel } from "@/lib/money/own-category";
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
import { spaceTools } from "./space-tools";
import { historyTools } from "./history-tools";
import { briefTools } from "./brief-tools";
import type { Brief } from "./brief";
import { offerTools } from "./offer-tools";
import type { KeepOffer } from "./keep-offer";
import { checkTools } from "./check-tools";
import { splitBalance, splitSummary } from "@/lib/money/split";
import { CASE_KIND, type Recipe } from "@/lib/canvas/schema";
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
  incognito?: boolean;
  onOpenSpace?: (proposal: { name: string }) => void;
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
  .describe("Null lets the app guess from the name.");
// D75: the person's own categories are named, never given by id, and the agent never makes one.
const ownCategoryField = z.string().trim().min(1).max(80).nullable().default(null)
  .describe("Name of one of the household's own categories under the category the item gets, from own_categories. Null lets the app file it like the last item with this name. Never invent one.");
const businessField = BusinessBp.nullable().default(null)
  .describe("Business share in basis points. Null is personal.");
// D54's "amount varies" is set by the user on the form or in Settings, not by the agent; an agent's one-off still links on confirm.
const addBillInput = billInput.omit({ ownCategoryId: true, ownCategoryNew: true, paidByMemberId: true, category: true, businessBp: true, repeat: true, nextAmount: true, nextAmountFrom: true, cancelBy: true, repeatUntil: true, amountVaries: true, amountUnknown: true, dueUnknown: true, amount: true, due: true, periodStart: true, periodEnd: true }).extend({
  amount: z.string().trim().nullable().describe("Home-currency number as text. Null if unknown."),
  due: z.string().date().nullable().describe("Null if unknown. Repeating bills and cancel_by need a date."),
  repeat: RepeatUnitSchema.nullable().default(null).describe("Uses the due day. Null for a one-off."),
  next_amount: z.string().trim().nullable().default(null).describe("New home-currency amount for a repeating bill."),
  next_amount_from: z.string().date().nullable().default(null).describe("First day of next_amount, after due."),
  cancel_by: z.string().date().nullable().default(null).describe("Cancel-by date before the next charge."),
  repeat_until: z.string().date().nullable().default(null).describe("Last charge date of a repeating bill, on or after due."),
  period_start: z.string().date().nullable().default(null).describe("Start of the known service period. Use both period dates on one-offs only."),
  period_end: z.string().date().nullable().default(null).describe("End of the known service period, on or after period_start."),
  category: categoryField,
  own_category: ownCategoryField,
  business_bp: businessField,
  shared: z.boolean().nullable().default(null),
  paidBy: z.string().trim().min(1).max(80).nullable().default(null),
});
const logChargeInput = chargeInput.omit({ ownCategoryId: true, ownCategoryNew: true, category: true, businessBp: true, originalAmount: true, originalCurrency: true }).extend({
  category: categoryField, own_category: ownCategoryField, business_bp: businessField,
  original_amount: z.string().trim().nullable().default(null).describe("Number paid in original_currency. amount stays the billed amount."),
  original_currency: Currency.nullable().default(null).describe("Must differ from the card currency."),
});

/** The category a tool saves: the one given, or the keyword table's guess from the name; and the sentence that tells the agent which. */
function categoryFor(name: string, given: z.infer<typeof categoryField>): { category: z.infer<typeof CategoryKeySchema>; note: string } {
  if (given !== null) return { category: given, note: `Category: ${categoryLabel(given)}.` };
  const guess = guessCategory(name);
  return { category: guess.category, note: guess.sure
    ? `No category was given, so it was guessed from the name: ${categoryLabel(guess.category)}. The user can change it in To check.`
    : `No category was given and the name matched none, so it is ${categoryLabel(guess.category)}. The user can choose one in To check.` };
}

/** The refusal for an own category the household does not have: it lists the ones that exist and says only the person can make one. */
function unknownOwnWords(name: string, category: CategoryKey, names: string[]): string {
  const label = categoryLabel(category);
  return `"${name}" is not one of this household's own categories under ${label}. Under ${label} there ${names.length === 0 ? "are none yet" : `are: ${names.join(", ")}`}. Only the person can make a new one, in Spending → Your categories.`;
}

/**
 * D75: the own category a draft is filed under. A name given must be one of the household's under `category` (else an InputError the model reads, nothing saved);
 * with no name, the latest confirmed item with the same name and category decides ("it files itself"). Its default business share fills in only when the model gave none.
 */
async function ownFor(ctx: ToolContext, category: CategoryKey, itemName: string, given: string | null, businessGiven: boolean): Promise<{ ownCategoryId: string | null; businessBp: number | null; note: string }> {
  let own: { id: string; name: string; businessBp: number | null } | null;
  if (given !== null) {
    const { match, names } = await findOwnCategory(ctx.db, ctx.householdId, category, given);
    if (!match) throw new InputError(unknownOwnWords(given, category, names));
    own = match;
  } else own = await guessOwnCategory(ctx.db, ctx.householdId, category, itemName);
  if (!own) return { ownCategoryId: null, businessBp: null, note: "" };
  const share = !businessGiven && own.businessBp !== null && own.businessBp > 0;
  return {
    ownCategoryId: own.id, businessBp: share ? own.businessBp : null,
    note: ` Filed under ${ownLabel(category, own)}${given === null ? ", like last time" : ""}.${share ? ` Business share ${own.businessBp! / 100}% from its default.` : ""}`,
  };
}

/** Checks one add_bill item and turns it into what insertBill takes. Throws an InputError the model can read. */
async function prepareBill(ctx: ToolContext, input: z.infer<typeof addBillInput>) {
  const { shared, paidBy, category: given, own_category, business_bp, next_amount, next_amount_from, cancel_by, repeat_until, period_start, period_end, ...bill } = input;
  let paidByMemberId: string | null = null;
  if (paidBy !== null && !shared) throw new InputError("paidBy names who pays a shared bill; set shared to true");
  if (shared) {
    if (bill.memberId !== null) throw new InputError("A shared bill belongs to nobody in particular; leave memberId empty");
    if (paidBy === null) throw new InputError("Say who pays a shared bill (paidBy)");
    if (await memberCount(ctx.db, ctx.householdId) < 2) throw new InputError("Splitting a bill needs a second person; add one in Household → People");
    paidByMemberId = (await memberByName(ctx.db, ctx.householdId, paidBy)).id;
  }
  const { category, note: categoryNote } = categoryFor(bill.biller, given);
  const own = await ownFor(ctx, category, bill.biller, own_category, business_bp !== null);
  return {
    biller: bill.biller, note: categoryNote + own.note, status: "pending" as const,
    bill: { ...bill, amount: bill.amount ?? "", amountUnknown: bill.amount === null, dueUnknown: bill.due === null, category, ...(own.ownCategoryId !== null && { ownCategoryId: own.ownCategoryId }), businessBp: business_bp ?? own.businessBp ?? 0, paidByMemberId, nextAmount: next_amount, nextAmountFrom: next_amount_from, cancelBy: cancel_by, repeatUntil: repeat_until, periodStart: period_start, periodEnd: period_end },
  };
}

async function prepareCharge(ctx: ToolContext, input: z.infer<typeof logChargeInput>) {
  const { category: given, own_category, business_bp, original_amount, original_currency, ...charge } = input;
  const { category, note: categoryNote } = categoryFor(charge.merchant, given);
  const own = await ownFor(ctx, category, charge.merchant, own_category, business_bp !== null);
  return { merchant: charge.merchant, note: categoryNote + own.note, charge: {
    ...charge, category, ...(own.ownCategoryId !== null && { ownCategoryId: own.ownCategoryId }), businessBp: business_bp ?? own.businessBp ?? 0,
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
/** One draft: prepare it, insert it, and tell the screen something is pending. */
async function draftOne<I, P>(ctx: ToolContext, input: I, prepare: (ctx: ToolContext, item: I) => Promise<P>, insert: (db: Db, prepared: P) => Promise<unknown>): Promise<P> {
  const prepared = await prepare(ctx, input);
  await insert(ctx.db, prepared);
  ctx.onPending?.();
  return prepared;
}

/** Several drafts atomically: every item is prepared first, then all are inserted in one transaction; an error names the zero-based item. */
async function draftMany<I, P>(ctx: ToolContext, items: I[], prepare: (ctx: ToolContext, item: I) => Promise<P>, insert: (db: Db, prepared: P) => Promise<unknown>): Promise<P[]> {
  const prepared: P[] = [];
  for (const [i, item] of items.entries()) prepared.push(await atItem(i, () => prepare(ctx, item)));
  await ctx.db.transaction(async tx => {
    for (const [i, p] of prepared.entries()) await atItem(i, () => insert(tx as unknown as Db, p));
  });
  ctx.onPending?.();
  return prepared;
}

/** The most recent rows of each long list that the agent's snapshot carries (the export has them all). */
export const SNAPSHOT_TOOL_WINDOW = 100;

const insertPreparedBill = (ctx: ToolContext) => (db: Db, p: Awaited<ReturnType<typeof prepareBill>>) => insertBill(db, ctx.householdId, p.bill, p.status, by(ctx));
const insertPreparedCharge = (ctx: ToolContext) => (db: Db, p: Awaited<ReturnType<typeof prepareCharge>>) => insertCharge(db, ctx.householdId, p.charge, "pending", ctx.source ?? "manual", by(ctx));

export const tools: Tool[] = [
  defineTool({
    name: "where_am_i", scope: "read", input: none,
    description: "The household's 30-day outlook in one sentence: whether it is fine if clients pay as usual, and how short it is if they pay late.",
    run: async ctx => statusAnswer(await ctx.state()),
  }),
  defineTool({
    name: "whats_due", scope: "read", input: none,
    description: "Use for “what’s due?” or “what is due next?” Returns the next confirmed bill or statement, amount, date and coverage.",
    run: async ctx => dueAnswer(await ctx.state()),
  }),
  defineTool({
    name: "open_gaps", scope: "read", input: none,
    description: "Bills and readings missing a date or amount, urgent first. Quote the gap words and question. Estimates count when available and unknown dates count today. The person fills gaps in To check.",
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
    description: "Check a purchase in home-currency minor units. Use a card ID from list_clients_and_cards or null for all cards.",
    run: async (ctx, input) => {
      const state = await ctx.state();
      if (input.card_id && !state.cards.some(card => card.id === input.card_id)) throw new Error("Unknown card");
      return spendAnswer(state, input.amount_minor, input.card_id ?? undefined);
    },
  }),
  defineTool({
    name: "list_clients_and_cards", scope: "read", input: none,
    description: "Household client and card IDs and names, with each client’s usual and slowest days to pay. Mention pace when relevant.",
    run: async ctx => {
      const state = await ctx.state();
      const pace = (c: (typeof state.clients)[number]) => { const p = clientPace(c); return { usualDaysToPay: p?.usual ?? null, slowestDaysToPay: p?.slowest ?? null }; };
      return JSON.stringify({ clients: state.clients.map(c => ({ id: c.id, name: c.name, ...pace(c) })), cards: state.cards.map(c => ({ id: c.id, label: c.label })) });
    },
  }),
  defineTool({
    name: "timeline", scope: "read",
    input: z.object({ scenario: z.enum(["as_usual", "late"]), on: z.string().date().nullish().describe("One day within two years, or null.") }),
    description: "Cash flow for one specified day or the next 30 days, with running balances and the lowest point. Use whats_due for “what is due” questions without a date. Signed home-currency minor units. as_usual uses each client’s usual pay day and late uses their slowest day. Set on for one day, including end-of-day balance, or null for the next 30 days.",
    run: async (ctx, input) => {
      const state = await ctx.state();
      const kind = CASE_KIND[input.scenario];
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
    description: "Options to close a shortfall if clients pay late, cheapest first, with cost and status.",
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
    description: "The 50 latest invoices with status, USD cents, dates and each client’s usual and slowest days to pay.",
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
    description: `Version 4 household record for context and IDs. Up to ${SNAPSHOT_TOOL_WINDOW} most recent rows per long list. Check truncated. Pending rows do not count. Use engine tools for answers.`,
    run: async ctx => JSON.stringify(await loadHouseholdSnapshot(ctx.db, ctx.householdId, { events: false, recent: SNAPSHOT_TOOL_WINDOW })),
  }),
  defineTool({
    name: "goals", scope: "read", input: none,
    description: "Dated pots and savings pace, gaps and needed monthly saving. Quote summary. The goals query draws a progress canvas.",
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
    description: "Work out a savings target’s monthly pace, completion date and 30-day room. Amounts are home-currency minor units. A pot_id uses the existing pot’s savings and supplies omitted target details. Quote summary. Use add_pot for a draft.",
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
    description: "Shared bills and card charges since the last settlement, what each person paid and owes, and the fewest payments to settle. Quote summary.",
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
    description: "Confirmed bills and card charges by category and business share for one calendar month. Defaults to this month. Quote the tool’s words.",
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
    name: "own_categories", scope: "read", input: none,
    description: "The household's own categories under the fourteen, grouped by category, each with its default business share if set and how many bills and charges are filed under it. The only names add_bill and log_charge accept as own_category. Quote the tool's words.",
    run: async ctx => {
      const groups = await listOwnCategoriesGrouped(ctx.db, ctx.householdId);
      if (groups.length === 0) return "This household has no categories of its own yet. Only the person can make one, in Spending → Your categories.";
      const part = (o: (typeof groups)[number]["categories"][number]) => `${o.name} (${o.businessBp === null ? "no default business share" : `default business share ${o.businessBp / 100}%`}, ${o.items} ${o.items === 1 ? "item" : "items"})`;
      return groups.map(g => `Under ${g.label}: ${g.categories.map(part).join("; ")}.`).join("\n");
    },
  }),
  defineTool({
    name: "search_spending", scope: "read",
    input: z.object({
      query: z.string().max(SEARCH_QUERY_MAX).default("").describe("All words must match. Empty lists everything."),
      months: z.number().int().min(1).max(HISTORY_MONTHS).nullable().default(null).describe(`How many calendar months to look back, 1 to ${HISTORY_MONTHS}, the current month included; null = 3.`),
    }),
    description: "Search bills and card charges by name or category, newest month first. Unknown amounts due later this month are listed but never summed. Home-currency minor units. Quote summary.",
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
      month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "month is YYYY-MM").describe("Service month, YYYY-MM."),
      text: z.string().max(SEARCH_QUERY_MAX).default("").describe("Matches name or category. Empty lists all."),
    }),
    description: "Find bills whose service period overlaps the month, including waiting items. Returns biller, amount, due date, period, status and totals in each currency. For when money was paid or due, or a bill without a period, use month_by_category or search_spending. Quote summary.",
    run: async (ctx, input) => {
      const today = await householdDate(ctx.db, ctx.householdId);
      if (input.month > latestDate(today).slice(0, 7)) throw new InputError(`month must be no later than ${latestDate(today).slice(0, 7)}, two years from today`);
      return JSON.stringify(billsForMonth(await loadPeriodBills(ctx.db, ctx.householdId, input.month), input.month, input.text));
    },
  }),
  defineTool({
    name: "suggestions", scope: "read", input: none,
    description: "Open Home findings, most urgent first. Quote title and reason and name the space when spaceName is present.",
    run: async ctx => JSON.stringify(await openSuggestions(ctx.db, ctx.householdId)),
  }),
  defineTool({
    name: "regular_costs", scope: "read",
    input: z.object({
      months: z.number().int().min(2).max(6).nullable().default(null).describe(`How many calendar months to compare, 2 to 6, the current month included; null = ${REGULAR_MONTHS}.`),
    }),
    description: "Recurring bills and card charges by month, with changes and usual dates. This month includes confirmed bills still due and charges through today. Quote summary.",
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
    description: "Past 12 months’ PayPal fees and conversion markup by client, and foreign card costs by card. Quote the words and use returned guidance without naming other providers or forecasting exchange rates. The foreign_costs query draws a canvas.",
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
    description: "Draft a USD invoice for review. amount is dollars. Get client_id from list_clients_and_cards. Use a new UUID and reuse it on retry.",
    run: async (ctx, input) => {
      const id = await saveInvoiceDraft(ctx.db, ctx.householdId, input, by(ctx));
      const href = new URL("/invoices/" + id, ctx.appUrl).href;
      ctx.addLink?.({ label: "Review invoice draft", href });
      return `Review the draft at ${href}.`;
    },
  }),
  defineTool({
    name: "add_bill", scope: "draft", input: addBillInput,
    description: "Draft a bill for To check. Use a new UUID and reuse it on retry. A shared bill needs two people, paidBy by display name, and memberId null. Otherwise leave shared and paidBy null. Only confirmed bills count.",
    run: async (ctx, input) => {
      const { biller, note } = await draftOne(ctx, input, prepareBill, insertPreparedBill(ctx));
      return `${biller} is waiting in To check for the user to confirm. ${note}`;
    },
  }),
  defineTool({
    name: "add_bills", scope: "draft", input: z.object({ items: z.array(addBillInput).min(1).max(10) }),
    description: "Draft 1–10 bills atomically. Each item follows add_bill, including retry IDs. An error names the zero-based item.",
    run: async (ctx, input) => {
      const prepared = await draftMany(ctx, input.items, prepareBill, insertPreparedBill(ctx));
      return `${prepared.length} bills are waiting in To check for the user to confirm: ${prepared.map(p => `${p.biller} (${p.note})`).join(" ")}`;
    },
  }),
  defineTool({
    name: "log_charge", scope: "draft", input: logChargeInput,
    description: "Draft a card purchase for To check. amount is in the household’s home currency. date defaults to today. Get cardId from list_clients_and_cards. Shared requires two people and a member’s card. Ask for the billed amount if only the foreign amount is known. Reuse the UUID on retry.",
    run: async (ctx, input) => {
      const { merchant, note } = await draftOne(ctx, input, prepareCharge, insertPreparedCharge(ctx));
      return `${merchant} is waiting in To check for the user to confirm. ${note}`;
    },
  }),
  defineTool({
    name: "log_charges", scope: "draft", input: z.object({ items: z.array(logChargeInput).min(1).max(10) }),
    description: "Draft 1–10 card purchases atomically. Each item follows log_charge, including retry IDs. An error names the zero-based item.",
    run: async (ctx, input) => {
      const prepared = await draftMany(ctx, input.items, prepareCharge, insertPreparedCharge(ctx));
      return `${prepared.length} charges are waiting in To check for the user to confirm: ${prepared.map(p => `${p.merchant} (${p.note})`).join(" ")}`;
    },
  }),
  defineTool({
    name: "add_pot", scope: "draft", input: potInput.pick({ id: true, name: true, target: true, targetDate: true, fillPct: true }),
    description: "Draft a savings pot for To check. target is in home currency. targetDate and fillPct (% of each client payment) are optional. Use a new UUID and reuse it on retry.",
    run: async (ctx, input) => {
      await savePot(ctx.db, ctx.householdId, { ...input, saved: "0", memberId: null }, "pending", by(ctx));
      ctx.onPending?.();
      return `The ${input.name} pot is waiting in To check for the user to confirm.`;
    },
  }),
  defineTool({
    name: "update_bank_balance", scope: "draft", input: bankBalanceInput,
    description: "Draft the stated bank balance for To check. amount is in home currency and may be negative. Use a new UUID and reuse it on retry.",
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
  ...spaceTools,
];

/**
 * The tool's input as a JSON Schema for the Messages API with strict tool use: every property required (optional
 * ones are nullable in the zod schema), no extra properties, and the runtime Zod schema retains validation bounds. Bulk item guidance and enum lists live on the single-item tool.
 */
export function toolInputSchema(tool: Tool): Record<string, unknown> {
  const raw = zodToJsonSchema(tool.input, { $refStrategy: "none" }) as Record<string, unknown>;
  delete raw.$schema;
  return strictJsonSchema(strictShape(raw, tool.name !== "add_bills" && tool.name !== "log_charges"));
}

// type: ["string", "null"] becomes anyOf, and every object lists all of its properties as required.
function strictShape(node: unknown, keepDescriptions: boolean): Record<string, unknown> {
  const schema = { ...(node as Record<string, unknown>) };
  // These are validated by Zod. Sending them here makes the SDK spell them out as repeated prose.
  for (const key of ["default", "minLength", "maxLength", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "pattern", "multipleOf", "maxItems"])
    delete schema[key];
  if (!keepDescriptions) {
    delete schema.description;
    delete schema.enum;
  }
  if (Array.isArray(schema.type)) {
    const { type, description, ...rest } = schema;
    const variants = (type as string[]).map(t => t === "null" ? { type: "null" } : strictShape({
      ...rest, type: t, ...(Array.isArray(rest.enum) && { enum: rest.enum.filter(value => value !== null) }),
    }, keepDescriptions));
    return { ...(description === undefined ? {} : { description }), anyOf: variants };
  }
  if (schema.properties) {
    const props = Object.fromEntries(Object.entries(schema.properties as Record<string, unknown>).map(([k, v]) => [k, strictShape(v, keepDescriptions)]));
    schema.properties = props;
    schema.required = Object.keys(props);
  }
  if (schema.items) schema.items = strictShape(schema.items, keepDescriptions);
  if (Array.isArray(schema.anyOf)) schema.anyOf = schema.anyOf.map(item => strictShape(item, keepDescriptions));
  return schema;
}
