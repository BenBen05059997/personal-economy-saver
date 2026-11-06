// Regular costs (D54). Pure: which bills and charges come back month after month, what each cost in every month of a short
// window, and what changed this month. Built on D53's items (`spendingItems`) and D54's one name key (`nameKey`), so the
// Plan panel, the search and the assistant agree. Moves no money; nothing in the runway reads it. Integer minor units.
import type { Currency } from "@/lib/catalogue/types";
import { aboutMoney, minorMoney } from "./format";
import { categoryLabel, type CategoryKey } from "./categories";
import { monthBounds, monthsBack, nameKey, type SpendItem } from "./spending";

export type RegularStatus = "same" | "up" | "down" | "started" | "stopped" | "not_yet";
export type RegularMonth = { month: string; amountMinor: number; count: number; estimated?: true }; // YYYY-MM; estimated: some of the amount is an amount-varies bill's estimate (D54)
export type RegularCost = {
  key: string; // `<category>:<nameKey>`
  label: string; // the newest item's own name
  category: CategoryKey;
  categoryLabel: string;
  kind: SpendItem["kind"]; // the newest item's kind
  months: RegularMonth[]; // every month of the window, oldest first, empty ones at 0
  thisMinor: number;
  lastMinor: number;
  /** This month's or last month's amount holds an estimate, so the change is an estimate too. */
  estimated?: true;
  /** thisMinor − lastMinor; null while the cost is not yet in this month and usually comes later in it (`not_yet`). */
  changeMinor: number | null;
  status: RegularStatus;
  /** This month's amount can still grow: the month is not over and the cost is paid by card (charges arrive as they happen). */
  soFar: boolean;
  /** For `not_yet`: the day of this month it usually lands (the latest earlier item's day, clamped to the month). Else null. */
  usualDay: number | null;
};
export type RegularCosts = { currency: Currency; month: string; months: string[]; items: RegularCost[]; changedLine: string };

/** How many calendar months Regular costs compares by default (D54): this month and the two before it. */
export const REGULAR_MONTHS = 3;

const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const CHANGED: RegularStatus[] = ["up", "down", "started", "stopped"];

/**
 * The regular costs over the `months` calendar months ending with today's month (2 to 24; 3 by default).
 *
 * Grouping: items with the same `nameKey(label)` and category are one cost. A cost is regular when one of its items is a
 * monthly repeating bill, or it has items in at least two months of the window. (A yearly bill is regular only that way:
 * month to month it is not a change.)
 *
 * This month, the rule the screen and the assistant both say: "this month so far, plus known bills still due this month".
 * A confirmed bill dated later this month counts (it is known: a repeating occurrence or a one-off already entered); a card
 * charge counts only up to and including today. Earlier months count in full. Items outside the window are ignored; `items`
 * must cover the whole window through the last day of this month (`spendingItems` over it), or a bill due later is missed.
 *
 * Status, against last month:
 * - started: something this month and nothing in any earlier month of the window (only a monthly repeating bill can be
 *   regular this way: a one-month thing that does not repeat is not regular);
 * - stopped: nothing this month, and either it is a monthly repeating bill with something last month (its occurrence would
 *   be known, so the series ended), or it had something in each of the two months before this one and today is past the day
 *   it usually lands (the latest earlier item's day of the month);
 * - not_yet: nothing this month yet, something last month, and it usually lands later this month (or today): no change is
 *   claimed until it is in;
 * - up, down, same: this month's amount against last month's.
 *
 * Order: the changed ones (up, down, started, stopped) by the size of the change, largest first; then the rest by this
 * month's amount, largest first; ties by label. `changedLine` names every change: "Hikari Denki up ¥2,120 · StreamBox
 * started · Kawa Gym stopped", with "so far" after an amount that can still grow, or "No change in your regular costs this
 * month." `currency` is the household's home currency, the one the items are in.
 */
export function regularCosts(items: SpendItem[], currency: Currency, today: string, months = REGULAR_MONTHS): RegularCosts {
  if (!DATE.test(today)) throw new Error(`today is YYYY-MM-DD, not "${today}"`);
  if (!Number.isInteger(months) || months < 2 || months > 24) throw new Error("A regular-cost window is 2 to 24 months");
  const current = today.slice(0, 7);
  const window = Array.from({ length: months }, (_, i) => monthsBack(current, months - i)); // oldest first
  const from = `${window[0]}-01`, to = monthBounds(current).last;
  const counted = items.filter(i => !i.uncounted && i.date >= from && i.date <= to && (i.kind === "bill" || i.date <= today)); // D55: an amount not known is no history
  const monthOver = today === to;
  const todayDay = Number(today.slice(8, 10));
  const lastDayOfMonth = Number(to.slice(8, 10));

  const groups = new Map<string, SpendItem[]>();
  for (const item of counted) {
    const key = `${item.category}:${nameKey(item.label)}`;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }

  const costs: RegularCost[] = [];
  for (const [key, group] of groups) {
    const byMonth = window.map((month): RegularMonth => {
      const inMonth = group.filter(i => i.date.startsWith(month));
      return { month, amountMinor: inMonth.reduce((sum, i) => sum + i.amountMinor, 0), count: inMonth.length, ...(inMonth.some(i => i.estimated) ? { estimated: true as const } : {}) };
    });
    const monthly = group.some(i => i.repeat === "month");
    if (!monthly && byMonth.filter(m => m.count > 0).length < 2) continue;

    const newest = group.reduce((a, b) => (b.date > a.date || (b.date === a.date && b.label > a.label) ? b : a));
    const [before, last, now] = [byMonth[months - 3], byMonth[months - 2], byMonth[months - 1]];
    const earlier = byMonth.slice(0, -1);
    const latestEarlier = group.filter(i => !i.date.startsWith(current)).reduce<SpendItem | null>((a, b) => (a === null || b.date > a.date ? b : a), null);
    const usual = latestEarlier === null ? null : Math.min(Number(latestEarlier.date.slice(8, 10)), lastDayOfMonth);

    let status: RegularStatus;
    let usualDay: number | null = null;
    if (now.count > 0) {
      status = earlier.every(m => m.count === 0) ? "started" : now.amountMinor > last.amountMinor ? "up" : now.amountMinor < last.amountMinor ? "down" : "same";
    } else if (monthly && last.count > 0) {
      status = "stopped";
    } else if (last.count > 0 && before !== undefined && before.count > 0 && usual !== null && todayDay > usual) {
      status = "stopped";
    } else if (last.count > 0 && usual !== null && todayDay <= usual) {
      status = "not_yet";
      usualDay = usual;
    } else {
      status = now.amountMinor < last.amountMinor ? "down" : "same";
    }
    costs.push({
      key, label: newest.label, category: newest.category, categoryLabel: categoryLabel(newest.category), kind: newest.kind, months: byMonth,
      thisMinor: now.amountMinor, lastMinor: last.amountMinor, changeMinor: status === "not_yet" ? null : now.amountMinor - last.amountMinor,
      status, soFar: !monthOver && group.some(i => i.kind === "charge"), usualDay,
      ...(now.estimated || last.estimated ? { estimated: true as const } : {}),
    });
  }

  const changed = (c: RegularCost) => CHANGED.includes(c.status);
  const byLabel = (a: RegularCost, b: RegularCost) => (a.label < b.label ? -1 : a.label > b.label ? 1 : a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  const ordered = [
    ...costs.filter(changed).sort((a, b) => Math.abs(b.changeMinor!) - Math.abs(a.changeMinor!) || byLabel(a, b)),
    ...costs.filter(c => !changed(c)).sort((a, b) => b.thisMinor - a.thisMinor || byLabel(a, b)),
  ];
  return { currency, month: current, months: window, items: ordered, changedLine: changedLine(ordered, currency) };
}

function changedLine(costs: RegularCost[], currency: Currency): string {
  const parts = costs.flatMap(c => {
    const soFar = c.soFar ? " so far" : "";
    const amount = (minor: number) => c.estimated ? aboutMoney(minor, currency) : minorMoney(minor, currency);
    if (c.status === "up") return [`${c.label} up ${amount(c.changeMinor!)}${soFar}`];
    if (c.status === "down") return [`${c.label} down ${amount(-c.changeMinor!)}${soFar}`];
    if (c.status === "started") return [`${c.label} started`];
    if (c.status === "stopped") return [`${c.label} stopped`];
    return [];
  });
  return parts.length ? parts.join(" · ") : "No change in your regular costs this month.";
}
