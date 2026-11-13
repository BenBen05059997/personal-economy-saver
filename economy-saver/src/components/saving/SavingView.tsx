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
import { Sankey } from "@/components/views/forms/Sankey";
import { RunwayBar } from "@/components/views/forms/RunwayBar";
import { StackedColumns } from "@/components/views/forms/StackedColumns";
import { GoalLine } from "@/components/views/forms/GoalLine";
import { StepLine } from "@/components/views/forms/StepLine";
import { ViewPanel, type PanelQuestion } from "@/components/views/ViewPanel";
import { db } from "@/db/client";
import { withHousehold } from "@/db/household";
import { readPlaces } from "@/db/place";
import { currentHouseholdId } from "@/lib/session";
import { loadViewContext } from "@/lib/views/load";
import { goalPaceView } from "@/lib/views/v/goal-pace";
import { taxAheadView } from "@/lib/views/v/tax-ahead";
import { bufferMonthsView, moneyFlowView, savingsRateView } from "@/lib/views/v/keep";
import type { ViewResult } from "@/lib/views/types";
import { PotFields } from "./PotFields";
import "@/components/household/household.css";
import "./saving.css";

/** A pot's own panel (D77): only the questions that apply to it, its pace when it has a target and a date and the tax ahead when it has a fill rule; the switch only when both do (D73). */
async function PotViews({ state, pot }: { state: MoneyState; pot: Pot }) {
  const hid = await currentHouseholdId();
  if (!hid) return null;
  const ctx = { state }, questions: PanelQuestion[] = [];
  if (goalPace(pot, state)) { const pace = goalPaceView({ potId: pot.id }, ctx) as ViewResult<"goal_line">; questions.push({ key: "pace", label: "Its pace", heading: "Its pace", result: pace, figure: <GoalLine key="pace" result={pace} /> }); }
  if (pot.fillPct !== undefined) { const tax = taxAheadView({ potId: pot.id }, ctx) as ViewResult<"step_line">; questions.push({ key: "tax", label: "Tax ahead", heading: "Tax ahead", result: tax, figure: <StepLine key="tax" result={tax} /> }); }
  if (questions.length === 0) return null;
  const places = await withHousehold(db(), hid, tx => readPlaces(tx, hid), { isolationLevel: "repeatable read", accessMode: "read only" });
  return <ViewPanel id={`pot-${pot.id}`} questions={questions} switchLabel="Look at" device={places.canvases === "device" ? { householdId: hid } : undefined} />;
}

function PotPanel({ state, pot }: { state: MoneyState; pot: Pot }) {
  const money = (n: number) => majorMoney(n, state.homeCurrency);
  const line = potLine(pot, state);
  const back = `/saving/${pot.id}`;
  return <Detail title={pot.name} close="/saving">
    <p className="directory-big">{money(pot.saved)}</p><p className="ui-hint">Saved</p>
    {line && <p className="saving-line">{line}</p>}
    <PotViews state={state} pot={pot} />
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

/** Saving → What you keep (D77): where each payment went, what was kept each month and how long the cash lasts, drawn from the keep views. */
async function WhatYouKeep({ state }: { state: MoneyState }) {
  const hid = await currentHouseholdId();
  if (!hid) return null;
  const [ctx, places] = await Promise.all([
    loadViewContext(db(), hid, ["spending", "income", "potFills"], { state }),
    withHousehold(db(), hid, tx => readPlaces(tx, hid), { isolationLevel: "repeatable read", accessMode: "read only" }),
  ]);
  const heading = "What you keep";
  const flow = moneyFlowView({}, ctx) as ViewResult<"sankey">, kept = savingsRateView({}, ctx) as ViewResult<"stacked_columns">, lasts = bufferMonthsView({}, ctx) as ViewResult<"runway_bar">;
  const questions: PanelQuestion[] = [
    { key: "flow", label: "Where each payment went", heading, result: flow, figure: <Sankey key="flow" result={flow} /> },
    { key: "kept", label: "What you kept", heading, result: kept, figure: <StackedColumns key="kept" result={kept} /> },
    { key: "lasts", label: "How long it lasts", heading, result: lasts, figure: <RunwayBar key="lasts" result={lasts} /> },
  ];
  return <ViewPanel id="keep" questions={questions} switchLabel="Look at" device={places.canvases === "device" ? { householdId: hid } : undefined} />;
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
    <WhatYouKeep state={state} />
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
