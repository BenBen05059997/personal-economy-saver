// A card's cycle (D77): today, when it closes, what it comes to, when it is paid and what covers it, drawn on tracks along one date line.
// With an amount, a purchase today is drawn on the track and an arrow shows the statement it lands on. The amount the agent passes is never
// written into the line or the figures, so the number check cannot confirm the model's own number.
import { cardCycle } from "@/lib/money/card-cycle";
import { dayLabel, minorMoney } from "@/lib/money/format";
import { daysBetween } from "@/lib/money/runway";
import { VIEW_META } from "../catalogue";
import { ViewError, type FormData, type Resolver, type TableTwin, type ViewResult } from "../types";

type Event = FormData["tracks"]["tracks"][number]["events"][number];

export const cardCycleView: Resolver<"card_cycle"> = (args, ctx): ViewResult => {
  const { state } = ctx, meta = VIEW_META.card_cycle, currency = state.homeCurrency, format = (minor: number) => minorMoney(minor, currency);
  const c = cardCycle(state, args.cardId, args.amountMinor);
  if (!c) throw new ViewError("I couldn't find that card. Pick one of your cards.");
  const base = { view: "card_cycle" as const, args: { ...args } as Record<string, unknown>, form: "tracks" as const, title: `${c.label}'s cycle`, question: meta.question, hint: meta.hint, home: meta.home, currency, strip: null, source: "From the card's closing and pay days, its charges and statements, and your bills and clients' usual pay days." };

  const cycleTrack: Event[] = [
    { date: c.today, label: "Building", amountLabel: format(c.openMinor), tone: "soft", kind: "span", until: c.closesOn },
    { date: c.closesOn, label: "Closes", amountLabel: null, tone: "quiet", kind: "tick" },
  ];
  const payTrack: Event[] = [];
  if (c.closed) payTrack.push({ date: c.closed.dueOn, label: "Paid", amountLabel: format(c.closed.amountMinor), tone: "main", kind: "due" });
  payTrack.push({ date: c.dueOn, label: "Paid", amountLabel: format(c.openMinor), tone: c.landing ? "main" : "soft", kind: "due" });
  const coverTrack: Event[] = [];
  const pb = c.payback;
  if (pb) {
    if (pb.source === "bank") coverTrack.push({ date: pb.dueOn, label: "Cash on hand", amountLabel: null, tone: "in", kind: "dot" });
    else if (pb.source === "clients") for (const a of pb.arrivals) coverTrack.push({ date: a.on, label: `${a.clientName} pays`, amountLabel: format(a.amountMinor), tone: "in", kind: "dot" });
    else coverTrack.push({ date: pb.dueOn, label: "Short", amountLabel: format(pb.shortMinor), tone: "short", kind: "dot" });
  }
  const tracks: FormData["tracks"]["tracks"] = [];
  tracks.push({ key: "cycle", label: "This cycle", events: cycleTrack });
  if (c.landing) tracks.push({ key: "purchase", label: "This purchase, today", events: [{ date: c.today, label: "", amountLabel: null, tone: "main", kind: "dot" }] });
  tracks.push({ key: "pay", label: "You pay", events: payTrack });
  if (coverTrack.length) tracks.push({ key: "cover", label: pb?.source === "short" ? "Not covered" : "Covered by", events: coverTrack });
  const arrows = c.landing ? [{ from: c.today, to: c.dueOn, label: `Lands on the statement paid ${dayLabel(c.dueOn)}` }] : [];
  const dates = tracks.flatMap(t => t.events.flatMap(e => [e.date, e.until ?? e.date]));
  const to = dates.reduce((a, b) => (a > b ? a : b));
  const data: FormData["tracks"] = { from: c.today, to: to > c.today ? to : c.today, tracks, arrows };

  const rows: { date: string; cells: string[]; tone?: "short" | "in" }[] = [{ date: c.today, cells: [dayLabel(c.today), "Today", ""] }];
  if (c.landing) rows.push({ date: c.today, cells: [dayLabel(c.today), "This purchase", ""] });
  rows.push({ date: c.closesOn, cells: [dayLabel(c.closesOn), "The cycle closes", `${format(c.openMinor)} so far`] });
  if (c.closed) rows.push({ date: c.closed.dueOn, cells: [dayLabel(c.closed.dueOn), "Closed statement is paid", format(c.closed.amountMinor)] });
  rows.push({ date: c.dueOn, cells: [dayLabel(c.dueOn), "This cycle's statement is paid", format(c.openMinor)] });
  if (pb) {
    const text = pb.source === "bank" ? ["Cash on hand covers it", ""] : pb.source === "short" ? ["Nothing covers it", `Short ${format(pb.shortMinor)}`] : null;
    if (text) rows.push({ date: pb.dueOn, cells: [dayLabel(pb.dueOn), ...text], tone: pb.source === "short" ? "short" : "in" });
    else for (const a of pb.arrivals) rows.push({ date: a.on, cells: [dayLabel(a.on), `${a.clientName} pays`, format(a.amountMinor)], tone: "in" });
  }
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const table: TableTwin = { caption: `${c.label}'s cycle`, head: ["Day", "What happens", "Amount"], foot: null, align: ["end", "start", "end"], rows: rows.map((row, i) => ({ key: `${i}-${row.date}`, cells: row.cells, tone: row.tone })) };

  const cover = !pb ? "" : pb.source === "bank" ? ` The ${format(pb.amountMinor)} statement paid ${dayLabel(pb.dueOn)} is covered by cash on hand.`
    : pb.source === "clients" ? ` The ${format(pb.amountMinor)} statement paid ${dayLabel(pb.dueOn)} is covered once ${pb.arrivals.map(a => a.clientName).join(" and ")} ${pb.arrivals.length === 1 ? "pays" : "pay"}.`
    : ` The ${format(pb.amountMinor)} statement paid ${dayLabel(pb.dueOn)} is not covered: you would be ${format(pb.shortMinor)} short.`;
  const line = c.landing
    ? `A purchase today lands on the statement that closes ${dayLabel(c.closesOn)} and is paid ${dayLabel(c.dueOn)}. ${c.landing.fits ? `It fits: ${format(c.roomMinor)} more can go on this card with every bill still covered.` : `It does not fit: only ${format(c.roomMinor)} more can go on this card with every bill still covered.`}`
    : `${c.label} closes ${dayLabel(c.closesOn)} and is paid ${dayLabel(c.dueOn)}.${cover}`;
  const days = daysBetween(c.today, c.dueOn);
  return {
    ...base, data, table, empty: null, line,
    aria: `${c.label}: today is ${dayLabel(c.today)}, the cycle closes ${dayLabel(c.closesOn)} and is paid ${dayLabel(c.dueOn)}, in ${days} days.${c.landing ? ` A purchase today lands on that statement.` : ""}${cover}`,
    figures: { openMinor: c.openMinor, closedMinor: c.closed?.amountMinor ?? null, paybackMinor: pb?.amountMinor ?? null, shortMinor: pb?.source === "short" ? pb.shortMinor : null, roomMinor: c.roomMinor, limitLeftMinor: c.limitLeftMinor, closesOn: c.closesOn, dueOn: c.dueOn, paidFrom: pb?.source ?? null, landsOn: c.landing ? c.dueOn : null, fitsRoom: c.landing ? (c.landing.fits ? "yes" : "no") : null, days },
  };
};
