// A card's cycle (D77): today, when it closes, what it comes to, when it is paid and what covers it, drawn on tracks along one date line.
// With an amount, a purchase today is drawn on the track and an arrow shows the statement it lands on. The amount is a person fact (D79): it is
// there for the model to read, and it confirms nothing. The rooms before and after come from the engine.
import { engineFact, personFact, type Fact } from "@/lib/money/facts";
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

  // The facts first (D79); the line reads every number and date back from them.
  const from = "card_cycle", money = { from, currency }, about = { type: "card" as const, id: args.cardId, name: c.label };
  const facts: Fact[] = [engineFact("closes_on", c.closesOn, { from, about }), engineFact("due", c.dueOn, { from, about }), engineFact("statement_open", c.openMinor, { ...money, about, period: { on: c.dueOn } })];
  if (c.closed) facts.push(engineFact("closed_statement_due", c.closed.dueOn, { from, about }), engineFact("statement_closed", c.closed.amountMinor, { ...money, about, period: { on: c.closed.dueOn } }));
  facts.push(engineFact("card_room", c.roomMinor, { ...money, about }));
  if (c.roomAfterMinor !== null) facts.push(engineFact("card_room_after", c.roomAfterMinor, { ...money, about }));
  if (c.limitLeftMinor !== null) facts.push(engineFact("limit_left", c.limitLeftMinor, { ...money, about }));
  if (args.amountMinor !== undefined) facts.push(personFact("amount_tested", args.amountMinor, { ...money, about, period: { on: c.today } }));
  if (pb?.source === "clients") for (const a of pb.arrivals) facts.push(engineFact("covering_payment", a.amountMinor, { ...money, period: { on: a.on }, about: { type: "client", id: a.clientName, name: a.clientName } }));
  if (pb?.source === "short") facts.push(engineFact("short", pb.shortMinor, { ...money, case: "late", about }));
  const said = (name: Fact["name"]) => facts.find(item => item.name === name)!.value;
  const statementOf = (open: boolean) => ({ amount: Number(said(open ? "statement_open" : "statement_closed")), dueOn: String(said(open ? "due" : "closed_statement_due")) });
  const stmt = pb ? statementOf(pb.open) : null;
  const cover = !pb ? "" : pb.source === "bank" ? ` The ${format(stmt!.amount)} statement paid ${dayLabel(stmt!.dueOn)} is covered by cash on hand.`
    : pb.source === "clients" ? ` The ${format(stmt!.amount)} statement paid ${dayLabel(stmt!.dueOn)} is covered once ${pb.arrivals.map(a => a.clientName).join(" and ")} ${pb.arrivals.length === 1 ? "pays" : "pay"}.`
    : ` The ${format(stmt!.amount)} statement paid ${dayLabel(stmt!.dueOn)} is not covered: you would be ${format(Number(said("short")))} short.`;
  const line = c.landing
    ? `A purchase today lands on the statement that closes ${dayLabel(String(said("closes_on")))} and is paid ${dayLabel(String(said("due")))}. ${c.landing.fits ? (c.roomAfterMinor !== null ? `It fits: ${format(Number(said("card_room_after")))} more can go on this card after it, with every bill still covered.` : `It fits: ${format(Number(said("card_room")))} more can go on this card with every bill still covered.`) : `It does not fit: only ${format(Number(said("card_room")))} more can go on this card with every bill still covered.`}`
    : `${c.label} closes ${dayLabel(String(said("closes_on")))} and is paid ${dayLabel(String(said("due")))}.${cover}`;
  const days = daysBetween(c.today, c.dueOn);
  return {
    ...base, data, table, empty: null, line, facts,
    aria: `${c.label}: today is ${dayLabel(c.today)}, the cycle closes ${dayLabel(c.closesOn)} and is paid ${dayLabel(c.dueOn)}, in ${days} days.${c.landing ? ` A purchase today lands on that statement.` : ""}${cover}`,
  };
};
