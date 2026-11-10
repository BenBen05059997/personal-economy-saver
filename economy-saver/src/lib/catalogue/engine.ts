import jpData from "@/data/catalogue/jp.json";
import usData from "@/data/catalogue/us.json";
import { formulas } from "./formulas";
import {
  Catalogue,
  type Context,
  type Deadline,
  type Effort,
  type Move,
  type Profile,
  type Region,
  type Suggestion,
  type Valued,
} from "./types";

const raw: Record<Region, unknown> = { JP: jpData, US: usData };
const parsed: Partial<Record<Region, Move[]>> = {};

// Parsed once per region; a malformed catalogue throws with the zod path so it is caught in dev.
function catalogue(region: Region): Move[] {
  return (parsed[region] ??= Catalogue.parse(raw[region]));
}

/** One move of a region's catalogue by id, from the same once-parsed list; undefined when there is none. */
export function catalogueMove(region: Region, id: string): Move | undefined {
  return catalogue(region).find(m => m.id === id);
}

const DAY = 86_400_000;

// Days from today to the next occurrence of the deadline (0 = today), or undefined if it has passed.
function dueInDays(deadline: Deadline, today: string): number | undefined {
  const t = Date.parse(today);
  if (deadline.date) {
    const d = Math.round((Date.parse(deadline.date) - t) / DAY);
    return d >= 0 ? d : undefined;
  }
  const year = Number(today.slice(0, 4));
  for (const y of [year, year + 1]) {
    const d = Math.round((Date.parse(`${y}-${deadline.monthDay}`) - t) / DAY);
    if (d >= 0) return d;
  }
  return undefined;
}

const perYear = (v: Valued) => (v.per === "month" ? v.amount * 12 : v.amount);
const effortWeight: Record<Effort, number> = { minutes: 1, evening: 2, ongoing: 3, weekend: 4 };

// The house rules from research/users/README.md, applied before any maths.
function blocked(m: Move, p: Profile, c: Context): string | undefined {
  if (p.loanPending && m.freezeWhenLoanPending) return "paused while a loan application is pending";
  if (m.tier === "insider" && p.revolvingBalance > 0) return "clear the revolving balance first";
  if (Math.max(0, c.worstLow) < m.minFreeCash) return "needs more free cash than the runway allows";
  return undefined;
}

function due(m: Move, today: string): number | undefined {
  return m.deadline ? dueInDays(m.deadline, today) : undefined;
}

function matchesMoment(m: Move, c: Context): boolean {
  if (c.moment === "deadline_near") {
    const d = due(m, c.today);
    return d !== undefined && m.deadline !== undefined && d <= m.deadline.remindDaysBefore;
  }
  return m.moments.includes(c.moment);
}

function score(m: Move, v: Valued, dueIn: number | undefined): number {
  const urgency = dueIn !== undefined && dueIn <= 30 ? 1.5 : 1;
  const surprise = m.tier === "insider" ? 1.5 : 1;
  return (perYear(v) * surprise * urgency) / effortWeight[m.effort];
}

// Ranked suggestions for this moment. Moves without a formula are skipped (and reported in dev).
export function suggest(p: Profile, c: Context, limit = 3): Suggestion[] {
  const out: Suggestion[] = [];
  for (const m of catalogue(p.region)) {
    if (!matchesMoment(m, c) || blocked(m, p, c)) continue;
    const f = formulas[m.id];
    if (!f) {
      if (process.env.NODE_ENV !== "production") console.warn(`catalogue: no formula for ${m.id}`);
      continue;
    }
    if (f.eligible(p, c) !== true) continue;
    const value = f.value(p, c);
    if (value.amount <= 0) continue;
    const dueIn = due(m, c.today);
    out.push({ move: m, value, score: score(m, value, dueIn), dueInDays: dueIn });
  }
  const pinned = (x: Suggestion) => (x.move.pinAt.includes(c.moment) ? 1 : 0);
  return out.sort((a, b) => pinned(b) - pinned(a) || b.score - a.score).slice(0, limit);
}
