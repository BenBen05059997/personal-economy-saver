// Money in (D77): what clients paid month by month, and how fast each one pays. Pure; every amount integer minor units.
import { minorMoney, plural } from "@/lib/money/format";
import { incomeByMonth } from "@/lib/money/income";
import { paceDots } from "@/lib/money/pace";
import { VIEW_META } from "../catalogue";
import { ViewError, type Empty, type FormData, type Resolver, type Tone, type ViewResult } from "../types";

const NO_CLIENT: Empty = { words: "Add a client who pays you, and what they pay shows here.", add: "client", addLabel: "Add a client" };
const NO_PAYMENT: Empty = { words: "Money in shows here once a client has paid you.", add: null, addLabel: null };
const TONES: Tone[] = ["main", "soft", "quiet"];

export const incomeMonthsView: Resolver<"income_months"> = (args, ctx): ViewResult => {
  const { income } = ctx;
  if (!income) throw new ViewError("Money in is not loaded for this view.");
  const meta = VIEW_META.income_months, currency = ctx.state.homeCurrency, format = (minor: number) => minorMoney(minor, currency);
  const months = args.months ?? 6, found = incomeByMonth(income, ctx.state.today, months);
  const base = { view: "income_months" as const, args: { ...args }, form: meta.form as "stacked_columns", title: "Money in", question: meta.question, hint: meta.hint, home: meta.home, currency, strip: null, source: `Payments your clients made, in ${currency} at the rate on each invoice.` };
  const none = (empty: Empty, aria: string): ViewResult => ({ ...base, data: null, table: null, line: null, aria, empty, figures: { months: 0 } });
  if (ctx.state.clients.length === 0) return none(NO_CLIENT, "No clients yet.");
  if (!income.some(row => row.paidOn.slice(0, 7) >= found.months[0].month && row.paidOn.slice(0, 7) <= ctx.state.today.slice(0, 7))) return none(NO_PAYMENT, "No payments yet.");

  const top = found.clients.slice(0, 3), rest = found.clients.slice(3);
  const segments: FormData["stacked_columns"]["segments"] = [...top.map((client, i) => ({ key: client.id, legend: client.name, tone: TONES[i] })), ...(rest.length ? [{ key: "other", legend: "Other", tone: "ghost" as const }] : [])];
  const columns = found.months.map(month => {
    const parts = [...top.map(client => month.byClient[client.id] ?? 0), ...(rest.length ? [rest.reduce((sum, client) => sum + (month.byClient[client.id] ?? 0), 0)] : [])];
    return { key: month.month, label: month.name.slice(0, 3), parts, total: month.total, totalLabel: format(month.total), current: month.current,
      aria: `${month.name}: ${format(month.total)} in${month.current ? " so far" : ""}${parts.some(v => v > 0) ? `. ${segments.filter((_, i) => parts[i] > 0).map(segment => `${segment.legend} ${format(parts[segments.indexOf(segment)])}`).join(", ")}` : ""}.` };
  });
  // Two lines at the same height would print over each other, so one line then carries both names.
  const refs = found.averageMinor === null ? [] : found.lowest && found.lowest.minor === found.averageMinor ? [{ label: "Average and lowest month", minor: found.averageMinor }]
    : [{ label: "Average", minor: found.averageMinor }, ...(found.lowest ? [{ label: "Lowest month", minor: found.lowest.minor }] : [])];
  const sentence = found.averageMinor === null ? `${format(columns[columns.length - 1].total)} came in so far this month.`
    : `On average ${format(found.averageMinor)} came in a month${found.lowest && found.lowest.minor !== found.averageMinor ? `; the lowest month was ${found.lowest.name} (${format(found.lowest.minor)})` : ""}.`;
  const unrated = found.unrated.length ? ` ${found.unrated.join(" and ")} paid at a rate that is not known, so ${found.unrated.length === 1 ? "that payment is" : "those payments are"} not counted.` : "";
  const head = ["Month", ...segments.map(segment => segment.legend), "Total"];
  return {
    ...base, data: { segments, columns, refs }, empty: null, line: sentence + unrated,
    table: { caption: "Money in by month", head, rows: columns.map((column, i) => ({ key: column.key, cells: [`${found.months[i].name} ${column.key.slice(0, 4)}${column.current ? " (so far)" : ""}`, ...column.parts.map(format), column.totalLabel] })),
      foot: found.averageMinor === null ? null : ["Average a month", ...segments.map(() => ""), format(found.averageMinor)] },
    aria: "Money in by month. Use Tab to move between months.",
    figures: { months, averageMinor: found.averageMinor, lowestMinor: found.lowest?.minor ?? null, currentMinor: columns[columns.length - 1].total, unratedCount: found.unrated.length },
  };
};

const niceMax = (days: number) => Math.max(10, Math.ceil(days / 5) * 5);

export const clientPaceView: Resolver<"client_pace"> = (args, ctx): ViewResult => {
  const { state } = ctx, meta = VIEW_META.client_pace, currency = state.homeCurrency;
  const base = { view: "client_pace" as const, args: { ...args }, form: meta.form as "strip", title: "How fast clients pay", question: meta.question, hint: meta.hint, home: meta.home, currency, strip: null, source: "The days each paid invoice took from sent to paid." };
  const none = (empty: Empty, aria: string): ViewResult => ({ ...base, data: null, table: null, line: null, aria, empty, figures: { clients: 0 } });
  if (args.clientId !== undefined && !state.clients.some(client => client.id === args.clientId)) throw new ViewError("I couldn't find that client.");
  if (state.clients.length === 0) return none(NO_CLIENT, "No clients yet.");
  const found = paceDots(state, args.clientId);
  if (found.length === 0) return none(NO_PAYMENT, "No paid invoices yet.");

  const days = (n: number) => plural(n, "day"), list = (xs: number[]) => xs.length === 1 ? String(xs[0]) : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
  const rows = found.map(row => ({
    key: row.clientId, label: row.name, dots: row.dots, usual: row.usual, slowest: row.slowest,
    open: row.open.map(o => ({ days: o.days, label: `${o.number ? `Invoice ${o.number}` : "An invoice"}: ${days(o.days)} so far`, late: o.late })),
    aria: `${row.name}: paid in ${list(row.dots)} days. Usual ${days(row.usual)}, slowest ${row.slowest}.${row.open.map(o => ` ${o.number ? `Invoice ${o.number}` : "An invoice"} has been open ${days(o.days)}${o.late ? ", longer than the slowest" : ""}.`).join("")}`,
  }));
  const slow = [...found].sort((a, b) => b.usual - a.usual || b.slowest - a.slowest)[0], lateOpen = found.flatMap(row => row.open.filter(o => o.late).map(o => ({ name: row.name, ...o })));
  const open = (o: { number: string | null }) => o.number ? `Invoice ${o.number}` : "An invoice";
  const line = (found.length === 1 ? `${slow.name} usually pays in ${days(slow.usual)}, ${slow.slowest} at most.` : `${slow.name} is the slowest to pay: ${days(slow.usual)} usual, ${slow.slowest} at most.`)
    + lateOpen.map(o => ` ${open(o)} from ${o.name} has been open ${days(o.days)}, longer than any they paid in.`).join("");
  return {
    ...base, empty: null, line,
    data: { maxDays: niceMax(Math.max(...found.flatMap(row => [...row.dots, row.slowest, ...row.open.map(o => o.days)]))), rows },
    table: { caption: "How fast clients pay", head: ["Client", "Usual", "Slowest", "Paid invoices", "Open now"], align: ["end", "end", "end", "end", "start"], foot: null,
      rows: found.map(row => ({ key: row.clientId, cells: [row.name, days(row.usual), days(row.slowest), String(row.dots.length), row.open.length ? row.open.map(o => `${o.number ? `Invoice ${o.number}` : "Invoice"}: ${days(o.days)}${o.late ? " (late)" : ""}`).join(", ") : "None"], tone: row.open.some(o => o.late) ? "short" as const : undefined })) },
    aria: "How fast each client pays, invoice by invoice.",
    figures: { clients: found.length, slowestUsualDays: slow.usual, slowestDays: Math.max(...found.map(row => row.slowest)), lateOpenCount: lateOpen.length },
  };
};
