// Where you stand (D77): the money you hold, less what the cards will take, plus what clients owe, as a waterfall. Worked out on the server.
import { engineFact, type Fact } from "@/lib/money/facts";
import { minorMoney } from "@/lib/money/format";
import { positionSteps } from "@/lib/money/position";
import { VIEW_META } from "../catalogue";
import type { Resolver, TableTwin, ViewResult } from "../types";

export const positionView: Resolver<"position"> = (args, ctx): ViewResult => {
  const { state } = ctx, currency = state.homeCurrency, format = (minor: number) => minorMoney(minor, currency), meta = VIEW_META.position;
  const base = { view: "position" as const, args: { ...args }, form: "waterfall" as const, title: "Where you stand", question: meta.question, hint: meta.hint, home: meta.home, currency, strip: null, source: "From your balances, card statements and the invoices you have sent." };
  const steps = positionSteps(state);
  if (steps.length === 0) return { ...base, data: null, table: null, line: null, aria: "Nothing to show yet.", facts: [], empty: { words: "Nothing to show yet. Add a bill or a client and where you stand shows here.", add: "bill", addLabel: "Add a bill" } };

  const at = (key: string) => steps.find(step => step.key === key)?.minor ?? 0;
  const cardsOwed = -steps.filter(step => step.key.startsWith("card-")).reduce((sum, step) => sum + step.minor, 0);
  const cash = at("cash"), clients = at("clients"), net = at("net");
  const table: TableTwin = {
    caption: "Where you stand", head: ["", "Amount"], foot: null,
    rows: steps.map(step => ({ key: step.key, cells: [step.label + (step.about ? " (about)" : ""), step.amountLabel], ...(step.kind === "total" || step.kind === "subtotal" ? {} : step.minor < 0 ? { tone: "muted" as const } : {}) })),
  };
  // The facts first (D79); the line reads its amounts back from them. Position has no case: every figure is a balance today.
  const from = "position", money = { from, currency };
  const facts: Fact[] = [engineFact("cash_to_spend", cash, money)];
  if (at("pots") !== 0) facts.push(engineFact("pot", Math.abs(at("pots")), money));
  for (const step of steps.filter(step => step.key.startsWith("card-"))) facts.push(engineFact("card_owes", -step.minor, { ...money, about: { type: "card", id: step.key.slice(5), name: step.label.replace(/ owed$/, "") } }));
  if (cardsOwed > 0) facts.push(engineFact("cards_owe", cardsOwed, money));
  if (clients > 0) facts.push(engineFact("clients_owe", clients, money));
  facts.push(engineFact("what_you_have", net, money));
  const amount = (name: "cash_to_spend" | "cards_owe" | "clients_owe" | "what_you_have") => Number(facts.find(item => item.name === name)!.value);
  const pieces = [`Cash to spend ${format(amount("cash_to_spend"))}`, ...(cardsOwed > 0 ? [`less ${format(amount("cards_owe"))} owed on cards`] : []), ...(clients > 0 ? [`plus about ${format(amount("clients_owe"))} from clients`] : [])];
  return {
    ...base, data: { steps }, table, empty: null, facts,
    line: `${pieces.join(", ")}: ${format(amount("what_you_have"))}${clients > 0 ? " if everything settles" : ""}.`,
    aria: `Where you stand, step by step: ${steps.map(step => `${step.label} ${step.amountLabel}`).join("; ")}.`,
  };
};
