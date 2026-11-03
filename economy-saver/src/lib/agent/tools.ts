// One tool catalogue for the in-app agent and the MCP server (D40). Tools read the engine or call the same
// src/db functions as the forms. They never send: sending is the tap in src/app/api/approve/route.ts (D12).
import type Anthropic from "@anthropic-ai/sdk";
import { and, desc, eq } from "drizzle-orm";
import { zodToJsonSchema } from "zod-to-json-schema";
import { transformJSONSchema } from "@anthropic-ai/sdk/lib/transform-json-schema";
import { z } from "zod";
import { requireHousehold, type Db } from "@/db/household";
import { bankBalanceInput, setBankBalance } from "@/db/bank-balance";
import { billInput, insertBill } from "@/db/bills";
import { chargeInput, insertCharge } from "@/db/charges";
import { InputError } from "@/db/input-error";
import { draftInput, saveInvoiceDraft } from "@/db/invoice-draft";
import { memberByName, memberCount } from "@/db/people";
import { potInput, savePot } from "@/db/pots";
import { loadHouseholdSnapshot } from "@/db/snapshot";
import { toMinor } from "@/db/money";
import { clients, invoices } from "@/db/schema";
import { dueAnswer, spendAnswer, statusAnswer } from "@/lib/money/ask";
import { BusinessBp, CATEGORY_KEYS, CategoryKeySchema, categoryLabel } from "@/lib/money/categories";
import { guessCategory } from "@/lib/money/categorise";
import { monthByCategory, monthText } from "@/lib/money/month";
import { fundingOptions } from "@/lib/money/options";
import { planFor, planLine } from "@/lib/money/plan";
import { low, series, timeline as engineTimeline } from "@/lib/money/runway";
import { splitBalance, splitSummary } from "@/lib/money/split";
import type { MoneyState } from "@/lib/money/types";

export type ToolContext = {
  db: Db;
  householdId: string;
  state: () => Promise<MoneyState>;
  appUrl: URL;
  askId?: string;
  /** How the question arrived; a charge logged from it keeps this as its source. */
  source?: "voice" | "manual";
  /** The agent shows these as buttons under the answer. */
  addLink?: (link: { label: string; href: string }) => void;
  /** Called when a tool leaves a row waiting in To check. */
  onPending?: () => void;
};

export type Tool = {
  name: string;
  description: string;
  input: z.ZodObject<z.ZodRawShape>;
  scope: "read" | "draft";
  /** `input` is already validated against `input`. */
  run: (ctx: ToolContext, input: never) => Promise<string>;
};

function defineTool<S extends z.ZodObject<z.ZodRawShape>>(tool: {
  name: string; description: string; input: S; scope: "read" | "draft";
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
const addBillInput = billInput.omit({ paidByMemberId: true, category: true, businessBp: true }).extend({
  category: categoryField,
  business_bp: businessField,
  shared: z.boolean().nullable().default(null),
  paidBy: z.string().trim().min(1).max(80).nullable().default(null),
});
const logChargeInput = chargeInput.omit({ category: true, businessBp: true }).extend({ category: categoryField, business_bp: businessField });

/** The category a tool saves: the one given, or the keyword table's guess from the name; and the sentence that tells the agent which. */
function categoryFor(name: string, given: z.infer<typeof categoryField>): { category: z.infer<typeof CategoryKeySchema>; note: string } {
  if (given !== null) return { category: given, note: `Category: ${categoryLabel(given)}.` };
  const guess = guessCategory(name);
  return { category: guess.category, note: guess.sure
    ? `No category was given, so it was guessed from the name: ${categoryLabel(guess.category)}. The user can change it in To check.`
    : `No category was given and the name matched none, so it is ${categoryLabel(guess.category)}. The user can choose one in To check.` };
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
    description: "List client and card names and IDs for this household.",
    run: async ctx => {
      const state = await ctx.state();
      return JSON.stringify({ clients: state.clients.map(c => ({ id: c.id, name: c.name })), cards: state.cards.map(c => ({ id: c.id, label: c.label })) });
    },
  }),
  defineTool({
    name: "timeline", scope: "read",
    input: z.object({ scenario: z.enum(["as_usual", "late"]) }),
    description: "The next 30 days of dated money events (bills, card statements, expected client payments) with the running balance after each, and the lowest point with its date. Amounts are signed home-currency minor units: negative goes out. scenario as_usual means clients pay on their usual day; late means on their slowest day.",
    run: async (ctx, input) => {
      const state = await ctx.state();
      const kind = SCENARIOS[input.scenario];
      const lowest = low(series(state, kind));
      const minor = (amount: number) => toMinor(amount, state.homeCurrency);
      return JSON.stringify({
        scenario: input.scenario, today: state.today, currency: state.homeCurrency,
        low: { date: lowest.date, amountMinor: minor(lowest.amount) },
        events: engineTimeline(state, kind).map(event => ({
          date: event.date, label: event.label, kind: event.kind, amountMinor: minor(event.amount),
          currency: state.homeCurrency, balanceAfterMinor: minor(event.balance), ...(event.pending ? { pending: true } : {}),
        })),
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
    description: "The household's 50 most recent invoices: client name, status, USD amount in cents, and sent, due and paid dates.",
    run: async ctx => {
      const hid = requireHousehold(ctx.householdId);
      const rows = await ctx.db.select({
        client: clients.name, number: invoices.number, item: invoices.item, status: invoices.status,
        amountMinor: invoices.amountMinor, currency: invoices.currency,
        sentOn: invoices.sentOn, dueOn: invoices.dueOn, paidOn: invoices.paidOn,
      }).from(invoices)
        .innerJoin(clients, and(eq(clients.householdId, invoices.householdId), eq(clients.id, invoices.clientId)))
        .where(eq(invoices.householdId, hid)).orderBy(desc(invoices.createdAt)).limit(50);
      return JSON.stringify(rows);
    },
  }),
  defineTool({
    name: "household_snapshot", scope: "read", input: z.object({}).strict(),
    description: `The whole household as one JSON document (schema version 1): household, members (with their shares of shared costs), cards, statements, charges, stored bills (a monthly bill appears once, with repeatDay), clients, invoices, pots, settlements, bank balance updates and document references. Money is integer minor units next to a currency; dates are ISO strings. Use it as context for the household as a whole, to find ids and see what exists. It is not an answer: what the household can spend, what is due and how short it would be come from the engine tools (where_am_i, whats_due, can_i_spend, timeline). Rows with status pending are waiting in To check and count for nothing yet. Each of bills, charges, statements, invoices, balanceUpdates and documents holds at most its ${SNAPSHOT_TOOL_WINDOW} most recent rows, oldest first; truncated says which lists were cut. No audit-trail events and no secrets are included.`,
    run: async ctx => JSON.stringify(await loadHouseholdSnapshot(ctx.db, ctx.householdId, { events: false, recent: SNAPSHOT_TOOL_WINDOW })),
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
      const unit = (n: number) => n / (state.homeCurrency === "USD" ? 100 : 1);
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
    name: "month_by_category", scope: "read", input: none,
    description: "Where the current calendar month goes: confirmed bills (a monthly bill once) and card charges in the home currency, grouped by category, each split into its business and personal part, with the items under each. Quote it to the user as it is; it is built in code. Information only: categories and business shares move no money and do not change what is safe to spend.",
    run: async ctx => {
      const state = await ctx.state();
      return monthText(monthByCategory(state, state.today));
    },
  }),
  defineTool({
    name: "draft_invoice", scope: "draft", input: draftInput,
    description: "Save a local USD invoice draft for the user to review; nothing is sent. amount is dollars, like 18.52. id is a new UUID; reuse the same id when retrying. client_id comes from list_clients_and_cards.",
    run: async (ctx, input) => {
      const id = await saveInvoiceDraft(ctx.db, ctx.householdId, input);
      const href = new URL("/invoices/" + id, ctx.appUrl).href;
      ctx.addLink?.({ label: "Review invoice draft", href });
      return `Review the draft at ${href}.`;
    },
  }),
  defineTool({
    name: "add_bill", scope: "draft", input: addBillInput,
    description: `Add a bill the user tells you about. It waits in To check until the user confirms it; it does not count yet. amount is a plain number in the household's home currency (3800 for ¥3,800). due is YYYY-MM-DD. memberId is null for a household bill. monthly is true when the bill repeats every month on the due date's day (rent, phone, insurance, a subscription), false for a one-off; it only starts repeating once the user confirms it. In a household of two or more people, shared is true when the bill is split between them and paidBy is the display name of the person who pays it (every month, for a monthly bill); otherwise leave both null. A shared bill has no memberId. category is one of ${CATEGORY_KEYS.join(", ")}, or null when the user did not say (the app proposes one from the name and the user confirms it in To check). business_bp is the part that is business, in basis points: 0 personal, 10000 all business, 3000 for 30%; null means personal. id is a new UUID; reuse the same id when retrying.`,
    run: async (ctx, input) => {
      const { shared, paidBy, category: given, business_bp, ...bill } = input;
      let paidByMemberId: string | null = null;
      if (paidBy !== null && !shared) throw new InputError("paidBy names who pays a shared bill; set shared to true");
      if (shared) {
        if (bill.memberId !== null) throw new InputError("A shared bill belongs to nobody in particular; leave memberId empty");
        if (paidBy === null) throw new InputError("Say who pays a shared bill (paidBy)");
        if (await memberCount(ctx.db, ctx.householdId) < 2) throw new InputError("Splitting a bill needs a second person; add one in Settings, People");
        paidByMemberId = (await memberByName(ctx.db, ctx.householdId, paidBy)).id;
      }
      const { category, note } = categoryFor(bill.biller, given);
      await insertBill(ctx.db, ctx.householdId, { ...bill, category, businessBp: business_bp ?? 0, paidByMemberId }, "pending");
      ctx.onPending?.();
      return `${input.biller} is waiting in To check for the user to confirm. ${note}`;
    },
  }),
  defineTool({
    name: "log_charge", scope: "draft", input: logChargeInput,
    description: `Log a card purchase the user tells you about. It waits in To check until the user confirms it. amount is a plain number in the household's home currency. date is YYYY-MM-DD (today if the user does not say). card_id comes from list_clients_and_cards. shared is true when the purchase is split between the household's people (needs two or more people and a card that belongs to one of them, who paid); false otherwise. category is one of ${CATEGORY_KEYS.join(", ")}, or null when the user did not say (the app proposes one from the merchant and the user confirms it in To check). business_bp is the part that is business, in basis points: 0 personal, 10000 all business, 3000 for 30%; null means personal. id is a new UUID; reuse the same id when retrying.`,
    run: async (ctx, input) => {
      const { category: given, business_bp, ...charge } = input;
      const { category, note } = categoryFor(charge.merchant, given);
      await insertCharge(ctx.db, ctx.householdId, { ...charge, category, businessBp: business_bp ?? 0 }, "pending", ctx.source ?? "manual");
      ctx.onPending?.();
      return `${input.merchant} is waiting in To check for the user to confirm. ${note}`;
    },
  }),
  defineTool({
    name: "add_pot", scope: "draft", input: potInput.pick({ id: true, name: true, target: true, targetDate: true, fillPct: true }),
    description: "Suggest a pot, money set aside with a reason, only when the user talks about saving for something or a payment just landed and they ask what to do. It waits in To check until the user confirms it; money in a pot is not safe to spend once confirmed. name is the reason (Car, Trip, Tax). target is a plain number in the household's home currency, or null. targetDate is YYYY-MM-DD, or null. fillPct is the share of each client payment to set aside, such as 25 for 25 percent, or null. id is a new UUID; reuse the same id when retrying.",
    run: async (ctx, input) => {
      await savePot(ctx.db, ctx.householdId, { ...input, saved: "0", memberId: null }, "pending");
      ctx.onPending?.();
      return `The ${input.name} pot is waiting in To check for the user to confirm.`;
    },
  }),
  defineTool({
    name: "update_bank_balance", scope: "draft", input: bankBalanceInput,
    description: "Update the household's bank balance to the amount the user tells you. It waits in To check until the user confirms it; the balance does not change yet. amount is the new balance as a plain number in the household's home currency (182000 for ¥182,000; a negative number if overdrawn). id is a new UUID; reuse the same id when retrying.",
    run: async (ctx, input) => {
      await setBankBalance(ctx.db, ctx.householdId, input, "pending");
      ctx.onPending?.();
      return "The new bank balance is waiting in To check for the user to confirm.";
    },
  }),
];

/**
 * The tool's input as a JSON Schema for the Messages API with strict tool use: every property required (optional
 * ones are nullable in the zod schema), no extra properties, constraints the API ignores moved into descriptions.
 */
export function toolInputSchema(tool: Tool): Anthropic.Tool.InputSchema {
  const raw = zodToJsonSchema(tool.input, { $refStrategy: "none" }) as Record<string, unknown>;
  delete raw.$schema;
  return transformJSONSchema(strictShape(raw)) as Anthropic.Tool.InputSchema;
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
