import type { ReactNode } from "react";
import { AccountFrame } from "@/components/auth/AccountFrame";
import { AddClientForm } from "@/components/household/AddClientForm";
import { CardFields } from "@/components/settings/CardFields";
import { ApiForm } from "@/components/ui/ApiForm";
import { loadWorkspace } from "@/components/shell/WorkspaceFrame";
import { db } from "@/db/client";
import { withHousehold } from "@/db/household";
import { loadSettings } from "@/db/settings";
import { Currency } from "@/lib/catalogue/types";
import { formatter, minorMoney, repeatWords } from "@/lib/money/format";
import { SetupBank } from "./SetupBank";
import { SetupBills } from "./SetupBills";
import { SetupNav } from "./SetupNav";
import { STEPS, STEP_WORDS, stepPath, type Step } from "./steps";
import "./setup.css";

/** One question per page (/setup?step=bank|income|bills|card): the heading is the question, a sentence says why, the form saves and keeps the person here, Back, Skip and Next move on. */
export async function SetupSteps({ householdId, step }: { householdId: string; step: Step }) {
  const [workspace, settings] = await Promise.all([loadWorkspace(householdId, false, true), withHousehold(db(), householdId, tx => loadSettings(tx, householdId))]);
  const { state, people, own } = workspace;
  const index = STEPS.indexOf(step);
  const last = index === STEPS.length - 1;
  const next = last ? "/" : stepPath(STEPS[index + 1]);
  const { question, why } = STEP_WORDS[step];
  const money = formatter(state.homeCurrency);
  const home = Currency.parse(settings.household.currency);
  let body: ReactNode;
  if (step === "bank") {
    body = <>
      <SetupBank currency={state.homeCurrency} balanceId={crypto.randomUUID()} />
      {state.bank !== 0 && <p className="setup-saved" role="status">Saved: your bank balance is <b>{money(state.bank)}</b>.</p>}
    </>;
  } else if (step === "income") {
    body = <>
      {state.clients.length > 0 && <ul className="setup-list" aria-label="Clients so far">{state.clients.map(client => <li key={client.id}><b>{client.name}</b><span>pays in {client.termsDays} days</span></li>)}</ul>}
      <h2 className="setup-sub">{state.clients.length > 0 ? "Add another" : "Add a client"}</h2>
      <AddClientForm key={state.clients.length} id={crypto.randomUUID()} returnTo={stepPath("income")} />
    </>;
  } else if (step === "bills") {
    const billId = crypto.randomUUID();
    const saved = settings.bills.filter(bill => bill.status === "confirmed");
    body = <>
      {saved.length > 0 && <ul className="setup-list" aria-label="Bills so far">{saved.map(bill => <li key={bill.id}><b>{bill.biller}</b>
        <span>{bill.amountMinor === null ? "amount not known yet" : minorMoney(bill.amountMinor, Currency.parse(bill.currency))}{bill.repeatUnit ? ` · ${repeatWords(bill.repeatUnit === "year" ? "year" : "month", bill.repeatDay ?? undefined)}` : ""}</span></li>)}</ul>}
      <p className="ui-hint">Tap one to add it. You do not have to add any.</p>
      <SetupBills key={billId} id={billId} today={settings.today} currency={home} people={people} own={own} />
    </>;
  } else {
    body = <>
      {settings.cards.length > 0 && <ul className="setup-list" aria-label="Cards so far">{settings.cards.map(card => <li key={card.id}><b>{card.label}</b><span>closes on the {card.closingDay}, paid on the {card.dueDay}</span></li>)}</ul>}
      <p className="ui-hint">A card is optional. Skip this if you do not use one.</p>
      <ApiForm><CardFields key={settings.cards.length} returnTo={stepPath("card")} data={{ people, household: { currency: home } }} /></ApiForm>
    </>;
  }
  return <AccountFrame title={question}>
    <div className="setup-progress">
      <p className="ui-hint" data-testid="setup-progress">Step {index + 1} of {STEPS.length}</p>
      <div className="setup-bar" role="progressbar" aria-valuemin={1} aria-valuemax={STEPS.length} aria-valuenow={index + 1} aria-label={`Step ${index + 1} of ${STEPS.length}`}><span style={{ width: `${((index + 1) / STEPS.length) * 100}%` }} /></div>
    </div>
    <p className="setup-why">{why}</p>
    {body}
    <SetupNav back={index > 0 ? stepPath(STEPS[index - 1]) : null} next={next} last={last} />
  </AccountFrame>;
}
