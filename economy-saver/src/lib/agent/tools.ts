// One tool catalogue for the in-app agent and the MCP server (D40). Tools read the engine or call the same
// src/db functions as the forms. They never send: sending is the tap in src/app/api/approve/route.ts (D12).
import { and, count, desc, eq } from "drizzle-orm";
import { strictJsonSchema } from "@/lib/ai/schema";
import { z } from "zod";
import { householdDate } from "@/db/account";
import { requireHousehold, type Db } from "@/db/household";
import { bankBalanceInput, setBankBalance } from "@/db/bank-balance";
import { billInput, insertBill } from "@/db/bills";
import { readerInbox } from "@/db/reader-inbox";
import { chargeInput, insertCharge } from "@/db/charges";
import { findOwnCategory, guessOwnCategory, listOwnCategoriesGrouped } from "@/db/own-categories";
import { openSuggestions } from "@/db/suggestions";
import { canonicalJson, stableId } from "@/lib/stable-id";
import { Currency } from "@/lib/catalogue/types";
import { InputError } from "@/db/input-error";
import { draftInput, saveInvoiceDraft } from "@/db/invoice-draft";
import { memberByName, memberCount } from "@/db/people";
import { movePot, potInput, savePot } from "@/db/pots";
import { saveChoice } from "@/db/choices";
import { parseAmountMinor } from "@/db/money";
import { loadHouseholdSnapshot } from "@/db/snapshot";
import { loadPeriodBills, loadSpending } from "@/db/spending";
import { clients, invoices } from "@/db/schema";
import { fromMinor, minorPerUnit, plural, toMinor } from "@/lib/money/format";
import { dayView } from "@/lib/money/window";
import { gapAmountWords, gapDateWords, gapQuestion, openGaps } from "@/lib/money/gaps";
import { lowFacts, outlookFacts, spendReading } from "@/lib/money/ask";
import { engineFact, forModel, type Fact } from "@/lib/money/facts";
import { BusinessBp, CATEGORY_KEYS, CategoryKeySchema, categoryLabel, type CategoryKey } from "@/lib/money/categories";
import { ownLabel } from "@/lib/money/own-category";
import { guessCategory } from "@/lib/money/categorise";
import { HISTORY_MONTHS, monthBounds, monthsBack, SEARCH_QUERY_MAX, searchLine, searchSpending, spendingItems } from "@/lib/money/spending";
import { latestDate } from "@/lib/money/horizon";
import { billsForMonth } from "@/lib/money/period";
import { fundingOptions } from "@/lib/money/options";
import { RepeatUnitSchema } from "@/lib/money/repeat";
import { clientPace } from "@/lib/money/pace";
import { goalPaces } from "@/lib/money/goals";
import { planFor, planLine } from "@/lib/money/plan";
import { clientsOwe, low, overdue, series, timeline as engineTimeline, WINDOW_DAYS } from "@/lib/money/runway";
import { directionOf } from "@/lib/schema/cash-flow";
import { canvasTools } from "./canvas-tools";
import { by, defineTool } from "./define-tool";
import { viewTools, type Reading } from "./view-tools";
import { memoryTools } from "./memory-tools";
import type { OutOfScopeReason } from "./reply";
import type { LinkSource } from "@/lib/schema/turn";
import type { ContextTurn } from "./context";
import { spaceTools } from "./space-tools";
import { historyTools } from "./history-tools";
import { briefTools } from "./brief-tools";
import type { Brief } from "./brief";
import { offerTools } from "./offer-tools";
import type { KeepOffer } from "./keep-offer";
import { checkTools } from "./check-tools";
import { CASE_KIND, FACT_CASE } from "@/lib/money/terms";
import { MAX_BULK_ITEMS } from "./limits";
import type { Recipe } from "@/lib/canvas/schema";
import type { DeviceMemory } from "@/lib/store/memory-ops";
import type { MoneyState } from "@/lib/money/types";
import { daysBetween } from "@/lib/money/dates";

export type ToolContext = {
  db: Db;
  householdId: string;
  state: () => Promise<MoneyState>;
  appUrl: URL;
  /** D50: who is calling; every row a tool writes carries it (and `askId` for Ask). */
  madeBy: "ask" | "mcp";
  askId?: string;
  /** D81: the member this request acts as; a win or a move it drafts names them unless it says who. */
  memberId?: string | null;
  /** Ask only (D81): the numbers the person typed in this question and earlier questions of this conversation, in major units; never memory. MCP has none, and Confirm in To check is its guard. */
  said?: readonly number[];
  /** Ask only (D81): whether an amount in minor units was said, or is an engine money fact of this Ask. */
  known?: (minor: number) => boolean;
  /** MCP only: the request this call came in on; a draft's id is made from it, as from `askId` in Ask. */
  requestId?: string | number;
  /** How the question arrived; a charge logged from it keeps this as its source. */
  source?: "voice" | "manual";
  /** The agent shows these as buttons under the answer. */
  addLink?: (link: { label: string; href: string }) => void;
  /** Called when a tool leaves a row waiting in To check. */
  onPending?: () => void;
  /** Ask only (D60): `make_canvas` hands over its last valid recipe; `clarify` and `out_of_scope` end the question. */
  onCanvas?: (recipe: Recipe) => void;
  /** Ask only (D77): `show` hands over the view it drew; the run adds it to the answer's canvas. */
  onView?: (reading: Reading) => void;
  onClarify?: (clarify: { question: string; choices: string[] }) => void;
  onOutOfScope?: (reason: OutOfScopeReason) => void;
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

export type Tool = {
  name: string;
  description: string;
  /** The line a person reads while Ask runs this tool: words only, never an amount, an argument or a result. */
  words: string;
  /** The page this tool's answer came from, shown as "Based on"; none when the tool adds no page. */
  source?: LinkSource;
  /** The result repeats text the model wrote, so its facts confirm nothing. */
  echoes?: true;
  /** A valid call ends the question: the reply kind is chosen by code, with no further model call. */
  endsQuestion?: true;
  /** Writes or removes the person's memory. */
  memory?: true;
  input: z.ZodObject<z.ZodRawShape>;
  scope: "read" | "draft" | "ask";
  /** `input` is already validated against `input`. */
  run: (ctx: ToolContext, input: never) => Promise<string>;
};

const none = z.object({});
// D45: the agent names people, not ids. `shared` and `paidBy` replace the form's member ids.
const categoryField = CategoryKeySchema.nullable().default(null)
  .describe("Null: guessed from the name.");
// D75: the person's own categories are named, never given by id, and the agent never makes one.
const ownCategoryField = z.string().trim().min(1).max(80).nullable().default(null)
  .describe("An own_categories name, never invented. Null: as the last item of this name.");
const businessField = BusinessBp.nullable().default(null)
  .describe("Basis points; null: personal.");
// D54's "amount varies" is set by the user on the form or in Settings, not by the agent; an agent's one-off still links on confirm.
const addBillInput = billInput.omit({ id: true, ownCategoryId: true, ownCategoryNew: true, paidByMemberId: true, category: true, businessBp: true, repeat: true, nextAmount: true, nextAmountFrom: true, cancelBy: true, repeatUntil: true, amountVaries: true, amountUnknown: true, dueUnknown: true, amount: true, due: true, periodStart: true, periodEnd: true }).extend({
  amount: z.string().trim().nullable().describe("Text number; null if unknown."),
  due: z.string().date().nullable().describe("Null if unknown. Repeats need one."),
  repeat: RepeatUnitSchema.nullable().default(null).describe("Null for a one-off."),
  next_amount: z.string().trim().nullable().default(null).describe("New amount."),
  next_amount_from: z.string().date().nullable().default(null).describe("After due."),
  cancel_by: z.string().date().nullable().default(null).describe("Before the next charge."),
  repeat_until: z.string().date().nullable().default(null).describe("Last charge, on or after due."),
  period_start: z.string().date().nullable().default(null).describe("Period start; one-offs only."),
  period_end: z.string().date().nullable().default(null).describe("On or after period_start."),
  category: categoryField,
  own_category: ownCategoryField,
  business_bp: businessField,
  shared: z.boolean().nullable().default(null),
  paidBy: z.string().trim().min(1).max(80).nullable().default(null),
});
const logChargeInput = chargeInput.omit({ id: true, ownCategoryId: true, ownCategoryNew: true, category: true, businessBp: true, originalAmount: true, originalCurrency: true }).extend({
  category: categoryField, own_category: ownCategoryField, business_bp: businessField,
  original_amount: z.string().trim().nullable().default(null).describe("Paid in original_currency."),
  original_currency: Currency.nullable().default(null).describe("Not the card currency."),
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
async function prepareBill(ctx: ToolContext, input: z.infer<typeof addBillInput>, id: string) {
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
    bill: { id, ...bill, amount: bill.amount ?? "", amountUnknown: bill.amount === null, dueUnknown: bill.due === null, category, ...(own.ownCategoryId !== null && { ownCategoryId: own.ownCategoryId }), businessBp: business_bp ?? own.businessBp ?? 0, paidByMemberId, nextAmount: next_amount, nextAmountFrom: next_amount_from, cancelBy: cancel_by, repeatUntil: repeat_until, periodStart: period_start, periodEnd: period_end },
  };
}

async function prepareCharge(ctx: ToolContext, input: z.infer<typeof logChargeInput>, id: string) {
  const { category: given, own_category, business_bp, original_amount, original_currency, ...charge } = input;
  const { category, note: categoryNote } = categoryFor(charge.merchant, given);
  const own = await ownFor(ctx, category, charge.merchant, own_category, business_bp !== null);
  return { merchant: charge.merchant, note: categoryNote + own.note, charge: {
    id, ...charge, category, ...(own.ownCategoryId !== null && { ownCategoryId: own.ownCategoryId }), businessBp: business_bp ?? own.businessBp ?? 0,
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
/**
 * The id of a draft, made by code (D40): the same household, Ask or MCP request, tool, input and item place give the same id, so a call made twice is one draft.
 * A call with neither an Ask nor an MCP request behind it (a test calling a tool directly) gets a fresh one.
 */
async function draftId(ctx: ToolContext, tool: string, input: unknown, index = 0): Promise<string> {
  const call = ctx.askId ?? ctx.requestId;
  return call === undefined ? crypto.randomUUID() : stableId(ctx.householdId, String(call), tool, canonicalJson(input), index);
}

/** One draft: make its id, prepare it, insert it, and tell the screen something is pending. */
async function draftOne<I, P>(ctx: ToolContext, tool: string, input: I, prepare: (ctx: ToolContext, item: I, id: string) => Promise<P>, insert: (db: Db, prepared: P) => Promise<unknown>): Promise<P> {
  const prepared = await prepare(ctx, input, await draftId(ctx, tool, input));
  await insert(ctx.db, prepared);
  ctx.onPending?.();
  return prepared;
}

/** Several drafts atomically: every item is prepared first, then all are inserted in one transaction; an error names the zero-based item. */
async function draftMany<I, P>(ctx: ToolContext, tool: string, items: I[], prepare: (ctx: ToolContext, item: I, id: string) => Promise<P>, insert: (db: Db, prepared: P) => Promise<unknown>): Promise<P[]> {
  const prepared: P[] = [];
  for (const [i, item] of items.entries()) prepared.push(await atItem(i, async () => prepare(ctx, item, await draftId(ctx, tool, item, i))));
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

/** One fact per timeline event, about its bill, card or client, on its day and in the case tested. An amount not known is "not counted", never 0. */
function eventFacts(state: MoneyState, events: ReturnType<typeof engineTimeline>, scenario: "as_usual" | "late"): Fact[] {
  const from = "timeline", currency = state.homeCurrency, period = (date: string) => ({ on: date });
  return events.flatMap(event => {
    const about = event.kind === "bill" ? { type: "bill" as const, id: event.id, name: event.label }
      : event.kind === "statement" ? { type: "card" as const, id: event.cardId ?? event.id, name: event.label }
      : { type: "client" as const, id: event.clientId ?? event.id, name: event.label };
    if (event.uncounted) return [engineFact("not_counted", 1, { from, about, period: period(event.date) })];
    const minor = Math.abs(toMinor(event.amount, currency));
    if (event.pending) return [engineFact("to_check_amount", minor, { from, currency, about, period: period(event.date) })];
    const name = event.kind === "bill" ? "bill_counted" : event.kind === "arrival" ? "client_pays" : event.open ? "statement_open" : "statement_closed";
    const named = name === "bill_counted" || name === "client_pays";
    const money = engineFact(name, minor, { from, currency, about, period: period(event.date), ...(named ? { case: scenario } : {}) });
    return event.estimated ? [money, engineFact("about_estimate", 1, { from, about, period: period(event.date) })] : [money];
  });
}

const potMoveInput = z.object({
  pot: z.string().trim().min(1).max(80), kind: z.enum(["put_in", "take_out", "paid_for", "move_to"]),
  amount: z.string().trim().max(40).nullable().default(null), purchase: z.string().trim().max(80).nullable().default(null),
  purchase_on: z.string().date().nullable().default(null), to_pot: z.string().trim().min(1).max(80).nullable().default(null),
  words: z.string().trim().min(1).max(200).nullable().default(null), who: z.string().trim().min(1).max(80).nullable().default(null),
}).strict();
const addWinInput = z.object({
  what: z.string().trim().min(1).max(160), amount: z.string().trim().max(40).nullable().default(null),
  instead: z.string().trim().max(40).nullable().default(null), paid: z.string().trim().max(40).nullable().default(null),
  on: z.string().date().nullable().default(null), category: z.enum(CATEGORY_KEYS).nullable().default(null),
  who: z.string().trim().min(1).max(80).nullable().default(null),
}).strict();
const NO_GUESS = "Ask the person how much; fipa never guesses a price.";

/** A confirmed pot of this household by name (case does not matter); an InputError that lists the pots when none matches. */
async function potNamed(ctx: ToolContext, name: string, state: MoneyState): Promise<MoneyState["pots"][number]> {
  const wanted = name.trim().toLowerCase();
  const found = state.pots.find(pot => pot.name.trim().toLowerCase() === wanted);
  if (found) return found;
  if (state.pendingPots.some(pot => pot.name.trim().toLowerCase() === wanted)) throw new InputError(`${name.trim()} is still waiting in To check; it takes no money until the person confirms it`);
  throw new InputError(`No pot called ${name.trim()}. ${state.pots.length === 0 ? "There are no pots yet" : `The pots are: ${state.pots.map(pot => pot.name).join(", ")}`}.`);
}

const memberFor = async (ctx: ToolContext, who: string | null): Promise<string | null> =>
  who !== null ? (await memberByName(ctx.db, ctx.householdId, who)).id : ctx.memberId ?? null;

/** An amount the person typed: only in Ask, where `said` is set, must the number be one they said. */
function requireSaid(ctx: ToolContext, minor: number, currency: Currency): void {
  if (ctx.said !== undefined && !ctx.said.some(n => Math.round(n * minorPerUnit(currency)) === minor)) throw new InputError(NO_GUESS);
}

export const tools: Tool[] = [
  defineTool({
    name: "open_gaps", words: "Checking what's still unknown", source: { label: "To check", href: "/to-check" }, scope: "read", input: none,
    description: "Bills and readings missing a date or amount, urgent first. Quote the gap words and question. Unknown dates count today.",
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
    name: "can_i_spend", words: "Checking what you can spend", source: { label: "Safe to spend", href: "/" }, scope: "read",
    input: z.object({ amount_minor: z.number().int().positive().safe(), card_id: z.uuid().nullish() }),
    description: "Check a purchase in minor units. Card ID from list_clients_and_cards; null: all cards.",
    run: async (ctx, input) => {
      const state = await ctx.state();
      if (input.card_id && !state.cards.some(card => card.id === input.card_id)) throw new Error("Unknown card");
      const reading = spendReading(state, input.amount_minor, input.card_id ?? undefined);
      return JSON.stringify({ line: reading.text, ...forModel(reading.facts) });
    },
  }),
  defineTool({
    name: "list_clients_and_cards", words: "Checking your clients and cards", source: { label: "Clients", href: "/clients" }, scope: "read", input: none,
    description: "Client and card IDs and names, with each client’s usual and slowest days to pay.",
    run: async ctx => {
      const state = await ctx.state();
      const pace = (c: (typeof state.clients)[number]) => { const p = clientPace(c); return { usualDaysToPay: p?.usual ?? null, slowestDaysToPay: p?.slowest ?? null }; };
      const facts = state.clients.flatMap(c => {
        const p = clientPace(c), about = { type: "client" as const, id: c.id, name: c.name };
        return p ? [engineFact("usual_days_to_pay", p.usual, { from: "list_clients_and_cards", about }), engineFact("slowest_days_to_pay", p.slowest, { from: "list_clients_and_cards", about })] : [];
      });
      return JSON.stringify({ ...forModel(facts), clients: state.clients.map(c => ({ id: c.id, name: c.name, ...pace(c) })), cards: state.cards.map(c => ({ id: c.id, label: c.label })) });
    },
  }),
  defineTool({
    name: "timeline", words: "Lining up the dates", source: { label: "Coming up", href: "/#coming-up" }, scope: "read",
    input: z.object({ scenario: z.enum(["usual", "late"]), on: z.string().date().nullish().describe("One day (end-of-day balance) or null for all 30.") }),
    description: "Cash flow for a day or next 30: balances and lowest point. usual = usual days, late = slowest. None past 30 days.",
    run: async (ctx, input) => {
      const state = await ctx.state();
      const kind = CASE_KIND[input.scenario];
      const factCase = FACT_CASE[input.scenario];
      const minor = (amount: number) => toMinor(amount, state.homeCurrency);
      const eventOut = (event: ReturnType<typeof engineTimeline>[number]) => ({
        date: event.date, label: event.label, kind: event.kind, amountMinor: minor(event.amount),
        currency: state.homeCurrency, direction: directionOf(minor(event.amount)), balanceAfterMinor: minor(event.balance), ...(event.pending ? { pending: true } : {}), ...(event.estimated ? { estimated: true } : {}), ...(event.uncounted ? { uncounted: true } : {}),
      });
      const beyond = input.on != null && input.on >= state.today && daysBetween(state.today, input.on) >= WINDOW_DAYS;
      if (input.on != null && !beyond) {
        let view;
        try { view = dayView(state, kind, input.on); } catch (error) { throw new InputError(error instanceof Error ? error.message : "That day cannot be read"); }
        return JSON.stringify({ ...forModel(eventFacts(state, view.events, factCase)), scenario: input.scenario, today: state.today, currency: state.homeCurrency, on: view.date, balanceAfterMinor: minor(view.balance), events: view.events.map(eventOut) });
      }
      const lowest = low(series(state, kind));
      const events = engineTimeline(state, kind);
      return JSON.stringify({
        ...forModel([...lowFacts(state, lowest, factCase, "timeline"), ...eventFacts(state, events, factCase)]),
        scenario: input.scenario, today: state.today, currency: state.homeCurrency,
        ...(beyond && { note: `fipa looks ${WINDOW_DAYS} days ahead, so it has no balance for ${input.on}. These are the figures for the next ${WINDOW_DAYS} days; tell the person that fipa looks ${WINDOW_DAYS} days ahead and give no balance for the later day.` }),
        low: { date: lowest.date, amountMinor: minor(lowest.amount) },
        events: events.map(eventOut),
      });
    },
  }),
  defineTool({
    name: "options_when_short", words: "Looking at your options", source: { label: "Options", href: "/options" }, scope: "read", input: none,
    description: "Ways to close a shortfall if clients pay late, cheapest first, with cost and status.",
    run: async ctx => {
      const state = await ctx.state();
      const plan = fundingOptions(state);
      if (!plan.gap) return JSON.stringify({ line: "not short", ...forModel(outlookFacts(state, "options_when_short")), currency: state.homeCurrency, options: [] });
      const minor = (amount: number) => toMinor(amount, state.homeCurrency);
      const from = "options_when_short", currency = state.homeCurrency;
      const facts = [
        engineFact("short", minor(plan.gap), { from, currency, case: "late", period: { on: plan.date } }),
        ...plan.rows.map(row => engineFact("option_cost", minor(row.cost), { from, currency, about: { type: "cost", id: row.id, name: row.title } })),
      ];
      return JSON.stringify({
        ...forModel(facts), currency: state.homeCurrency, gapMinor: minor(plan.gap), shortOn: plan.date, repayOn: plan.repayOn,
        options: plan.rows.map(row => ({
          id: row.id, title: row.title, detail: row.detail, status: row.status, recommended: row.pick,
          costMinor: minor(row.cost), principalMinor: minor(row.principal),
          ...(row.repaymentCovered === undefined ? {} : { repaymentCovered: row.repaymentCovered }),
        })),
      });
    },
  }),
  defineTool({
    name: "list_invoices", words: "Reading your invoices", source: { label: "Clients", href: "/clients" }, scope: "read", input: none,
    description: "Invoice counts by status (quote them) and the 50 latest invoices: status, USD cents, dates, each client’s usual and slowest days to pay.",
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
      const byStatus = await ctx.db.select({ status: invoices.status, n: count() }).from(invoices).where(eq(invoices.householdId, hid)).groupBy(invoices.status);
      const countsByStatus = Object.fromEntries(byStatus.map(row => [row.status, row.n]));
      const total = byStatus.reduce((sum, row) => sum + row.n, 0);
      const factFrom = "list_invoices", currency = state.homeCurrency;
      const facts = [
        engineFact("clients_owe", toMinor(clientsOwe(state), currency), { from: factFrom, currency }),
        ...state.invoices.filter(invoice => invoice.status === "sent").map(invoice => engineFact("days_overdue", overdue(state, invoice).daysOverdue, { from: factFrom, about: { type: "invoice", id: invoice.id, name: invoice.number ?? invoice.item } })),
      ];
      return JSON.stringify({
        ...forModel(facts), total, countsByStatus,
        ...(total > rows.length && { listed: `Only the ${rows.length} latest invoices are listed; the counts cover all ${total}.` }),
        invoices: rows.map(({ clientId, ...row }) => {
          const pace = clientPace(state.clients.find(c => c.id === clientId) ?? { daysToPay: [] } as never);
          return { ...row, usualDaysToPay: pace?.usual ?? null, slowestDaysToPay: pace?.slowest ?? null };
        }),
      });
    },
  }),
  defineTool({
    name: "household_snapshot", words: "Reading your household", scope: "read", input: z.object({}).strict(),
    description: `Household record for context and IDs: the ${SNAPSHOT_TOOL_WINDOW} latest rows per long list. Check truncated. Pending rows don’t count.`,
    run: async ctx => JSON.stringify(await loadHouseholdSnapshot(ctx.db, ctx.householdId, { events: false, recent: SNAPSHOT_TOOL_WINDOW })),
  }),
  defineTool({
    name: "goals", words: "Checking your goal progress", source: { label: "Saving", href: "/saving" }, scope: "read", input: none,
    description: "Dated pots: pace, gaps, monthly saving needed. Quote summary.",
    run: async ctx => {
      const state = await ctx.state();
      const goals = goalPaces(state);
      const from = "goals", currency = state.homeCurrency;
      const facts = goals.flatMap(goal => {
        const about = { type: "pot" as const, id: goal.id, name: goal.name };
        return [
          engineFact("goal_pace", goal.deltaMinor, { from, currency, about }),
          engineFact("goal_still_to_set_aside", goal.neededMinor, { from, currency, about }),
          engineFact("goal_monthly_needed", goal.monthlyNeededMinor, { from, currency, about }),
          ...(goal.reachedOn ? [engineFact("goal_reaches_on", goal.reachedOn, { from, about })] : []),
        ];
      });
      return JSON.stringify({ ...forModel(facts), currency, goals, summary: goals.length ? null : "No dated savings goals yet." });
    },
  }),
  defineTool({
    name: "plan_for", words: "Working out the plan", source: { label: "Saving", href: "/saving" }, scope: "read",
    input: z.object({
      target_minor: z.number().int().positive().safe().nullish(),
      target_date: z.string().date().nullish(),
      monthly_minor: z.number().int().positive().safe().nullish(),
      pot_id: z.uuid().nullish(),
    }),
    description: "A savings target’s monthly pace, completion date and 30-day room. A pot_id uses that pot’s savings and fills omitted details. Quote summary.",
    run: async (ctx, input) => {
      const state = await ctx.state();
      const pot = input.pot_id ? state.pots.find(p => p.id === input.pot_id) : undefined;
      if (input.pot_id && !pot) throw new Error("Unknown pot");
      const minor = (amount: number) => toMinor(amount, state.homeCurrency);
      const unit = (n: number) => fromMinor(n, state.homeCurrency);
      const target = input.target_minor != null ? unit(input.target_minor) : pot?.target;
      if (target === undefined) throw new Error("A target amount is required");
      const targetDate = input.target_date ?? pot?.targetDate;
      const monthly = input.monthly_minor != null ? unit(input.monthly_minor) : undefined;
      const request = { target, saved: pot?.saved ?? 0, ...(targetDate && { targetDate }), ...(monthly !== undefined && { monthly }) };
      const plan = planFor(request, state);
      const from = "plan_for", currency = state.homeCurrency, about = pot ? { type: "pot" as const, id: pot.id, name: pot.name } : undefined;
      const facts = [
        engineFact("left_over_each_month", minor(plan.leftOverEachMonth), { from, currency, case: "as_usual" }),
        engineFact("goal_still_to_set_aside", minor(plan.needed), { from, currency, ...(about && { about }) }),
        ...(plan.monthlyNeeded !== undefined ? [engineFact("goal_monthly_needed", minor(plan.monthlyNeeded), { from, currency, ...(about && { about }) })] : []),
        ...(plan.reachedOn ? [engineFact("goal_reaches_on", plan.reachedOn, { from, ...(about && { about }) })] : []),
      ];
      return JSON.stringify({
        ...forModel(facts), summary: planLine(request, plan, state), currency,
        targetMinor: minor(target), savedMinor: minor(request.saved), neededMinor: minor(plan.needed), leftOverEachMonthMinor: minor(plan.leftOverEachMonth),
        ...(plan.months !== undefined && { months: plan.months }),
        ...(plan.monthlyNeeded !== undefined && { monthlyNeededMinor: minor(plan.monthlyNeeded) }),
        ...(plan.fits !== undefined && { fits: plan.fits }),
        ...(plan.pace !== undefined && { paceMinor: minor(plan.pace), monthsAtPace: plan.monthsAtPace, reachedOn: plan.reachedOn }),
      });
    },
  }),
  defineTool({
    name: "own_categories", words: "Reading your own categories", source: { label: "Your categories", href: "/spending/categories" }, scope: "read", input: none,
    description: "Own categories with business share and use; the only own_category names.",
    run: async ctx => {
      const groups = await listOwnCategoriesGrouped(ctx.db, ctx.householdId);
      if (groups.length === 0) return "This household has no categories of its own yet. Only the person can make one, in Spending → Your categories.";
      const part = (o: (typeof groups)[number]["categories"][number]) => `${o.name} (${o.businessBp === null ? "no default business share" : `default business share ${o.businessBp / 100}%`}, ${plural(o.items, "item")})`;
      return groups.map(g => `Under ${g.label}: ${g.categories.map(part).join("; ")}.`).join("\n");
    },
  }),
  defineTool({
    name: "search_spending", words: "Searching your spending", source: { label: "Spending", href: "/spending" }, scope: "read",
    input: z.object({
      query: z.string().max(SEARCH_QUERY_MAX).default("").describe("All words must match; empty: all."),
      months: z.number().int().min(1).max(HISTORY_MONTHS).nullable().default(null).describe(`Months back, 1 to ${HISTORY_MONTHS}, this one included; null = 3.`),
    }),
    description: "Search bills and charges by name or category, newest first, with each item's amount. Unknown amounts not summed. Quote summary.",
    run: async (ctx, input) => {
      const today = await householdDate(ctx.db, ctx.householdId);
      const from = `${monthsBack(today.slice(0, 7), input.months ?? 3)}-01`;
      const monthEnd = monthBounds(today.slice(0, 7)).last;
      const data = await loadSpending(ctx.db, ctx.householdId, { from, to: monthEnd });
      const result = searchSpending(spendingItems(data, from, monthEnd), input.query, data.homeCurrency, { from, to: today, uncountedTo: monthEnd });
      const factFrom = "search_spending", period = { from, to: today };
      // Each matching item's amount is a fact too (newest first, at most 60), so an answer naming one item is confirmed.
      const items = result.months.flatMap(month => month.items).filter(item => !item.uncounted).slice(0, 60);
      const facts = [
        engineFact("search_total", result.totalMinor, { from: factFrom, currency: result.currency, period }),
        ...items.map(item => engineFact(item.kind === "bill" ? "bill_amount" : "charge_amount", item.amountMinor, { from: factFrom, currency: result.currency, period: { on: item.date }, about: { type: item.kind, id: item.id, name: item.label } })),
        ...result.uncounted.map(name => engineFact("not_counted", 1, { from: factFrom, about: { type: "cost", id: name, name } })),
      ];
      return JSON.stringify({ ...forModel(facts), summary: searchLine(result), from, to: today, ...result });
    },
  }),
  defineTool({
    name: "bills_for_month", words: "Finding the bills for that month", source: { label: "Spending", href: "/spending" }, scope: "read",
    input: z.object({
      month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "month is YYYY-MM").describe("Service month, YYYY-MM."),
      text: z.string().max(SEARCH_QUERY_MAX).default("").describe("Name or category; empty lists all."),
    }),
    description: "Bills whose service period overlaps the month, waiting too, totals per currency. Quote summary.",
    run: async (ctx, input) => {
      const today = await householdDate(ctx.db, ctx.householdId);
      if (input.month > latestDate(today).slice(0, 7)) throw new InputError(`month must be no later than ${latestDate(today).slice(0, 7)}, two years from today`);
      const result = billsForMonth(await loadPeriodBills(ctx.db, ctx.householdId, input.month), input.month, input.text);
      const { first, last } = monthBounds(input.month);
      const from = "bills_for_month";
      const facts = result.totals.map(t => engineFact("bills_for_month_total", t.totalMinor, { from, currency: t.currency as Currency, period: { from: first, to: last } }));
      // Each confirmed bill's own amount, so an answer naming one bill is confirmed too; a bill waiting for a yes counts for nothing (D79).
      for (const item of result.items) {
        if (item.status !== "confirmed") continue;
        const about = { type: "bill" as const, id: item.id, name: item.biller };
        facts.push(item.amountMinor === null ? engineFact("not_counted", 1, { from, about })
          : engineFact("bill_amount", item.amountMinor, { from, currency: item.currency, about, period: item.due ? { on: item.due } : { from: item.periodStart, to: item.periodEnd } }));
      }
      return JSON.stringify({ ...forModel(facts), ...result });
    },
  }),
  defineTool({
    name: "suggestions", words: "Checking what needs your attention", source: { label: "From your assistant", href: "/#assistant-suggestions" }, scope: "read", input: none,
    description: "Open Home findings, most urgent first. Quote title and reason; name the space if spaceName is set.",
    run: async ctx => JSON.stringify(await openSuggestions(ctx.db, ctx.householdId)),
  }),
  defineTool({
    name: "draft_invoice", words: "Drafting the invoice", scope: "draft", input: draftInput.omit({ id: true }),
    description: "Draft a USD invoice for review. amount in dollars. client_id from list_clients_and_cards.",
    run: async (ctx, input) => {
      const id = await saveInvoiceDraft(ctx.db, ctx.householdId, { ...input, id: await draftId(ctx, "draft_invoice", input) }, by(ctx));
      const href = new URL("/invoices/" + id, ctx.appUrl).href;
      ctx.addLink?.({ label: "Review invoice draft", href });
      return `Review the draft at ${href}. Tell the person to review the draft and tap Approve on the invoice to make the PayPal payment link; nothing is sent until they do.`;
    },
  }),
  defineTool({
    name: "add_bill", words: "Adding the bill", scope: "draft", input: addBillInput,
    description: "Draft a bill for To check. Shared: memberId null, paidBy a display name.",
    run: async (ctx, input) => {
      const { biller, note } = await draftOne(ctx, "add_bill", input, prepareBill, insertPreparedBill(ctx));
      return `${biller} is waiting in To check for the user to confirm. ${note}`;
    },
  }),
  defineTool({
    name: "add_bills", words: "Adding the bills", scope: "draft", input: z.object({ items: z.array(addBillInput).min(1).max(MAX_BULK_ITEMS) }),
    description: `1–${MAX_BULK_ITEMS} bills atomically, as add_bill. An error names the item.`,
    run: async (ctx, input) => {
      const prepared = await draftMany(ctx, "add_bills", input.items, prepareBill, insertPreparedBill(ctx));
      return `${prepared.length} bills are waiting in To check for the user to confirm: ${prepared.map(p => `${p.biller} (${p.note})`).join(" ")}`;
    },
  }),
  defineTool({
    name: "log_charge", words: "Logging the charge", scope: "draft", input: logChargeInput,
    description: "Draft a card purchase for To check. amount is billed, home currency. cardId from list_clients_and_cards. Shared needs a member’s card.",
    run: async (ctx, input) => {
      const { merchant, note } = await draftOne(ctx, "log_charge", input, prepareCharge, insertPreparedCharge(ctx));
      return `${merchant} is waiting in To check for the user to confirm. ${note}`;
    },
  }),
  defineTool({
    name: "log_charges", words: "Logging the charges", scope: "draft", input: z.object({ items: z.array(logChargeInput).min(1).max(MAX_BULK_ITEMS) }),
    description: `1–${MAX_BULK_ITEMS} card purchases atomically, as log_charge. An error names the item.`,
    run: async (ctx, input) => {
      const prepared = await draftMany(ctx, "log_charges", input.items, prepareCharge, insertPreparedCharge(ctx));
      return `${prepared.length} charges are waiting in To check for the user to confirm: ${prepared.map(p => `${p.merchant} (${p.note})`).join(" ")}`;
    },
  }),
  defineTool({
    name: "add_pot", words: "Setting up the pot", scope: "draft", input: potInput.pick({ name: true, target: true, targetDate: true, fillPct: true, category: true }),
    description: "Draft a pot for To check. target in home currency. category government_tax makes the tax pot; fillPct: % of each client payment.",
    run: async (ctx, input) => {
      await savePot(ctx.db, ctx.householdId, { ...input, id: await draftId(ctx, "add_pot", input), saved: "0", memberId: null }, "pending", by(ctx));
      ctx.onPending?.();
      return `The ${input.name} pot is waiting in To check for the user to confirm.`;
    },
  }),
  defineTool({
    name: "add_win", words: "Noting the cheaper choice", scope: "draft", input: addWinInput,
    description: "Draft a cheaper choice for To check: amount saved, or instead (pricier) and paid, as the person said them.",
    run: async (ctx, input) => {
      const state = await ctx.state();
      const currency = Currency.parse(state.homeCurrency);
      let aboutMinor: number;
      if (input.amount !== null) {
        if (input.instead !== null || input.paid !== null) throw new InputError("Give either the amount saved or the two prices, not both");
        aboutMinor = parseAmountMinor(input.amount, currency);
        requireSaid(ctx, aboutMinor, currency);
      } else {
        if (input.instead === null || input.paid === null) throw new InputError(NO_GUESS);
        const instead = parseAmountMinor(input.instead, currency), paid = parseAmountMinor(input.paid, currency);
        requireSaid(ctx, instead, currency);
        requireSaid(ctx, paid, currency);
        if (instead <= paid) throw new InputError("The pricier choice must cost more than what was paid");
        aboutMinor = instead - paid;
      }
      const id = await draftId(ctx, "add_win", input);
      await saveChoice(ctx.db, ctx.householdId, {
        id, source: "said", happenedOn: input.on ?? state.today, aboutMinor, words: input.what, category: input.category, foundKey: null, memberId: await memberFor(ctx, input.who),
      }, "pending", by(ctx));
      ctx.onPending?.();
      const facts = [engineFact("to_check_amount", aboutMinor, { from: "add_win", currency, about: { type: "choice", id, name: input.what } })];
      return JSON.stringify({ ...forModel(facts), note: "Waiting in To check for the person to confirm." });
    },
  }),
  defineTool({
    name: "pot_move", words: "Setting up the pot move", scope: "draft", input: potMoveInput,
    description: "Draft money into, out of or between pots, or a pot paying a purchase, for To check. paid_for with no amount takes the purchase.",
    run: async (ctx, input) => {
      const state = await ctx.state();
      const currency = Currency.parse(state.homeCurrency);
      const pot = await potNamed(ctx, input.pot, state);
      const to = input.kind === "move_to" ? input.to_pot === null ? (() => { throw new InputError("Say which pot to move the money to (to_pot)"); })() : await potNamed(ctx, input.to_pot, state) : null;
      if (input.kind !== "move_to" && input.to_pot !== null) throw new InputError("Only move_to has a second pot");
      if (input.kind !== "paid_for" && (input.purchase !== null || input.purchase_on !== null)) throw new InputError("Only paid_for names a purchase");
      let amountMinor: number | null = null;
      if (input.amount !== null) {
        amountMinor = parseAmountMinor(input.amount, currency);
        if (ctx.known !== undefined && !ctx.known(amountMinor)) throw new InputError(NO_GUESS);
      } else if (input.kind !== "paid_for" || input.purchase === null) throw new InputError(NO_GUESS);
      let purchase: { kind: "charge" | "bill"; id: string; on: string | null } | null = null;
      if (input.kind === "paid_for" && input.purchase !== null) {
        const to0 = state.today.slice(0, 7), from = input.purchase_on ? `${input.purchase_on.slice(0, 7)}-01` : `${monthsBack(to0, 3)}-01`;
        const last = input.purchase_on ? monthBounds(input.purchase_on.slice(0, 7)).last : monthBounds(to0).last;
        const wanted = input.purchase.trim().toLowerCase();
        const items = spendingItems(await loadSpending(ctx.db, ctx.householdId, { from, to: last }), from, last)
          .filter(item => !item.uncounted && (item.id === input.purchase || item.label.trim().toLowerCase().includes(wanted)) && (input.purchase_on === null || item.date === input.purchase_on));
        if (items.length === 0) throw new InputError(`No purchase matching ${input.purchase} was found${input.purchase_on ? ` on ${input.purchase_on}` : ""}; find it with search_spending`);
        if (items.length > 1) throw new InputError(`Several purchases match: ${items.slice(0, 6).map(item => `${item.label} on ${item.date}`).join("; ")}. Ask which one, or give purchase_on`);
        purchase = { kind: items[0].kind, id: items[0].id, on: items[0].kind === "bill" ? items[0].date : null };
      }
      const id = await draftId(ctx, "pot_move", input);
      await movePot(ctx.db, ctx.householdId, {
        id, potId: pot.id, kind: { put_in: "add", take_out: "take_out", paid_for: "spend", move_to: "carry" }[input.kind] as "add" | "take_out" | "spend" | "carry",
        amountMinor, toPotId: to?.id ?? null, purchase, choiceId: null, reason: input.words, memberId: await memberFor(ctx, input.who), done: false,
      }, "pending", by(ctx));
      ctx.onPending?.();
      const facts = amountMinor === null ? [] : [engineFact("to_check_amount", amountMinor, { from: "pot_move", currency, about: { type: "pot", id: pot.id, name: pot.name } })];
      return JSON.stringify({ ...forModel(facts), note: `${amountMinor === null ? "The amount, the purchase capped at what the pot holds, is worked out when the person confirms. " : ""}Waiting in To check for the person to confirm.` });
    },
  }),
  defineTool({
    name: "update_bank_balance", words: "Updating the bank balance", scope: "draft", input: bankBalanceInput.omit({ id: true }),
    description: "Draft a bank balance for To check. amount in home currency, may be negative.",
    run: async (ctx, input) => {
      await setBankBalance(ctx.db, ctx.householdId, { ...input, id: await draftId(ctx, "update_bank_balance", input) }, "pending", by(ctx));
      ctx.onPending?.();
      return "The new bank balance is waiting in To check for the user to confirm.";
    },
  }),
  ...canvasTools,
  ...viewTools,
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
  const raw = z.toJSONSchema(tool.input, { target: "draft-07", io: "input", reused: "inline", unrepresentable: "any" }) as Record<string, unknown>;
  delete raw.$schema;
  const compact = compactSchema(strictJsonSchema(strictShape(raw, tool.name !== "add_bills" && tool.name !== "log_charges")));
  // The model gets "no extra properties" once, at the top; the Zod schema still decides what a call may hold.
  return { ...stripNested(compact), additionalProperties: false };
}

function stripNested<T>(node: T): T {
  if (Array.isArray(node)) return node.map(stripNested) as T;
  if (node === null || typeof node !== "object") return node;
  return Object.fromEntries(Object.entries(node).filter(([k]) => k !== "additionalProperties").map(([k, v]) => [k, stripNested(v)])) as T;
}

// anyOf [{type: X}, {type: "null"}] says the same as type [X, "null"] in a third of the characters; the catalogue is sent on every model turn.
function compactSchema<T>(node: T): T {
  if (Array.isArray(node)) return node.map(compactSchema) as T;
  if (node !== null && typeof node === "object" && (node as Record<string, unknown>).format === "uuid") {
    const { format, ...rest } = node as Record<string, unknown>; void format; // the ids a tool takes come from tools; a new one is asked for in words
    return compactSchema(rest) as T;
  }
  if (node === null || typeof node !== "object") return node;
  const schema = Object.fromEntries(Object.entries(node).map(([k, v]) => [k, compactSchema(v)])) as Record<string, unknown>;
  // The SDK's transform spells an enum or a constant as prose in the description; the keyword says it in fewer characters.
  const spelled = typeof schema.description === "string" ? /^\{(enum|const): (.*)\}$/.exec(schema.description) : null;
  if (spelled && schema.type === "string") {
    const { description, ...rest } = schema; void description;
    return { ...rest, [spelled[1]]: JSON.parse(spelled[2]) } as T;
  }
  const variants = schema.anyOf;
  if (Array.isArray(variants) && variants.length === 2) {
    const [value, empty] = variants as Record<string, unknown>[];
    if (typeof value.type === "string" && value.const === undefined && JSON.stringify(empty) === '{"type":"null"}') {
      const { anyOf, ...rest } = schema; void anyOf;
      return { ...rest, ...value, type: [value.type, "null"], ...(Array.isArray(value.enum) && { enum: [...value.enum, null] }) } as T;
    }
  }
  return schema as T;
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
  // A discriminated union is oneOf in Zod 4; the model is told it as anyOf, as before (the variants differ by their tag).
  if (Array.isArray(schema.oneOf)) { schema.anyOf = schema.oneOf; delete schema.oneOf; }
  if (Array.isArray(schema.anyOf)) schema.anyOf = schema.anyOf.map(item => strictShape(item, keepDescriptions));
  return schema;
}
