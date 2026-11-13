// The `show` tool (D77): the agent draws one of the app's pictures of the person's money. It names a view and, as JSON text, the arguments
// that view takes, by name; code checks both, turns names into ids, reads the data and resolves the view. The result is the view's own
// words and figures, never an argument the model passed in (an amount it chose would otherwise count as a tool result in the number check).
// This file does not import tools.ts as a value (tools.ts spreads `viewTools`): types only.
import { z } from "zod";
import { InputError } from "@/db/input-error";
import { Currency } from "@/lib/catalogue/types";
import { CATEGORY_KEYS } from "@/lib/money/categories";
import { group, minorMoney, minorPerUnit } from "@/lib/money/format";
import { readAmount } from "@/lib/money/amount";
import { VIEW_ARGS } from "@/lib/views/args";
import { VIEW_META } from "@/lib/views/catalogue";
import { liveViews, resolveView } from "@/lib/views/resolve";
import { loadViewContext } from "@/lib/views/load";
import { ViewError, type ViewId, type ViewResult } from "@/lib/views/types";
import type { ViewArgs } from "@/lib/views/args";
import type { Tool } from "./tools";

/** The block `show` hands the run: a view and its ids, the shape a canvas recipe stores. */
export type ViewBlock = { [K in ViewId]: { type: "view"; view: K; args: ViewArgs[K] } }[ViewId];
export const MAX_SHOWN = 4;

function defineTool<S extends z.ZodObject<z.ZodRawShape>>(tool: {
  name: string; description: string; input: S; scope: Tool["scope"];
  run: (ctx: Parameters<Tool["run"]>[0], input: z.infer<S>) => Promise<string>;
}): Tool {
  return tool as unknown as Tool;
}

// Every argument a view can take, by name. Each view takes some of them; `amount` is text as the person said it.
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "is YYYY-MM");
const FIELDS = {
  month, months: z.number().int().min(2).max(12), case: z.enum(["usual", "late"]), by: z.enum(["category", "business", "person"]), open: z.enum(CATEGORY_KEYS),
  text: z.string().trim().min(1).max(80), mark: z.string().trim().min(1).max(80), client: z.string().trim().min(1).max(80), card: z.string().trim().min(1).max(80), pot: z.string().trim().min(1).max(80),
  amount: z.union([z.string().trim().min(1).max(40), z.number().positive()]), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "is YYYY-MM-DD"),
  days: z.number().int().min(1).max(180), whose: z.literal("shared"), item: z.string().trim().min(1).max(80),
};
type Field = keyof typeof FIELDS;

/** The names each view takes; the id-form schemas in `VIEW_ARGS` are what the stored block must satisfy. */
const TAKES: Record<ViewId, Field[]> = {
  forecast: ["case", "days", "mark"], what_if: ["amount", "date", "client", "days"], position: [], month_by_category: ["month", "by", "open"], month_trend: ["months"],
  month_pace: ["month"], fixed_costs: ["months"], search_months: ["text", "months"], money_flow: ["month"], savings_rate: ["months"], buffer_months: [],
  income_months: ["months"], client_pace: ["client"], fx_cost: ["months"], goal_pace: ["pot"], bills_calendar: ["days", "whose"], card_cycle: ["card", "amount"],
  who_owes_whom: [], what_changed: ["item"], tax_ahead: ["pot", "days"],
};
const NAME_ARGS = Object.fromEntries(Object.entries(TAKES).map(([view, keys]) =>
  [view, z.object(Object.fromEntries(keys.map(key => [key, FIELDS[key].optional()]))).strict()])) as unknown as Record<ViewId, z.ZodObject<z.ZodRawShape>>;

const DESCRIPTION = `Chart their money. args: JSON text or null. forecast(case usual|late,days,mark=bill); what_if(amount,date,client+days); position; month_by_category(month,by category|business|person,open); month_trend(months); month_pace(month); fixed_costs(months); search_months(text,months); money_flow(month); savings_rate(months); buffer_months; income_months(months); client_pace(client); fx_cost(months); goal_pace(pot); bills_calendar(days,whose); card_cycle(card,amount); who_owes_whom; what_changed(item); tax_ahead(pot,days).`;

const normal = (text: string) => text.normalize("NFKC").trim().toLowerCase();

/** The one thing a name picks out: the exact name, else the only name that contains it. Anything else is refused with the names. */
function byName(kind: string, given: string, things: { id: string; name: string }[]): string {
  const want = normal(given);
  const exact = things.filter(thing => normal(thing.name) === want);
  const found = exact.length ? exact : things.filter(thing => normal(thing.name).includes(want));
  if (found.length === 1) return found[0].id;
  const names = things.map(thing => thing.name).join(", ") || "none yet";
  throw new InputError(`${found.length ? "More than one" : "No"} ${kind} matches "${given}". Use one of: ${names}.`);
}

/** The names in `args` as the ids and minor units a view takes. */
async function idArgs(ctx: Parameters<Tool["run"]>[0], view: ViewId, given: Record<string, unknown>): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  const state = async () => ctx.state();
  for (const [key, value] of Object.entries(given)) {
    if (value === undefined) continue;
    switch (key) {
      case "client": case "card": case "pot": {
        const current = await state();
        const [kind, things, field] = key === "client" ? ["client", current.clients.map(c => ({ id: c.id, name: c.name })), "clientId"] as const
          : key === "card" ? ["card", current.cards.map(c => ({ id: c.id, name: c.label })), "cardId"] as const
          : ["pot", current.pots.map(p => ({ id: p.id, name: p.name })), "potId"] as const;
        out[field] = byName(kind, String(value), [...things]);
        break;
      }
      case "mark": {
        const bills = new Map((await state()).bills.map(bill => [bill.id.split("@")[0], { id: bill.id.split("@")[0], name: bill.biller }]));
        out.mark = byName("bill", String(value), [...bills.values()]);
        break;
      }
      case "item": out.itemId = value; break;
      case "amount": {
        const currency = Currency.parse((await state()).homeCurrency);
        const read = readAmount(String(value), currency, false);
        if ("problem" in read) throw new InputError(`amount: ${read.problem}`);
        if (read.minor <= 0) throw new InputError("amount must be more than zero.");
        out.amountMinor = read.minor;
        break;
      }
      default: out[key] = value;
    }
  }
  if (view === "what_if") {
    // A client paying late is one idea in two arguments: both or neither.
    const { clientId, days, ...rest } = out;
    if ((clientId === undefined) !== (days === undefined)) throw new InputError("what_if needs client and days together.");
    return { ...rest, ...(clientId !== undefined && { late: { clientId, days } }) };
  }
  return out;
}

/** The text of a result with every form of the amount the model passed in taken out. */
function withoutAmount(result: unknown, minor: number | null, currency: Currency): unknown {
  if (minor === null) return result;
  const forms = [minorMoney(minor, currency), `${currency === "JPY" ? "¥" : "$"}${group(minor / minorPerUnit(currency))}`];
  const walk = (node: unknown): unknown => {
    if (typeof node === "string") return forms.reduce((text, form) => text.split(form).join("that amount"), node);
    if (Array.isArray(node)) return node.map(walk);
    if (node !== null && typeof node === "object") {
      return Object.fromEntries(Object.entries(node).filter(([, value]) => value !== minor).map(([key, value]) => [key, walk(value)]));
    }
    return node;
  };
  return walk(result);
}

function parseArgs(view: ViewId, text: string | null): Record<string, unknown> {
  if (text === null || text.trim() === "") return {};
  let json: unknown;
  try { json = JSON.parse(text); } catch { throw new InputError("args is not valid JSON."); }
  if (json === null || typeof json !== "object" || Array.isArray(json)) throw new InputError("args must be a JSON object, or null.");
  const takes = TAKES[view];
  if (Object.keys(json).some(key => !takes.includes(key as Field))) throw new InputError(`${view} takes ${takes.length ? takes.join(", ") : "no arguments"} only.`);
  const parsed = NAME_ARGS[view].safeParse(json);
  if (!parsed.success) { const issue = parsed.error.issues[0]; throw new InputError(`${issue.path.join(".") || "args"}: ${issue.message}`); }
  return parsed.data;
}

export const viewTools: Tool[] = [
  defineTool({
    name: "show", scope: "read",
    input: z.object({ view: z.string(), args: z.string().nullable() }),
    description: DESCRIPTION,
    run: async (ctx, input) => {
      if (!Object.hasOwn(VIEW_META, input.view)) throw new InputError(`Unknown view. Views: ${liveViews().join(", ")}.`);
      const view = input.view as ViewId;
      if (!liveViews().includes(view)) throw new InputError("That picture isn't available yet.");
      const given = parseArgs(view, input.args);
      const args = await idArgs(ctx, view, given);
      const parsed = VIEW_ARGS[view].safeParse(args);
      if (!parsed.success) throw new InputError(`${view}: ${parsed.error.issues[0].message}`);
      let result: ViewResult;
      try { result = resolveView(view, parsed.data, await loadViewContext(ctx.db, ctx.householdId, VIEW_META[view].needs, { state: await ctx.state() })); }
      catch (error) { if (error instanceof ViewError) throw new InputError(error.message); throw error; }
      ctx.onView?.({ type: "view", view, args: parsed.data } as ViewBlock);
      const passed = typeof args.amountMinor === "number" ? args.amountMinor : null;
      const table = result.table && { head: result.table.head, rows: result.table.rows.slice(0, 12).map(row => row.cells), foot: result.table.foot };
      return JSON.stringify(withoutAmount({
        view, title: result.title, line: result.line, currency: result.currency, figures: result.figures, table, empty: result.empty?.words ?? null,
      }, passed, result.currency));
    },
  }),
];
