import { MonthSplit } from "@/components/plan/MonthSplit";
import { PanelHint } from "@/components/ui/PanelHint";
import { Sentence } from "@/components/home/Sentence";
import { dayLabel, minorMoney } from "@/lib/money/format";
import { monthByCategory } from "@/lib/money/month";
import { addDays } from "@/lib/money/runway";
import { splitBalance, transferLine } from "@/lib/money/split";
import type { MoneyState } from "@/lib/money/types";
import "@/components/home/home.css";
import "./family.css";

/**
 * The shared bills that fall due from today to 30 days on, by date (information only). Shared means what the month view
 * means (D52): a confirmed bill with no owner. The money state already holds one row per occurrence (D41).
 */
function sharedBillsComing(state: MoneyState) {
  const through = addDays(state.today, 29);
  const names = new Map(state.split.members.map(member => [member.id, member.name]));
  const unit = state.homeCurrency === "USD" ? 100 : 1;
  return state.bills
    .filter(bill => bill.status === "confirmed" && bill.ownerId === undefined && bill.due >= state.today && bill.due <= through)
    .map(bill => ({ key: bill.id, biller: bill.biller, date: bill.due, paidBy: bill.paidBy ? names.get(bill.paidBy) ?? "" : "", amountMinor: Math.round(bill.amount * unit) }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.biller < b.biller ? -1 : 1));
}

/** D52: the read-only family page. No buttons, no forms, no links into the signed-in app, nothing from PayPal and no emails. */
export function FamilyView({ name, state }: { name: string; state: MoneyState }) {
  const date = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", weekday: "short", timeZone: "UTC" }).format(new Date(state.today)).replace(",", "");
  const bills = sharedBillsComing(state);
  const { transfers } = splitBalance(state.split, state.today);
  const together = state.split.members.length >= 2;
  return <main className="family-page"><article className="money-home">
    <p className="home-note">{name} · family view</p>
    <time className="home-date" dateTime={state.today}>{date}</time>
    <h1><Sentence state={state} linked={false} /></h1>
    <div className="home-panels">
      <div className="home-column">
        <div className="home-panel family-month"><MonthSplit view={monthByCategory(state, state.today)} people={state.split.members} /></div>
      </div>
      <div className="home-column">
        <section id="shared-bills" className="home-panel">
          <h2>Shared bills coming up</h2>
          {bills.length === 0 && <PanelHint className="home-empty">{together ? "No shared bills in the next 30 days." : "Nothing is shared in this household yet."}</PanelHint>}
          {bills.map(bill => <div key={bill.key} className="home-row home-dated">
            <time dateTime={bill.date}>{dayLabel(bill.date)}</time>
            <div>{bill.biller}{bill.paidBy && <small className="family-bill-paid">Paid by {bill.paidBy}</small>}</div>
            <div className="home-number">{minorMoney(bill.amountMinor, state.homeCurrency)}</div>
          </div>)}
        </section>
        {together && <section id="shared-costs" className="home-panel">
          <h2>Who owes whom</h2>
          {transfers.length === 0 && <PanelHint className="home-empty">Nobody owes anyone anything.</PanelHint>}
          {transfers.map(transfer => <div key={transfer.fromId + transfer.toId} className="home-row"><div>{transferLine(transfer, state.homeCurrency)}</div></div>)}
        </section>}
      </div>
    </div>
    <p className="family-note">This is a read-only view that {name} shared by link. Nothing can be changed from here.</p>
  </article></main>;
}
