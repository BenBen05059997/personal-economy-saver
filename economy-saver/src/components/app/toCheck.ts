import { pendingCharges } from "@/lib/money/runway";
import type { Bill, Charge, Invoice, MoneyState } from "@/lib/money/types";
import type { Persona } from "@/lib/sample/personas";
import { findInvoice } from "./demo";
import { stageOf } from "./state";

/** Everything the assistant read or drafted that waits for the person: the Activity "To check" queue. */
export type ToCheck = {
  bills: Bill[]; // read from an email or photo, not confirmed
  charges: Charge[]; // card emails and receipts, not confirmed
  drafts: Invoice[]; // invoices the assistant drafted that need an OK
  count: number;
};

export function toCheck(money: MoneyState, persona: Persona): ToCheck {
  const bills = money.bills.filter((b) => b.status === "pending");
  const charges = pendingCharges(money);
  const demo = findInvoice(money, persona);
  const demoWaits = !!demo && stageOf(money, persona) === "approve";
  const drafts = money.invoices.filter((i) => (i.id === demo?.id ? demoWaits : i.status === "draft"));
  return { bills, charges, drafts, count: bills.length + charges.length + drafts.length };
}
