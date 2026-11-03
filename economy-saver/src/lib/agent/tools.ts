// One tool catalogue for the in-app agent and the MCP server (D40). Tools read the engine or call the same
// src/db functions as the forms. They never send: sending is the tap in src/app/api/approve/route.ts (D12).
import type Anthropic from "@anthropic-ai/sdk";
import { and, desc, eq } from "drizzle-orm";
import { zodToJsonSchema } from "zod-to-json-schema";
import { transformJSONSchema } from "@anthropic-ai/sdk/lib/transform-json-schema";
import { z } from "zod";
import { requireHousehold, type Db } from "@/db/household";
import { billInput, insertBill } from "@/db/bills";
import { chargeInput, insertCharge } from "@/db/charges";
import { draftInput, saveInvoiceDraft } from "@/db/invoice-draft";
import { toMinor } from "@/db/money";
import { clients, invoices } from "@/db/schema";
import { dueAnswer, spendAnswer, statusAnswer } from "@/lib/money/ask";
import { fundingOptions } from "@/lib/money/options";
import { low, series, timeline as engineTimeline } from "@/lib/money/runway";
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
    name: "add_bill", scope: "draft", input: billInput,
    description: "Add a bill the user tells you about. It waits in To check until the user confirms it; it does not count yet. amount is a plain number in the household's home currency (3800 for ¥3,800). due is YYYY-MM-DD. member_id is null for a shared bill. id is a new UUID; reuse the same id when retrying.",
    run: async (ctx, input) => {
      await insertBill(ctx.db, ctx.householdId, input, "pending");
      ctx.onPending?.();
      return `${input.biller} is waiting in To check for the user to confirm.`;
    },
  }),
  defineTool({
    name: "log_charge", scope: "draft", input: chargeInput,
    description: "Log a card purchase the user tells you about. It waits in To check until the user confirms it. amount is a plain number in the household's home currency. date is YYYY-MM-DD (today if the user does not say). card_id comes from list_clients_and_cards. id is a new UUID; reuse the same id when retrying.",
    run: async (ctx, input) => {
      await insertCharge(ctx.db, ctx.householdId, input, "pending", ctx.source ?? "manual");
      ctx.onPending?.();
      return `${input.merchant} is waiting in To check for the user to confirm.`;
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
