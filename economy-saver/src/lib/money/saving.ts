// What we made (D81): the saving engine. Pure: the pot record and the spending items go in, integer minor units of the home
// currency come out, and today always comes from the caller. Two kinds of number live here and are never added together:
// money set aside (real money that moved into pots) and what choices saved (wins; no money moves by itself).
import type { Currency } from "@/lib/catalogue/types";
import { addDays, daysBetween } from "./dates";
import { categoryLabel, type CategoryKey } from "./categories";
import { fromMinor, toMinor } from "./format";
import { nameKey, storedId } from "./name-key";
import { regularCosts } from "./regular";
import { monthBounds, monthsBack, type SpendItem } from "./spending";
import type { Choice, MoneyState, Pot, PotMove, Purchase, SavingRecord } from "./types";

/** The floors for a found win: at least this share (basis points) of its baseline and this many minor units; and how many months make a usual. */
export const FOUND = { minShareBp: 1000, minMinor: 500, usualMonths: 3 } as const;
/** Thresholds per medal kind, level 0 to 3: minor units for choices, counts for goals and months. */
export const MEDALS = { choices: [10_000, 100_000, 500_000, 1_000_000], goals: [1, 3, 6, 12], months: [3, 6, 12, 24] } as const;
export const MEDAL_NAMES = ["Bronze", "Silver", "Gold", "Platinum"] as const;
/** How far back a purchase can still be matched to a pot, and the least share of the pot's balance it must be. */
const MATCH_DAYS = 14, MATCH_SHARE_BP = 2000;

export const isTaxPot = (pot: { category?: CategoryKey | null }): boolean => pot.category === "government_tax";

const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);
const lastDay = (month: string) => monthBounds(month).last;
const monthOf = (day: string) => day.slice(0, 7);

// ---- A pot's story ----

type StoryPurchase = { purchase: Purchase | null; minor: number; on: string };
type StoryCarry = { potId: string; potName: string; minor: number };
export type PotStory = {
  potId: string; name: string; tax: boolean;
  /** The day of the pot's first move; null for a pot with none. */
  since: string | null;
  /** The start and typed corrections; may be negative. */
  startMinor: number;
  fromPaymentsMinor: number; addedMinor: number; fromChoicesMinor: number; carriedInMinor: number;
  /** Everything that went into the pot apart from the start and corrections: the four ways in. */
  wentInMinor: number;
  takenOutMinor: number; becameMinor: number; carriedOutMinor: number; outMinor: number;
  savedMinor: number;
  purchases: StoryPurchase[];
  /** The other pots money came in from and went out to, by the carry's pair. */
  carriedFrom: StoryCarry[]; carriedTo: StoryCarry[];
  /** Confirmed choices that put money in this pot (not withdrawn). */
  choices: Choice[];
};

/** A pot's story from the record: where its money came from and what it became. Throws, naming the pot, unless start + went in − out = what the pot holds. `currency` is the household's home currency (a pot's `saved` is in major units). */
export function potStory(record: SavingRecord, pot: Pot, currency: Currency): PotStory {
  const moves = record.moves.filter(move => move.potId === pot.id);
  const out = (n: number) => (n === 0 ? 0 : -n);
  const total = (kind: PotMove["kind"], keep: (move: PotMove) => boolean = () => true) => sum(moves.filter(move => move.kind === kind && keep(move)).map(move => move.minor));
  const startMinor = total("adjust");
  const fromPaymentsMinor = total("fill"), fromChoicesMinor = total("add", move => move.choiceId !== null), addedMinor = total("add", move => move.choiceId === null);
  const carriedInMinor = total("carry", move => move.minor > 0), carriedOutMinor = out(total("carry", move => move.minor < 0));
  const takenOutMinor = out(total("take_out")), becameMinor = out(total("spend"));
  const wentInMinor = fromPaymentsMinor + addedMinor + fromChoicesMinor + carriedInMinor, outMinor = takenOutMinor + becameMinor + carriedOutMinor;
  const savedMinor = toMinor(pot.saved, currency);
  if (startMinor + wentInMinor - outMinor !== savedMinor) {
    throw new Error(`${pot.name}: its start ${fromMinor(startMinor, currency)} plus what went in ${fromMinor(wentInMinor, currency)} less what came out ${fromMinor(outMinor, currency)} is not the ${fromMinor(savedMinor, currency)} it holds`);
  }
  const partner = (move: PotMove) => record.moves.find(other => other.pairId !== null && other.pairId === move.pairId && other.potId !== move.potId);
  const carries = (inward: boolean): StoryCarry[] => moves.filter(move => move.kind === "carry" && (move.minor > 0) === inward).flatMap(move => {
    const other = partner(move);
    return other ? [{ potId: other.potId, potName: other.potName, minor: Math.abs(move.minor) }] : [];
  });
  const choiceIds = new Set(moves.filter(move => move.kind === "add" && move.choiceId !== null).map(move => move.choiceId));
  const first = moves.reduce<string | null>((day, move) => (day === null || move.on < day ? move.on : day), null);
  return {
    potId: pot.id, name: pot.name, tax: isTaxPot(pot), since: first, startMinor,
    fromPaymentsMinor, addedMinor, fromChoicesMinor, carriedInMinor, wentInMinor, takenOutMinor, becameMinor, carriedOutMinor, outMinor, savedMinor,
    purchases: moves.filter(move => move.kind === "spend").map(move => ({ purchase: move.purchase, minor: -move.minor, on: move.on })).sort((a, b) => a.on < b.on ? -1 : a.on > b.on ? 1 : 0),
    carriedFrom: carries(true), carriedTo: carries(false),
    choices: record.choices.filter(choice => choiceIds.has(choice.id) && choice.withdrawnOn === null),
  };
}

// ---- Set aside in a month ----

type PotAmount = { potId: string; label: string; minor: number };
export type SetAside = {
  month: string;
  /** What went into pots other than the tax pot, and into the tax pot (fills and money put in by hand). Starts, corrections and carries never count. */
  forGoalsMinor: number; forTaxMinor: number; totalMinor: number;
  /** Each pot's part, largest first, nothing at 0. */
  byPot: (PotAmount & { tax: boolean })[];
  /** What came out of pots in the month (spends and money taken out), per pot as a positive amount, largest first. */
  fromPots: PotAmount[]; fromPotsMinor: number;
};

/** The one sum of what was set aside and what came out of pots in `month` (YYYY-MM): the Where-it-went flow reads it too. */
export function setAside(moves: readonly PotMove[], month: string): SetAside {
  const ins = new Map<string, { label: string; minor: number; tax: boolean }>(), outs = new Map<string, { label: string; minor: number }>();
  for (const move of moves) {
    if (monthOf(move.on) !== month) continue;
    if (move.kind === "fill" || move.kind === "add") ins.set(move.potId, { label: move.potName, tax: move.potCategory === "government_tax", minor: (ins.get(move.potId)?.minor ?? 0) + move.minor });
    else if (move.kind === "spend" || move.kind === "take_out") outs.set(move.potId, { label: move.potName, minor: (outs.get(move.potId)?.minor ?? 0) - move.minor });
  }
  const byBig = (a: { minor: number; label: string }, b: { minor: number; label: string }) => b.minor - a.minor || a.label.localeCompare(b.label);
  const byPot = [...ins].map(([potId, value]) => ({ potId, ...value })).filter(pot => pot.minor > 0).sort(byBig);
  const fromPots = [...outs].map(([potId, value]) => ({ potId, ...value })).filter(pot => pot.minor > 0).sort(byBig);
  const forTaxMinor = sum(byPot.filter(pot => pot.tax).map(pot => pot.minor)), forGoalsMinor = sum(byPot.filter(pot => !pot.tax).map(pot => pot.minor));
  return { month, forGoalsMinor, forTaxMinor, totalMinor: forGoalsMinor + forTaxMinor, byPot, fromPots, fromPotsMinor: sum(fromPots.map(pot => pot.minor)) };
}

// ---- Found wins ----

export type FoundWin = {
  /** `M:cost:<category>:<nameKey>`, `M:cat:<key>` or `M:own:<id>`, M as YYYY-MM: the choice's found key. */
  key: string;
  month: string;
  kind: "cost_down" | "cost_stopped" | "under_usual";
  label: string;
  category: CategoryKey | null;
  /** The person's own category id, for an `M:own:` win. */
  ownId: string | null;
  /** What was found, after the floor and the said-overlap: always at least the floors. */
  winMinor: number;
  /** The usual (middle of the three months before) or, for a regular cost, last month's amount. */
  baselineMinor: number;
  /** What the month came to. */
  monthMinor: number;
};

/** An item with a spend move from a pot is the pot's money, not a saving. A bill's occurrence is told by its day. */
function spentFromPot(item: SpendItem, record: SavingRecord): boolean {
  return record.moves.some(move => move.kind === "spend" && move.purchase !== null && move.purchase.kind === item.kind
    && (item.kind === "charge" ? move.purchase.id === item.id : move.purchase.id === storedId(item.id) && move.purchase.on === item.date));
}

const median3 = (values: readonly number[]) => [...values].sort((a, b) => a - b)[1];
const floorOk = (win: number, baseline: number) => win >= FOUND.minMinor && win * 10_000 >= baseline * FOUND.minShareBp;

/**
 * What the records show saved in the closed month `month` (YYYY-MM), each win at least 10% of its baseline and 500 minor:
 * - a regular cost (regularCosts at the month's last day, no estimate in either month) that went `down` (last month less this month) or `stopped` (last month's amount): `M:cost:<category>:<nameKey>`;
 * - a group under your usual: the own categories plus each category's items without one, leaving out Government & tax, Debt, regular-cost items and anything with a spend move from a pot. The usual is the middle of the three months before; all four months need items. The win is usual less the month less that category's confirmed said choices in the month (O1), and a win that falls under the floors is dropped: `M:cat:<key>`, `M:own:<id>`.
 * Nothing for a month that is not yet closed (`today` is its month or earlier) or has no items. `items` must reach back four months before `month`.
 */
export function foundWins(items: readonly SpendItem[], currency: Currency, month: string, record: SavingRecord, today: string): FoundWin[] {
  if (month >= monthOf(today)) return [];
  const counted = items.filter(item => !item.uncounted);
  if (!counted.some(item => monthOf(item.date) === month)) return [];
  const wins: FoundWin[] = [];

  // Regular costs that fell or stopped.
  const regular = regularCosts([...items], currency, lastDay(month));
  const regularKeys = new Set(regular.items.map(cost => cost.key));
  for (const cost of regular.items) {
    if (cost.estimated || (cost.status !== "down" && cost.status !== "stopped")) continue;
    const win = cost.status === "stopped" ? cost.lastMinor : cost.lastMinor - cost.thisMinor;
    if (!floorOk(win, cost.lastMinor)) continue;
    wins.push({ key: `${month}:cost:${cost.key}`, month, kind: cost.status === "stopped" ? "cost_stopped" : "cost_down", label: cost.label, category: cost.category, ownId: null, winMinor: win, baselineMinor: cost.lastMinor, monthMinor: cost.thisMinor });
  }

  // Groups under their usual.
  const window = [monthsBack(month, 4), monthsBack(month, 3), monthsBack(month, 2)], span = [...window, month];
  const groups = new Map<string, { category: CategoryKey; ownId: string | null; label: string; items: SpendItem[] }>();
  for (const item of counted) {
    if (!span.includes(monthOf(item.date)) || item.category === "government_tax" || item.category === "debt") continue;
    if (regularKeys.has(`${item.category}:${nameKey(item.label)}`) || spentFromPot(item, record)) continue;
    const key = item.own ? `own:${item.own.id}` : `cat:${item.category}`;
    const group = groups.get(key) ?? { category: item.category, ownId: item.own?.id ?? null, label: item.own ? item.own.name : categoryLabel(item.category), items: [] };
    group.items.push(item);
    groups.set(key, group);
  }
  const raw = [...groups].flatMap(([key, group]) => {
    const totals = span.map(m => group.items.filter(item => monthOf(item.date) === m));
    if (totals.some(inMonth => inMonth.length === 0)) return [];
    const [usual, thisMonth] = [median3(totals.slice(0, 3).map(inMonth => sum(inMonth.map(item => item.amountMinor)))), sum(totals[3].map(item => item.amountMinor))];
    return usual - thisMonth > 0 ? [{ key, group, usual, thisMonth, win: usual - thisMonth }] : [];
  });
  // O1: what the person said they saved in a category is already counted; take it off that category's biggest win first.
  const said = (category: CategoryKey) => sum(record.choices.filter(choice => choice.source === "said" && choice.withdrawnOn === null && choice.category === category && monthOf(choice.happenedOn) === month).map(choice => choice.minor));
  for (const category of new Set(raw.map(entry => entry.group.category))) {
    let left = said(category);
    for (const entry of raw.filter(row => row.group.category === category).sort((a, b) => b.win - a.win || (a.key < b.key ? -1 : 1))) {
      const take = Math.min(left, entry.win);
      entry.win -= take;
      left -= take;
    }
  }
  for (const entry of raw) {
    if (!floorOk(entry.win, entry.usual)) continue;
    wins.push({ key: `${month}:${entry.key}`, month, kind: "under_usual", label: entry.group.label, category: entry.group.category, ownId: entry.group.ownId, winMinor: entry.win, baselineMinor: entry.usual, monthMinor: entry.thisMonth });
  }
  return wins.sort((a, b) => b.winMinor - a.winMinor || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

// ---- A month's wins ----

export type MonthWins = {
  month: string;
  /** Confirmed, not withdrawn, happened in the month. */
  said: Choice[];
  /** Found wins already kept, at their stored amount. */
  kept: Choice[];
  /** Found wins of the month not yet kept (and never kept, withdrawn or not). */
  fresh: FoundWin[];
  saidMinor: number; foundMinor: number; freshMinor: number; keptMinor: number; totalMinor: number; count: number;
};

/** What the choices of `month` saved: said + kept found (at their stored amount) + fresh found not yet kept. Never money set aside. */
export function monthWins(record: SavingRecord, found: readonly FoundWin[], month: string): MonthWins {
  const live = record.choices.filter(choice => choice.withdrawnOn === null && monthOf(choice.happenedOn) === month);
  const said = live.filter(choice => choice.source === "said"), kept = live.filter(choice => choice.source === "found");
  const seen = new Set(record.choices.map(choice => choice.foundKey).filter((key): key is string => key !== null));
  const fresh = found.filter(win => win.month === month && !seen.has(win.key));
  const saidMinor = sum(said.map(choice => choice.minor)), keptMinor = sum(kept.map(choice => choice.minor)), freshMinor = sum(fresh.map(win => win.winMinor));
  return { month, said, kept, fresh, saidMinor, keptMinor, freshMinor, foundMinor: keptMinor + freshMinor, totalMinor: saidMinor + keptMinor + freshMinor, count: said.length + kept.length + fresh.length };
}

// ---- Medals ----

type MedalKind = "choices" | "goals" | "months";
export type Medal = {
  kind: MedalKind; level: 0 | 1 | 2 | 3; name: (typeof MEDAL_NAMES)[number];
  threshold: number;
  /** The day it was earned; null while still to go. Never moves and never goes away. */
  earnedOn: string | null;
  /** What is still to go (minor units for choices, a count for the others); only on the next unearned level of its kind. */
  toGo: number | null;
};

/** Every medal level of every kind, replayed from the confirmed record: a level is earned the first day its total reaches the threshold, and neither the day nor the medal changes after. */
/**
 * The days behind the goal and month medals, oldest first: `goalDays` are the done days of saving pots that paid for something;
 * `monthDays` the first day of each month with money put toward a goal (a fill or add into a pot other than the tax pot).
 * Their lengths are goals reached and months with something set aside: totals, never a run.
 */
export function milestones(record: SavingRecord, pots: readonly Pot[]): { goalDays: string[]; monthDays: string[] } {
  const spentPots = new Set(record.moves.filter(move => move.kind === "spend").map(move => move.potId));
  const goalDays = pots.filter(pot => pot.doneOn !== undefined && !isTaxPot(pot) && spentPots.has(pot.id)).map(pot => pot.doneOn!).sort();
  const firstInMonth = new Map<string, string>();
  for (const move of record.moves) {
    if ((move.kind !== "fill" && move.kind !== "add") || move.potCategory === "government_tax") continue;
    const month = monthOf(move.on), kept = firstInMonth.get(month);
    if (kept === undefined || move.on < kept) firstInMonth.set(month, move.on);
  }
  return { goalDays, monthDays: [...firstInMonth].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, day]) => day) };
}

export function medals(record: SavingRecord, pots: readonly Pot[]): Medal[] {
  // choices: +minor from confirmedOn, -minor from withdrawnOn; a day counts once all its events are in.
  const events = record.choices.flatMap(choice => [{ on: choice.confirmedOn, delta: choice.minor }, ...(choice.withdrawnOn !== null ? [{ on: choice.withdrawnOn, delta: -choice.minor }] : [])]).sort((a, b) => a.on < b.on ? -1 : a.on > b.on ? 1 : 0);
  const choiceDays: { on: string; total: number }[] = [];
  let running = 0;
  for (const event of events) {
    running += event.delta;
    if (choiceDays.at(-1)?.on === event.on) choiceDays.at(-1)!.total = running; else choiceDays.push({ on: event.on, total: running });
  }
  const earnedChoices = (threshold: number) => choiceDays.find(day => day.total >= threshold)?.on ?? null;

  const { goalDays, monthDays } = milestones(record, pots);

  const out: Medal[] = [];
  const level = (kind: MedalKind, thresholds: readonly number[], earnedOf: (threshold: number) => string | null, current: number) => {
    let nextOpen = true;
    thresholds.forEach((threshold, i) => {
      const earnedOn = earnedOf(threshold);
      const toGo = earnedOn === null && nextOpen ? Math.max(0, threshold - current) : null;
      if (earnedOn === null) nextOpen = false;
      out.push({ kind, level: i as Medal["level"], name: MEDAL_NAMES[i], threshold, earnedOn, toGo });
    });
  };
  level("choices", MEDALS.choices, earnedChoices, running);
  level("goals", MEDALS.goals, n => goalDays[n - 1] ?? null, goalDays.length);
  level("months", MEDALS.months, n => monthDays[n - 1] ?? null, monthDays.length);
  return out;
}

// ---- Personal bests ----

type Best = { month: string; minor: number; /** The most of any earlier month. */ beatMinor: number; /** How many earlier months it beat. */ earlierMonths: number };
export type Bests = {
  choices: Best | null;
  setAside: Best | null;
  /** Regular costs whose cost in the month was the lowest of the last 12 months (at least 6 recorded); `beatMinor` is the lowest of the others. */
  lowestRegular: { key: string; label: string; category: CategoryKey; minor: number; beatMinor: number }[];
};

function bestOf(month: string, byMonth: Map<string, number>): Best | null {
  const now = byMonth.get(month) ?? 0;
  const earlier = [...byMonth].filter(([m, minor]) => m < month && minor > 0).map(([, minor]) => minor);
  if (now <= 0 || earlier.length < 2 || earlier.some(minor => minor >= now)) return null;
  return { month, minor: now, beatMinor: Math.max(...earlier), earlierMonths: earlier.length };
}

/** The personal bests of the closed month `month` (YYYY-MM), each beating at least two earlier months: the most choices saved (said and kept found, by the day they happened), the most put toward goals, and regular costs at their lowest in a year. */
export function personalBests(record: SavingRecord, items: readonly SpendItem[], currency: Currency, month: string, today: string): Bests {
  if (month >= monthOf(today)) return { choices: null, setAside: null, lowestRegular: [] };
  const choiceMonths = new Map<string, number>();
  for (const choice of record.choices) if (choice.withdrawnOn === null) choiceMonths.set(monthOf(choice.happenedOn), (choiceMonths.get(monthOf(choice.happenedOn)) ?? 0) + choice.minor);
  const asideMonths = new Map<string, number>();
  for (const m of new Set(record.moves.map(move => monthOf(move.on)))) asideMonths.set(m, setAside(record.moves, m).forGoalsMinor);

  const lowestRegular: Bests["lowestRegular"] = [];
  for (const cost of regularCosts([...items], currency, lastDay(month), 12).items) {
    const recorded = cost.months.filter(m => m.count > 0 && m.amountMinor > 0);
    const now = cost.months.at(-1)!;
    if (recorded.length < 6 || cost.estimated || cost.months.some(m => m.estimated) || now.count === 0) continue;
    const others = recorded.filter(m => m.month !== month).map(m => m.amountMinor);
    if (others.length === 0 || others.some(minor => minor <= now.amountMinor)) continue;
    lowestRegular.push({ key: cost.key, label: cost.label, category: cost.category, minor: now.amountMinor, beatMinor: Math.min(...others) });
  }
  return { choices: bestOf(month, choiceMonths), setAside: bestOf(month, asideMonths), lowestRegular };
}

// ---- Purchases that may have come from a pot ----

export type Match = {
  purchase: Purchase & { amountMinor: number; category: CategoryKey; date: string };
  /** Open saving pots in the purchase's category that hold money and are at most five times the purchase. */
  pots: Pot[];
};

/** A confirmed charge or one-off bill of the last 14 days, not regular, not yet spent from a pot, with the open non-tax pots it could have come from: same category, holding money, the purchase at least 20% of the balance. Newest first. */
export function matchCandidates(state: MoneyState, record: SavingRecord, items: readonly SpendItem[]): Match[] {
  const { today, homeCurrency: currency } = state;
  const regularKeys = new Set(regularCosts([...items], currency, today).items.map(cost => cost.key));
  const from = addDays(today, -MATCH_DAYS);
  const open = state.pots.filter(pot => pot.doneOn === undefined && !isTaxPot(pot) && pot.category !== undefined && pot.saved > 0);
  const matches: Match[] = [];
  for (const item of items) {
    if (item.uncounted || item.estimated || item.amountMinor <= 0 || item.date < from || item.date > today || daysBetween(item.date, today) > MATCH_DAYS) continue;
    if (item.kind === "bill" && item.repeat !== null) continue;
    if (regularKeys.has(`${item.category}:${nameKey(item.label)}`) || spentFromPot(item, record)) continue;
    const pots = open.filter(pot => pot.category === item.category && item.amountMinor * 10_000 >= toMinor(pot.saved, currency) * MATCH_SHARE_BP);
    if (pots.length === 0) continue;
    matches.push({ purchase: { kind: item.kind, id: item.kind === "bill" ? storedId(item.id) : item.id, on: item.kind === "bill" ? item.date : null, label: item.label, amountMinor: item.amountMinor, category: item.category, date: item.date }, pots });
  }
  return matches.sort((a, b) => a.purchase.date < b.purchase.date ? 1 : a.purchase.date > b.purchase.date ? -1 : a.purchase.id < b.purchase.id ? -1 : 1);
}

/** The pot the newest found win was put into, among pots that are still open saving pots; null when none. */
export function lastFoundPot(record: SavingRecord, pots: readonly Pot[]): Pot | null {
  const found = new Set(record.choices.filter(choice => choice.source === "found").map(choice => choice.id));
  const adds = record.moves.map((move, order) => ({ move, order })).filter(({ move }) => move.kind === "add" && move.choiceId !== null && found.has(move.choiceId))
    .sort((a, b) => (a.move.on < b.move.on ? 1 : a.move.on > b.move.on ? -1 : b.order - a.order));
  for (const { move } of adds) {
    const pot = pots.find(candidate => candidate.id === move.potId);
    if (pot && pot.doneOn === undefined && !isTaxPot(pot)) return pot;
  }
  return null;
}
