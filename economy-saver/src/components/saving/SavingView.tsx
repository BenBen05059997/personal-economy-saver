import Link from "next/link";
import { notFound } from "next/navigation";
import type { MoneyState, Pot } from "@/lib/money/types";
import { majorMoney } from "@/lib/money/format";
import { goalPace } from "@/lib/money/goals";
import { monthYear, moneyInPotsLine, potLine, roomLine, roomNote } from "@/lib/money/plan";
import { ApiForm } from "@/components/ui/ApiForm";
import { ConfirmDo } from "@/components/ui/ConfirmRemove";
import { PanelHint } from "@/components/ui/PanelHint";
import { Detail, ListPage } from "@/components/household/ListPage";
import { PotFields } from "./PotFields";
import "@/components/household/household.css";
import "./saving.css";

function PotPanel({ state, pot }: { state: MoneyState; pot: Pot }) {
  const money = (n: number) => majorMoney(n, state.homeCurrency);
  const line = potLine(pot, state);
  const goal = goalPace(pot, state);
  const back = `/saving/${pot.id}`;
  return <Detail title={pot.name} close="/saving">
    <p className="directory-big">{money(pot.saved)}</p><p className="ui-hint">Saved</p>
    {line && <p className="saving-line">{line}</p>}
    {goal && goal.neededMinor > 0 && <p className="ui-hint">{goal.paceLine}</p>}
    <details className="directory-edit" open>
      <summary>Edit</summary>
      <ApiForm action="/api/pots">
        <input type="hidden" name="id" value={pot.id} />
        <input type="hidden" name="name" value={pot.name} />
        <input type="hidden" name="returnTo" value={back} />
        <PotFields currency={state.homeCurrency} pot={pot} />
        <button className="ui-button primary">Save changes</button>
      </ApiForm>
    </details>
    <ConfirmDo summary="Remove" summaryLabel={`Remove ${pot.name}`} action="/api/pots/remove" fields={{ id: pot.id, returnTo: "/saving" }}
      question={<p>Remove {pot.name}? {money(pot.saved)} becomes cash you can spend again.</p>} button={`Yes, remove ${pot.name}`} />
  </Detail>;
}

export function SavingView({ state, selected }: { state: MoneyState; selected?: string }) {
  const pot = selected ? state.pots.find(row => row.id === selected) : undefined;
  if (selected && !pot) notFound();
  const money = (n: number) => majorMoney(n, state.homeCurrency);
  const inPots = moneyInPotsLine(state);
  return <ListPage title="Saving" hint="Money you set aside for tax, a trip or a car. It doesn't count as safe to spend." add="pot" addLabel="Add a pot"
    panel={pot ? <PotPanel state={state} pot={pot} /> : undefined}>
    <div className="saving-top">
      <p className="saving-room">{roomLine(state)}</p>
      {roomNote(state) && <p className="ui-hint">{roomNote(state)}</p>}
      {inPots && <p className="ui-hint">{inPots}</p>}
    </div>
    {state.pots.map(item => {
      const goal = goalPace(item, state);
      return <Link key={item.id} prefetch={false} className="ui-row directory-link" href={`/saving/${item.id}`} aria-label={item.name} aria-current={item.id === selected ? "page" : undefined}>
        <div>{item.name}
          <small>
            {item.target === undefined ? "Set aside" : `Target ${money(item.target)}${item.targetDate ? ` · by ${monthYear(item.targetDate)}` : ""}`}
            {item.fillPct !== undefined && ` · ${item.fillPct}% of each client payment`}
          </small>
          {goal && goal.neededMinor > 0 && <small>{goal.paceLine}</small>}</div>
        <div>{money(item.saved)}<small>saved</small></div>
      </Link>;
    })}
    {state.pots.length === 0 && <PanelHint className="directory-empty" add="pot" label="Add a pot">No pots yet. Put money aside for tax, a trip or a car. Money in a pot stops counting as safe to spend.</PanelHint>}
  </ListPage>;
}
