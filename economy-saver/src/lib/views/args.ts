// What each view takes (D77): strict, at most three keys, ids for what it names, integer minor units for an amount.
import { z } from "zod";
import { CATEGORY_KEYS } from "@/lib/money/categories";
import { SEARCH_QUERY_MAX } from "@/lib/money/spending";
import type { ViewId } from "./types";

const id = z.string().min(1).max(80);
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const months = z.number().int().min(2).max(12);
const days = z.number().int().min(1).max(90);
const amountMinor = z.number().int().positive();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** The arguments of each view; the stored block holds ids, `show` takes names that code turns into these. */
export const VIEW_ARGS = {
  forecast: z.object({ case: z.enum(["usual", "late"]).optional(), days: days.optional() }).strict(),
  // An amount and its date, or one client paying late (`late.days`); three keys at most.
  what_if: z.object({ amountMinor: amountMinor.optional(), date: date.optional(), late: z.object({ clientId: id, days: z.number().int().min(1).max(120) }).strict().optional() }).strict(),
  position: z.object({}).strict(),
  month_by_category: z.object({ month: month.optional(), by: z.enum(["category", "business", "person"]).optional(), open: z.enum(CATEGORY_KEYS).optional() }).strict(),
  month_trend: z.object({ months: months.optional() }).strict(),
  month_pace: z.object({ month: month.optional() }).strict(),
  fixed_costs: z.object({ months: months.optional() }).strict(),
  search_months: z.object({ text: z.string().trim().min(1).max(SEARCH_QUERY_MAX), months: months.optional() }).strict(),
  money_flow: z.object({ month: month.optional() }).strict(),
  savings_rate: z.object({ months: months.optional() }).strict(),
  buffer_months: z.object({}).strict(),
  income_months: z.object({ months: months.optional() }).strict(),
  client_pace: z.object({ clientId: id.optional() }).strict(),
  fx_cost: z.object({ months: months.optional() }).strict(),
  goal_pace: z.object({ potId: id }).strict(),
  bills_calendar: z.object({ days: days.optional(), whose: z.literal("shared").optional() }).strict(),
  card_cycle: z.object({ cardId: id, amountMinor: amountMinor.optional() }).strict(),
  who_owes_whom: z.object({}).strict(),
  what_changed: z.object({ itemId: id }).strict(),
  tax_ahead: z.object({ potId: id, days: z.number().int().min(30).max(180).optional() }).strict(), // days: 90 when left out
} satisfies Record<ViewId, z.ZodObject<z.ZodRawShape>>;

export type ViewArgs = { [K in ViewId]: z.infer<(typeof VIEW_ARGS)[K]> };

/** The stored `{ type: "view", view, args }` block, for the views that are live. */
export function viewBlockSchema(live: ViewId[]) {
  const blocks = live.map(view => z.object({ type: z.literal("view"), view: z.literal(view), args: VIEW_ARGS[view] }).strict());
  if (blocks.length === 0) return z.never();
  if (blocks.length === 1) return blocks[0];
  return z.union(blocks as unknown as [(typeof blocks)[number], (typeof blocks)[number], ...(typeof blocks)[number][]]);
}
