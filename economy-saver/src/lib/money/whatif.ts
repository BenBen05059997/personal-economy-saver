// What if (D57). Pure: the engine run on a copy of the money state with a list of changes. Nothing is written and the input is never
// mutated; `whatIf(state, [])` equals `state`. Every change is expressed in terms the engine already reads, so series, the low point,
// the sentence and the timeline need no second code path:
// - client_late sets `Client.lateDays`, which `project` adds to when that client's invoices land (a no-op while absent);
// - remove_bill drops the bill's occurrences (and its cancel-by notice);
// - change_bill sets the amount on its occurrences and clears the "estimated / not known" marks, because the person has now said it;
// - add_cost adds a confirmed one-off bill on the date;
// - add_income adds a client and a sent invoice that lands on the date (the usual and the late case alike).
// Amounts in a change are integer minor units of the home currency; the state holds whole units (yen, or dollars with cents).
import type { Change } from "@/lib/canvas/schema";
import { latestDate } from "./horizon";
import { minorPerUnit } from "./format";
import { addDays } from "./runway";
import type { Bill, MoneyState } from "./types";

/** A what-if the engine cannot run: the message is written for the person. */
export class WhatIfError extends Error {}

const storedId = (id: string) => (id.includes("@") ? id.slice(0, id.indexOf("@")) : id);

/** The bills a bill id names: a stored id names every occurrence; `<id>@<date>` names one. */
function billsNamed(bills: Bill[], billId: string): Bill[] {
  const named = bills.filter(bill => bill.id === billId || (!billId.includes("@") && storedId(bill.id) === billId));
  if (named.length === 0) throw new WhatIfError("That bill is not in your records, so it cannot be changed in a what-if.");
  return named;
}

function checkDate(state: MoneyState, date: string, what: string, first: string): void {
  if (date < first) throw new WhatIfError(`${what} must be dated ${first === state.today ? "today" : "tomorrow"} or later.`);
  if (date > latestDate(state.today)) throw new WhatIfError(`${what} must be within the next two years.`);
}

export function whatIf(state: MoneyState, changes: readonly Change[]): MoneyState {
  const next: MoneyState = structuredClone(state);
  const unit = minorPerUnit(next.homeCurrency);
  const home = (minor: number) => minor / unit;
  let added = 0;
  for (const change of changes) {
    switch (change.kind) {
      case "client_late": {
        const client = next.clients.find(c => c.id === change.clientId);
        if (!client) throw new WhatIfError("That client is not in your records, so they cannot be late in a what-if.");
        if (change.days === 0) delete client.lateDays; else client.lateDays = change.days;
        break;
      }
      case "remove_bill": {
        const gone = new Set(billsNamed(next.bills, change.billId).map(bill => bill.id));
        next.bills = next.bills.filter(bill => !gone.has(bill.id));
        next.cancelNotices = next.cancelNotices.filter(notice => notice.billId !== storedId(change.billId) || change.billId.includes("@"));
        break;
      }
      case "change_bill": {
        for (const bill of billsNamed(next.bills, change.billId)) {
          bill.amount = home(change.amountMinor);
          for (const key of ["estimated", "amountUnknown", "amountHigh", "basis", "uncounted"] as const) delete bill[key];
        }
        break;
      }
      case "add_cost": {
        checkDate(next, change.date, "A cost in a what-if", next.today);
        added += 1;
        next.bills.push({ id: `whatif-cost-${added}`, biller: change.name, amount: home(change.amountMinor), due: change.date, category: "other", businessBp: 0, status: "confirmed" });
        next.bills.sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : a.biller < b.biller ? -1 : a.biller > b.biller ? 1 : 0));
        break;
      }
      case "add_income": {
        checkDate(next, change.date, "Money coming in, in a what-if,", addDays(next.today, 1));
        added += 1;
        const clientId = `whatif-income-${added}`;
        next.clients.push({ id: clientId, name: change.name, email: "", termsDays: 0, daysToPay: [] });
        // The engine keeps invoices in dollars; the home amount is what lands (`project` rounds it back to the home unit).
        next.invoices.push({ id: clientId, clientId, item: change.name, amountUsd: home(change.amountMinor) / next.fxPerUsd, status: "sent", hasLink: false, sentOn: change.date, dueOn: change.date });
        break;
      }
    }
  }
  return next;
}
