import Link from "next/link";
import { notFound } from "next/navigation";
import type { MoneyState, Pot } from "@/lib/money/types";
import { dayLabel, majorMoney, minorMoney } from "@/lib/money/format";
import { goalPace } from "@/lib/money/goals";
import { storedId } from "@/lib/money/name-key";
import { addDays } from "@/lib/money/dates";
import { foundWins, isTaxPot, matchCandidates, monthWins, type FoundWin } from "@/lib/money/saving";
import { foundPot, purchaseRef } from "@/lib/money/suggest";
import { monthBounds, monthName, monthsBack, spendingItems } from "@/lib/money/spending";
import { monthYear, moneyInPotsLine, potLine, roomLine, roomNote } from "@/lib/money/plan";
import { ApiForm } from "@/components/ui/ApiForm";
import { ConfirmDo } from "@/components/ui/ConfirmRemove";
import { PanelHint } from "@/components/ui/PanelHint";
import { Detail, ListPage } from "@/components/household/ListPage";
import { Sankey } from "@/components/views/forms/Sankey";
import { RunwayBar } from "@/components/views/forms/RunwayBar";
import { StackedColumns } from "@/components/views/forms/StackedColumns";
import { GoalLine } from "@/components/views/forms/GoalLine";
import { AmountInput } from "@/components/ui/CheckedInput";
import { StepLine } from "@/components/views/forms/StepLine";
import { ViewPanel, type PanelQuestion } from "@/components/views/ViewPanel";
import { db } from "@/db/client";
import { withHousehold } from "@/db/household";
import { readPlaces } from "@/db/place";
import { currentHouseholdId } from "@/lib/session";
import { loadViewContext } from "@/lib/views/load";
import { goalPaceView } from "@/lib/views/v/goal-pace";
import { taxAheadView } from "@/lib/views/v/tax-ahead";
import { potStoryView } from "@/lib/views/v/pot-story";
import { winsView } from "@/lib/views/v/wins";
import { bufferMonthsView, moneyFlowView, savingsRateView } from "@/lib/views/v/keep";
import type { ViewResult } from "@/lib/views/types";
import { PotFields } from "./PotFields";
import "@/components/household/household.css";
import "./saving.css";

/** A pot's own panel (D77): only the questions that apply to it, its pace when it has a target and a date (a done pot has none), the tax ahead when it is the tax pot and its story when it has a move; the switch only when several do (D73). */
async function PotViews({ state, pot, hasMove }: { state: MoneyState; pot: Pot; hasMove: boolean }) {
  const hid = await currentHouseholdId();
  if (!hid) return null;
  const questions: PanelQuestion[] = [];
  const ctx = hasMove ? await loadViewContext(db(), hid, ["moves", "choices"], { state }) : { state };
  if (pot.doneOn === undefined && goalPace(pot, state)) { const pace = goalPaceView({ potId: pot.id }, ctx) as ViewResult<"goal_line">; questions.push({ key: "pace", label: "Its pace", heading: "Its pace", result: pace, figure: <GoalLine key="pace" result={pace} /> }); }
  if (isTaxPot(pot)) { const tax = taxAheadView({ potId: pot.id }, ctx) as ViewResult<"step_line">; questions.push({ key: "tax", label: "Tax ahead", heading: "Tax ahead", result: tax, figure: <StepLine key="tax" result={tax} /> }); }
  if (hasMove) { const story = potStoryView({ potId: pot.id }, ctx) as ViewResult<"sankey">; questions.push({ key: "story", label: "Its story", heading: "Its story", result: story, figure: <Sankey key="story" result={story} /> }); }
  if (questions.length === 0) return null;
  const places = await withHousehold(db(), hid, tx => readPlaces(tx, hid), { isolationLevel: "repeatable read", accessMode: "read only" });
  return <ViewPanel id={`pot-${pot.id}`} questions={questions} switchLabel="Look at" device={places.canvases === "device" ? { householdId: hid } : undefined} />;
}

/** The pot's small forms (D81), each posting to /api/pots/move. The tax pot is never paid out for a purchase or moved to another pot; a done pot takes no more money and is not marked done again. */
function MoveForms({ state, pot, purchases }: { state: MoneyState; pot: Pot; purchases: { value: string; label: string }[] }) {
  const currency = state.homeCurrency, back = `/saving/${pot.id}`, tax = isTaxPot(pot), done = pot.doneOn !== undefined;
  const others = state.pots.filter(row => row.id !== pot.id && row.doneOn === undefined && !isTaxPot(row));
  const hidden = (kind: string) => <><input type="hidden" name="kind" value={kind} /><input type="hidden" name="potId" value={pot.id} /><input type="hidden" name="returnTo" value={back} /></>;
  const amount = (required: boolean, label = "Amount") => <label className="ui-field">{label} ({currency})<AmountInput name="amount" currency={currency} required={required} /></label>;
  return <div className="saving-moves">
    {!done && <ApiForm action="/api/pots/move" className="saving-move">
      {hidden("put_in")}<h4>Put in</h4>{amount(true)}
      <button className="ui-button">Put in</button>
    </ApiForm>}
    <ApiForm action="/api/pots/move" className="saving-move">
      {hidden("take_out")}<h4>Take out</h4>{amount(true)}
      <button className="ui-button">Take out</button>
    </ApiForm>
    {!tax && <ApiForm action="/api/pots/move" className="saving-move">
      {hidden("paid_for")}<h4>Paid from this pot</h4>
      <label className="ui-field">Purchase from the last 60 days<select name="purchase" defaultValue="">
        <option value="">Not one of these</option>
        {purchases.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
      </select></label>
      {amount(false, "Amount, or leave empty for the whole purchase")}
      {!done && <label className="ui-check"><input type="checkbox" name="done" /> This was the goal: mark {pot.name} done</label>}
      <button className="ui-button">Paid from {pot.name}</button>
    </ApiForm>}
    {!tax && others.length > 0 && <ApiForm action="/api/pots/move" className="saving-move">
      {hidden("move_to")}<h4>Move to another pot</h4>
      <label className="ui-field">To<select name="toPotId" required defaultValue="">
        <option value="" disabled>Choose a pot</option>
        {others.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}
      </select></label>
      {amount(true)}
      <button className="ui-button">Move it</button>
    </ApiForm>}
    {!done && <ApiForm action="/api/pots/move" className="saving-move">
      {hidden("done")}<h4>Done</h4>
      <p className="ui-hint">{tax ? "Mark this pot done when you have no more tax bills to keep it for." : "Mark the goal done when you have reached it. The pot is kept and takes no more money."}</p>
      <button className="ui-button">Mark {pot.name} done</button>
    </ApiForm>}
  </div>;
}

async function PotPanel({ state, pot }: { state: MoneyState; pot: Pot }) {
  const hid = await currentHouseholdId();
  if (!hid) return null;
  const money = (n: number) => majorMoney(n, state.homeCurrency);
  const line = potLine(pot, state);
  const back = `/saving/${pot.id}`;
  const ctx = await loadViewContext(db(), hid, ["spending", "moves"], { state });
  const own = (ctx.moves ?? []).filter(move => move.potId === pot.id);
  const hasMove = own.length > 0, hasStory = own.some(move => move.kind !== "adjust") || own.length > 1;
  const items = ctx.spending ? spendingItems(ctx.spending, addDays(state.today, -60), state.today) : [];
  const purchases = items.filter(item => item.kind === "charge" || item.repeat === null).filter(item => !item.uncounted && !item.estimated && item.amountMinor > 0).sort((a, b) => a.date < b.date ? 1 : a.date > b.date ? -1 : 0)
    .map(item => ({ value: item.kind === "charge" ? `charge:${item.id}` : `bill:${storedId(item.id)}|${item.date}`, label: `${item.label} · ${minorMoney(item.amountMinor, state.homeCurrency)} · ${item.date}` }));
  return <Detail title={pot.name} close="/saving">
    <p className="directory-big">{money(pot.saved)}</p><p className="ui-hint">{isTaxPot(pot) ? "Ready for tax" : pot.doneOn !== undefined ? "Still in it" : "Saved"}</p>
    {line && <p className="saving-line">{line}</p>}
    <PotViews state={state} pot={pot} hasMove={hasMove} />
    <details className="directory-edit" open>
      <summary>Edit</summary>
      <ApiForm action="/api/pots">
        <input type="hidden" name="id" value={pot.id} />
        <input type="hidden" name="name" value={pot.name} />
        <input type="hidden" name="returnTo" value={back} />
        <PotFields currency={state.homeCurrency} pot={pot} />
        <button className="ui-button primary">Save changes</button>
      </ApiForm>
      <MoveForms state={state} pot={pot} purchases={purchases} />
    </details>
    <ConfirmDo summary="Remove" summaryLabel={`Remove ${pot.name}`} action="/api/pots/remove" fields={{ id: pot.id, returnTo: "/saving" }}
      question={<><p>Remove {pot.name}? {money(pot.saved)} becomes cash you can spend again.</p>{hasStory && <p>Its story and any goal medal it earned go with it. To finish a goal, use Done instead.</p>}</>} button={`Yes, remove ${pot.name}`} />
  </Detail>;
}

/** Saving → What you keep (D77): where each payment went, what was kept each month and how long the cash lasts, drawn from the keep views. */
async function WhatYouKeep({ state }: { state: MoneyState }) {
  const hid = await currentHouseholdId();
  if (!hid) return null;
  const [ctx, places] = await Promise.all([
    loadViewContext(db(), hid, ["spending", "income", "moves"], { state }),
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

/** Saving → What our choices saved (D81): the wins view, each saving found in the records with Keep (and the pot to put it in), and each confirmed choice with Withdraw. */
async function Wins({ state, win }: { state: MoneyState; win?: string }) {
  const hid = await currentHouseholdId();
  if (!hid) return null;
  const [ctx, places] = await Promise.all([
    loadViewContext(db(), hid, ["spending", "moves", "choices"], { state }),
    withHousehold(db(), hid, tx => readPlaces(tx, hid), { isolationLevel: "repeatable read", accessMode: "read only" }),
  ]);
  const wins = winsView({}, ctx) as ViewResult<"stacked_columns">;
  const { today, homeCurrency: currency } = state, record = { moves: ctx.moves ?? [], choices: ctx.choices ?? [] };
  const items = ctx.spending ? spendingItems(ctx.spending, monthBounds(monthsBack(today.slice(0, 7), 12)).first, monthBounds(today.slice(0, 7)).last) : [];
  const months = [2, 3, 4].map(count => monthsBack(today.slice(0, 7), count));
  const fresh: FoundWin[] = months.flatMap(month => monthWins(record, foundWins(items, currency, month, record, today), month).fresh);
  const open = state.pots.filter(pot => pot.doneOn === undefined && !isTaxPot(pot));
  // ?win=<key> (from the finding on Home) marks that saving and chooses the pot Home named: the one the last kept saving went into, else the only pot.
  const chosen = foundPot(record, state.pots)?.id ?? "";
  const said = record.choices.filter(choice => choice.withdrawnOn === null).sort((a, b) => a.happenedOn < b.happenedOn ? 1 : a.happenedOn > b.happenedOn ? -1 : 0).slice(0, 12);
  const questions: PanelQuestion[] = [{ key: "wins", label: "What our choices saved", heading: "What our choices saved", result: wins, figure: <StackedColumns key="wins" result={wins} /> }];
  return <div id="wins" className="saving-wins">
    <ViewPanel id="wins" questions={questions} device={places.canvases === "device" ? { householdId: hid } : undefined} />
    {fresh.length > 0 && <section className="saving-win-list" aria-label="Savings found in your records">
      <h3>Found in your records</h3>
      {fresh.map(row => <ApiForm key={row.key} action="/api/wins" className={row.key === win ? "ui-row saving-win saving-win-opened" : "ui-row saving-win"}>
        <input type="hidden" name="kind" value="keep" /><input type="hidden" name="foundKey" value={row.key} /><input type="hidden" name="returnTo" value="/saving" />
        <div>{row.label}<small>{monthName(row.month)} · {minorMoney(row.winMinor, currency)} {row.kind === "under_usual" ? "under your usual" : row.kind === "cost_stopped" ? "from a cost that stopped" : "less than the month before"}</small></div>
        {open.length > 0 && <label className="ui-field">and put it in<select name="potId" defaultValue={row.key === win ? chosen : ""}><option value="">No pot</option>{open.map(pot => <option key={pot.id} value={pot.id}>{pot.name}</option>)}</select></label>}
        <button className="ui-button primary">Keep</button>
      </ApiForm>)}
    </section>}
    {said.length > 0 && <section className="saving-win-list" aria-label="Choices on your record">
      <h3>On your record</h3>
      {said.map(choice => <ApiForm key={choice.id} action="/api/wins" className="ui-row saving-win">
        <input type="hidden" name="kind" value="withdraw" /><input type="hidden" name="id" value={choice.id} /><input type="hidden" name="returnTo" value="/saving" />
        <div>{choice.words}<small>{choice.happenedOn} · {minorMoney(choice.minor, currency)}</small></div>
        <button className="ui-button">Withdraw</button>
      </ApiForm>)}
    </section>}
  </div>;
}

/** "Paid from a pot?" (D81): a purchase of the last two weeks that a pot in its category could have paid for, with a button for each such pot. Reached from the finding on Home by `?paid=<purchase>`. */
async function PaidFrom({ state, paid }: { state: MoneyState; paid: string }) {
  const hid = await currentHouseholdId();
  if (!hid) return null;
  const ctx = await loadViewContext(db(), hid, ["spending", "moves"], { state });
  const { today, homeCurrency: currency } = state, record = { moves: ctx.moves ?? [], choices: [] };
  const items = ctx.spending ? spendingItems(ctx.spending, monthBounds(monthsBack(today.slice(0, 7), 12)).first, monthBounds(today.slice(0, 7)).last) : [];
  const match = matchCandidates(state, record, items).find(row => purchaseRef(row.purchase) === paid);
  if (!match) return <section className="saving-win-list" aria-label="Paid from a pot"><h3 id="paid-from">Paid from a pot?</h3><p className="ui-hint">That purchase isn’t waiting on an answer any more.</p></section>;
  const { purchase } = match;
  return <section className="saving-win-list" aria-label="Paid from a pot">
    <h3 id="paid-from">Paid from a pot?</h3>
    <p className="ui-hint">{purchase.label} · {minorMoney(purchase.amountMinor, currency)} · {purchase.date}. If a pot paid for it, say which and it counts as spent from that pot.</p>
    {match.pots.map(pot => <ApiForm key={pot.id} action="/api/pots/move" className="ui-row saving-win">
      <input type="hidden" name="kind" value="paid_for" /><input type="hidden" name="potId" value={pot.id} /><input type="hidden" name="purchase" value={paid} /><input type="hidden" name="returnTo" value="/saving" />
      <div>{pot.name}<small>{majorMoney(pot.saved, currency)} saved</small></div>
      <button className="ui-button primary">Paid from {pot.name}</button>
    </ApiForm>)}
  </section>;
}

export function SavingView({ state, selected, win, paid }: { state: MoneyState; selected?: string; win?: string; paid?: string }) {
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
    {paid && <PaidFrom state={state} paid={paid} />}
    {state.pots.map(item => {
      const goal = goalPace(item, state);
      return <Link key={item.id} prefetch={false} className="ui-row directory-link" href={`/saving/${item.id}`} aria-label={item.name} aria-current={item.id === selected ? "page" : undefined}>
        <div>{item.name}
          <small>
            {item.doneOn !== undefined ? `${(item.became ?? 0) > 0 ? "Bought" : "Done"} on ${dayLabel(item.doneOn)}`
              : isTaxPot(item) ? "Ready for tax" : item.target === undefined ? "Set aside" : `Target ${money(item.target)}${item.targetDate ? ` · by ${monthYear(item.targetDate)}` : ""}`}
            {item.fillPct !== undefined && item.doneOn === undefined && ` · ${item.fillPct}% of each client payment`}
          </small>
          {goal && goal.neededMinor > 0 && <small>{goal.paceLine}</small>}</div>
        <div>{money(item.saved)}<small>{isTaxPot(item) ? "ready for tax" : item.doneOn !== undefined ? "still in it" : "saved"}</small></div>
      </Link>;
    })}
    {state.pots.length === 0 && <PanelHint className="directory-empty" add="pot" label="Add a pot">No pots yet. Put money aside for tax, a trip or a car. Money in a pot stops counting as safe to spend.</PanelHint>}
    <WhatYouKeep state={state} />
    <Wins state={state} win={win} />
  </ListPage>;
}
