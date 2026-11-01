import type { Invoice, MoneyState } from "@/lib/money/types";
import type { Persona } from "@/lib/sample/personas";
import { dayLabel, homeFormat, previousMonthName } from "./format";

// The demo story, the same for both people: a bill arrives unconfirmed, a piece of finished
// work is unbilled. Which bill and which invoice is set per person in lib/sample/personas.ts.

export type Actor = "AI" | "You" | "PayPal" | "Webhook" | "Email" | "Rule";
export type LogEntry = { id: number; who: Actor; text: string; tool?: string; tm: string; fresh: boolean };

/** Deep copy so Reset always starts from the sample, whatever happened to the last copy. */
export function freshMoney(p: Persona): MoneyState {
  return structuredClone(p.money);
}

export function seedLog(p: Persona, money: MoneyState): LogEntry[] {
  const fmt = homeFormat(money);
  const bill = money.bills.find((b) => b.id === p.demo.billId);
  const rise = bill?.previousAmount ? Math.round((bill.amount / bill.previousAmount - 1) * 100) : 0;
  const prev = previousMonthName(money.today);
  const seeds: Omit<LogEntry, "id" | "fresh">[] = [
    { who: "Rule", text: p.demo.ruleLine, tm: "08:50" },
    {
      who: "PayPal",
      text: `Read balance ${fmt(money.paypal)} and invoice history for ${money.clients.length} clients.`,
      tool: "search_invoicing",
      tm: "08:58",
    },
    {
      who: "Email",
      text: `Bill arrived at ${p.inbox}: “${bill?.biller ?? "Bill"}, November statement (PDF)”`,
      tm: "09:01",
    },
    {
      who: "AI",
      text: bill
        ? `Read the bill: ${fmt(bill.amount)} due ${dayLabel(bill.due)}. That is ${rise}% more than ${prev}.`
        : "No bills to read.",
      tm: "09:02",
    },
  ];
  return seeds.map((s, i) => ({ ...s, id: i + 1, fresh: false }));
}

/** One minute after the last entry, as in the mock. */
export function nextTime(log: LogEntry[]): string {
  const last = log.length ? log[log.length - 1].tm : "09:02";
  const [h, m] = last.split(":").map(Number);
  const n = h * 60 + m + 1;
  return String(Math.floor(n / 60) % 24).padStart(2, "0") + ":" + String(n % 60).padStart(2, "0");
}

export function findInvoice(money: MoneyState, p: Persona): Invoice | undefined {
  return money.invoices.find((i) => i.id === p.demo.invoiceId);
}
