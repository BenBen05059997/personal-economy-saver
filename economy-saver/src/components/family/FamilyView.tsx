import { MonthSplit } from "@/components/plan/MonthSplit";
import { PanelHint } from "@/components/ui/PanelHint";
import { Sentence } from "@/components/home/Sentence";
import { AMOUNT_NOT_KNOWN } from "@/lib/money/gaps";
import { homeSentence } from "@/lib/money/sentence";
import { sharedBillsComing } from "@/lib/money/family";
import { aboutMoney, dayLabel, minorMoney } from "@/lib/money/format";
import { monthByCategory } from "@/lib/money/month";
import { splitBalance, transferLine } from "@/lib/money/split";
import type { MoneyState } from "@/lib/money/types";

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
    {homeSentence(state).note && <p className="home-sentence-note">{homeSentence(state).note}</p>}
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
            <div className="home-number">{bill.uncounted ? AMOUNT_NOT_KNOWN : bill.estimated ? aboutMoney(bill.amountMinor, state.homeCurrency) : minorMoney(bill.amountMinor, state.homeCurrency)}</div>
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
