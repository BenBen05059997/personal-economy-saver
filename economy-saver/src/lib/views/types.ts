// The graph toolset's contract (D77): what a view resolves to, shaped by the chart form that draws it. Pure types; every amount is integer minor units.
import type { AddKind } from "@/components/add/context";
import type { Currency } from "@/lib/catalogue/types";
import type { Fact } from "@/lib/money/facts";
import type { FxCosts } from "@/lib/money/fx-cost";
import type { SpendingInput } from "@/lib/money/spending";
import type { IncomeRow, MoneyState, PotFill } from "@/lib/money/types";
import type { ViewArgs } from "./args";

export type ChartForm = "step_line" | "ranked_bars" | "stacked_columns" | "waterfall" | "sankey" | "calendar" | "strip" | "runway_bar" | "pace_lines" | "goal_line" | "tracks" | "before_after";
export type ViewId = "forecast" | "what_if" | "position" | "month_by_category" | "month_trend" | "month_pace" | "fixed_costs" | "search_months" | "money_flow" | "savings_rate" | "buffer_months" | "income_months" | "client_pace" | "fx_cost" | "goal_pace" | "bills_calendar" | "card_cycle" | "who_owes_whom" | "what_changed" | "tax_ahead";
export type ViewNeed = "spending" | "income" | "potFills" | "fx"; // the money state is always loaded
export type ViewHome = { path: string; label: string } | null; // "See it in <label> ›"
export type Tone = "main" | "soft" | "deep" | "pale" | "quiet" | "ghost" | "short" | "in"; // #F7A30A, #FCCB78, deeper yellow step, palest yellow step, grey #8a857c, ghost grey dashed, red #b3261e, green #1d7a4c
export type TableTwin = { caption: string; head: string[]; rows: { key: string; cells: string[]; tone?: "short" | "in" | "muted"; child?: boolean }[]; foot: string[] | null; /** Per column after the first: "end" (figures, the default) or "start" (words, which wrap). */ align?: ("start" | "end")[] };
export type Empty = { words: string; add: AddKind | null; addLabel: string | null };
export type ViewContext = { state: MoneyState; spending?: SpendingInput; income?: IncomeRow[]; potFills?: PotFill[]; foreignCosts?: FxCosts };
/** Words a person can read. */
export class ViewError extends Error {}

export type RankedRow = { key: string; label: string; note: string; parts: number[]; total: number; totalLabel: string; tick: number | null; tickLabel: string | null; sub: string; aria: string; children?: RankedRow[] };

// One data shape per form; every amount is integer minor units, every label written by the engine's formatters.
export type FormData = {
  step_line: { days: number; startDate: string; xTicks: { index: number; label: string }[]; lines: { key: string; label: string; tone: Tone; points: number[] }[]; band: [string, string] | null; low: { line: string; index: number; minor: number; label: string; short: boolean; sub: string[] }; marks: { index: number; label: string }[]; dayWords: { date: string; label: string; lines: string[] }[]; direct: { line: string; text: string }[] };
  ranked_bars: { segments: { key: string; legend: string; tone: Tone }[]; tick: { legend: string } | null; rows: RankedRow[]; open?: string }; // open: the row key opened first
  stacked_columns: { segments: { key: string; legend: string; tone: Tone }[]; columns: { key: string; label: string; parts: number[]; total: number; totalLabel: string; current: boolean; unknown?: true; aria: string }[]; refs: { label: string; minor: number }[] };
  waterfall: { steps: { key: string; label: string; minor: number; kind: "start" | "plus" | "minus" | "subtotal" | "total"; amountLabel: string; about: boolean }[] };
  sankey: { nodes: { id: string; label: string; column: 0 | 1 | 2; minor: number; amountLabel: string; tone: Tone }[]; links: { from: string; to: string; minor: number }[] };
  calendar: { weeks: { date: string; inRange: boolean; today: boolean; outMinor: number; inMinor: number; short: boolean; items: string[] }[][]; maxOutMinor: number }; // weeks start on Sunday
  strip: { maxDays: number; rows: { key: string; label: string; dots: number[]; usual: number; slowest: number; open: { days: number; label: string; late: boolean }[]; aria: string }[] };
  runway_bar: { months: number; cashLabel: string; monthlyLabel: string; marks: { months: number; label: string }[]; guide: string | null }; // months to one decimal; marks at 3 and 6 months; guide: the source line under the bar
  pace_lines: { days: number; todayIndex: number | null; lines: { key: "this" | "last"; label: string; tone: Tone; points: number[] }[] };
  goal_line: { start: { date: string; minor: number }; target: { date: string; minor: number; label: string }; today: { date: string; minor: number; label: string }; expected: { minor: number; label: string }; projection: { date: string; minor: number; label: string } | null };
  tracks: { from: string; to: string; tracks: { key: string; label: string; events: { date: string; label: string; amountLabel: string | null; tone: Tone; kind: "dot" | "tick" | "due" | "span"; until?: string }[] }[]; arrows: { from: string; to: string; label: string }[] };
  before_after: { pending: boolean; rows: { key: string; label: string; before: string; after: string; change: string | null }[] };
};

export type ViewResult<F extends ChartForm = ChartForm> = {
  view: ViewId; args: Record<string, unknown>; form: F; title: string; question: string; hint: string; home: ViewHome; currency: Currency;
  data: FormData[F] | null; // null exactly when `empty` is set
  table: TableTwin | null; empty: Empty | null;
  line: string | null; // one sentence by code, under the chart and in the show result
  strip: { label: string; value: string }[] | null; // small figures above the chart (Business / Personal)
  aria: string; source: string;
  facts: Fact[]; // the reading (D79, D80): every figure the picture shows or its line states, with its term and case; `line` is written from these
};
export type Resolver<K extends ViewId> = (args: ViewArgs[K], ctx: ViewContext) => ViewResult;
