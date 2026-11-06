// The canvas recipe (D57): the one definition of a recipe, its queries, its blocks and the what-if changes. The code's types, the check
// at the route, and the JSON Schema the agent is shown are all this file. Version 1. Every object is strict: a key that is not listed is
// refused, so a block that shows money can never carry an amount of its own (the one exception is a progress block's target, which is the
// person's own number). Amounts in a change are positive integer minor units of the household's home currency (whole yen, cents for USD).
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { InputError } from "@/db/input-error";

export const RECIPE_VERSION = 1;
export const MAX_BLOCKS = 12;
export const MAX_CHANGES = 10;
export const MAX_SLIDER_DAYS = 60;

const day = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, "A date is YYYY-MM-DD")
  .refine(value => new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value, "That day is not on the calendar")
  .describe("A calendar day, YYYY-MM-DD, within the app's two-year horizon.");
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "A month is YYYY-MM").describe("A calendar month, YYYY-MM, within the last twelve months or this one.");
const id = z.string().min(1).max(80);
const minorAmount = z.number().int("An amount is a whole number of minor units").positive("An amount is more than zero").max(100_000_000, "That amount is too large")
  .describe("Positive integer minor units of the home currency: whole yen, or cents for USD.");

// ---------------------------------------------------------------- what-if changes

export const ChangeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("client_late"), clientId: id, days: z.number().int().min(0).max(MAX_SLIDER_DAYS).describe("Days later than the client's own pace that all their invoices land.") }).strict(),
  z.object({ kind: z.literal("remove_bill"), billId: id.describe("A stored bill's id (every occurrence) or one occurrence's id, `<id>@<date>`.") }).strict(),
  z.object({ kind: z.literal("change_bill"), billId: id, amountMinor: minorAmount }).strict(),
  z.object({ kind: z.literal("add_cost"), name: z.string().min(1).max(80), amountMinor: minorAmount, date: day }).strict(),
  z.object({ kind: z.literal("add_income"), name: z.string().min(1).max(80), amountMinor: minorAmount, date: day.describe("The day the money lands, tomorrow or later.") }).strict(),
]);
export type Change = z.infer<typeof ChangeSchema>;

export const ScenarioSchema = z.object({
  case: z.enum(["usual", "late"]).describe("usual: clients pay on their usual day. late: on their slowest."),
  changes: z.array(ChangeSchema).max(MAX_CHANGES),
}).strict();
export type Scenario = z.infer<typeof ScenarioSchema>;

/** A query that forecasts may carry its own scenario, or say "canvas" for the recipe's live one (the one the sliders change). */
const scenarioRef = z.union([ScenarioSchema, z.literal("canvas")]).optional();
export type ScenarioRef = z.infer<typeof scenarioRef>;

// ---------------------------------------------------------------- queries

const days = z.number().int().min(7).max(60).optional().describe("How many days from today; the usual 30 when left out.");

export const SentenceQuery = z.object({ q: z.literal("sentence"), scenario: scenarioRef }).strict();
export const SafeToSpendQuery = z.object({ q: z.literal("safe_to_spend"), scenario: scenarioRef }).strict();
export const CashQuery = z.object({ q: z.literal("cash") }).strict();
export const LowPointQuery = z.object({ q: z.literal("low_point"), scenario: scenarioRef }).strict();
export const FlowQuery = z.object({ q: z.literal("flow"), days, scenario: scenarioRef }).strict();
export const EventsQuery = z.object({ q: z.literal("events"), days, scenario: scenarioRef }).strict();
export const MonthTotalQuery = z.object({ q: z.literal("month_total"), month }).strict();
export const MonthByCategoryQuery = z.object({ q: z.literal("month_by_category"), month }).strict();
export const CompareMonthsQuery = z.object({ q: z.literal("compare_months"), a: month.describe("The earlier month, the base."), b: month.describe("The month compared with it; the change is b minus a.") }).strict();
export const SpendingSearchQuery = z.object({ q: z.literal("spending_search"), text: z.string().max(80), months: z.number().int().min(1).max(12) }).strict();
export const RegularCostsQuery = z.object({ q: z.literal("regular_costs"), months: z.number().int().min(2).max(24).optional() }).strict();

export const QuerySchema = z.discriminatedUnion("q", [
  SentenceQuery, SafeToSpendQuery, CashQuery, LowPointQuery, FlowQuery, EventsQuery,
  MonthTotalQuery, MonthByCategoryQuery, CompareMonthsQuery, SpendingSearchQuery, RegularCostsQuery,
]);
export type Query = z.infer<typeof QuerySchema>;

// What each kind of block may ask. A block that shows one number asks for a number; a chart asks for a flow; and so on.
const NumberQuery = z.discriminatedUnion("q", [SafeToSpendQuery, CashQuery, LowPointQuery, MonthTotalQuery]);
const TableQuery = z.discriminatedUnion("q", [EventsQuery, MonthByCategoryQuery, CompareMonthsQuery, SpendingSearchQuery, RegularCostsQuery]);
const ProgressQuery = z.discriminatedUnion("q", [SafeToSpendQuery, CashQuery, MonthTotalQuery]);

// ---------------------------------------------------------------- blocks

/** An in-app path: starts with one slash, is not `//host`, and never leads to an /api/ route. */
export function isAppPath(href: string): boolean {
  if (!href.startsWith("/") || href.startsWith("//") || href.includes("\\") || /[\u0000-\u001f\u007f\s]/.test(href)) return false;
  return !/^\/api(\/|\?|#|$)/i.test(href);
}

export const BlockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("sentence"), query: SentenceQuery }).strict(),
  z.object({ type: z.literal("number"), label: z.string().min(1).max(60), query: NumberQuery, note: z.string().max(200).optional() }).strict(),
  z.object({ type: z.literal("flow_chart"), query: FlowQuery }).strict(),
  z.object({ type: z.literal("timeline"), query: EventsQuery }).strict(),
  z.object({ type: z.literal("table"), title: z.string().max(80).optional(), query: TableQuery }).strict(),
  z.object({ type: z.literal("compare"), query: CompareMonthsQuery }).strict(),
  z.object({ type: z.literal("progress"), label: z.string().min(1).max(60), query: ProgressQuery, targetMinor: minorAmount.describe("The person's own target, in minor units of the home currency.") }).strict(),
  z.object({ type: z.literal("note"), text: z.string().min(1).max(600), by: z.enum(["you", "assistant"]) }).strict(),
  z.object({ type: z.literal("letter"), text: z.string().min(1).max(4000) }).strict(),
  z.object({ type: z.literal("sliders"), controls: z.array(z.object({ clientId: id, maxDays: z.number().int().min(1).max(MAX_SLIDER_DAYS) }).strict()).min(1).max(4) }).strict(),
  z.object({ type: z.literal("action"), label: z.string().min(1).max(60), href: z.string().max(200).refine(isAppPath, "A link goes to a page inside the app, never an outside address or an /api/ path") }).strict(),
]);
export type Block = z.infer<typeof BlockSchema>;

export const RecipeSchema = z.object({
  version: z.literal(RECIPE_VERSION),
  title: z.string().min(1).max(80),
  scenario: ScenarioSchema.optional().describe("The recipe's own live scenario: any query that says `scenario: \"canvas\"` uses it, and the sliders change its client_late days."),
  blocks: z.array(BlockSchema).min(1).max(MAX_BLOCKS),
}).strict();
export type Recipe = z.infer<typeof RecipeSchema>;

/** The words a person can read for the first problem in a failed parse: "blocks 3: Unrecognized key(s) in object: 'amount'". */
export function problemWords(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "This is not a canvas recipe.";
  const path = issue.path.map(part => (typeof part === "number" ? `#${part + 1}` : String(part))).join(" > ");
  return path ? `${path}: ${issue.message}` : issue.message;
}

/** The JSON Schema of a recipe, generated from the zod definition (the agent is shown it). */
export function recipeJsonSchema(): string {
  const { $schema, ...rest } = zodToJsonSchema(RecipeSchema, { $refStrategy: "root" }) as Record<string, unknown>;
  return JSON.stringify({ $schema, title: "CanvasRecipe", description: "Version 1 of a canvas recipe: blocks that hold queries, never amounts.", ...rest }, null, 2) + "\n";
}

/** The most canvases a household pins, in the cloud and on the device. */
export const MAX_PINS = 8;
/** A pin's title and recipe, checked: the one place those rules live (cloud and device). */
export const titleOf = (title: string): string => {
  const trimmed = title.trim();
  if (trimmed.length < 1 || trimmed.length > 80) throw new InputError("A title is 1 to 80 characters.");
  return trimmed;
};
export function recipeOf(value: unknown): Recipe {
  const parsed = RecipeSchema.safeParse(value);
  if (!parsed.success) throw new InputError(problemWords(parsed.error));
  return parsed.data;
}
