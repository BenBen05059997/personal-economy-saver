// Who owes whom (D45, D77): each person's payments of shared bills and charges since the last settlement, as a bar, against their fair share as the tick. Pure; integer minor units.
import { minorMoney } from "@/lib/money/format";
import { splitBalance, splitSummary } from "@/lib/money/split";
import { VIEW_META } from "../catalogue";
import type { FormData, RankedRow, Resolver, ViewResult } from "../types";

export const whoOwesWhomView: Resolver<"who_owes_whom"> = (args, ctx): ViewResult<"ranked_bars"> => {
  const { state } = ctx, { split } = state, currency = state.homeCurrency, format = (minor: number) => minorMoney(minor, currency);
  const meta = VIEW_META.who_owes_whom;
  const base = { view: "who_owes_whom" as const, args: { ...args }, form: "ranked_bars" as const, title: "Who owes whom", question: meta.question, hint: meta.hint, home: meta.home, currency, strip: null, data: null, table: null,
    source: "The household's shared bills and charges since the last settlement, split by each person's share." };
  if (split.members.length < 2) {
    return { ...base, line: null, aria: "Only one person is in this household.", figures: { people: split.members.length }, empty: { words: "Add a person in Household → People to split shared costs.", add: "person", addLabel: "Add a person" } };
  }
  const balance = splitBalance(split, state.today);
  if (balance.items === 0) {
    return { ...base, line: null, aria: "Nothing has been shared since the last settlement.", figures: { people: split.members.length, items: 0 },
      empty: { words: "Nothing has been shared since the split began or was last settled. Mark a bill or a card charge as shared and it shows here.", add: "bill", addLabel: "Add a bill" } };
  }
  const shareOf = new Map(split.members.map(member => [member.id, member.shareBp]));
  const rows: RankedRow[] = balance.members.map(member => {
    const net = member.netMinor, sub = net === 0 ? "is even" : net < 0 ? `owes ${format(-net)}` : `is owed ${format(net)}`;
    return {
      key: member.id, label: member.name, note: `${shareOf.get(member.id)! / 100}% share`, parts: [member.paidMinor], total: member.paidMinor, totalLabel: format(member.paidMinor),
      tick: member.shareMinor, tickLabel: format(member.shareMinor), sub,
      aria: `${member.name} paid ${format(member.paidMinor)} of the shared costs; the fair share is ${format(member.shareMinor)}, so ${member.name} ${sub}.`,
    };
  });
  const data: FormData["ranked_bars"] = { segments: [{ key: "paid", legend: "Paid", tone: "main" }], tick: { legend: "Fair share" }, rows };
  const line = splitSummary(split, balance, currency);
  const figures: ViewResult["figures"] = { people: balance.members.length, items: balance.items, owedMinor: balance.transfers.reduce((sum, t) => sum + t.amountMinor, 0) };
  balance.members.forEach((member, index) => { figures[`person${index + 1}PaidMinor`] = member.paidMinor; figures[`person${index + 1}ShareMinor`] = member.shareMinor; });
  balance.transfers.forEach((transfer, index) => { figures[`transfer${index + 1}Minor`] = transfer.amountMinor; });
  return {
    ...base, empty: null, data, line, figures,
    aria: `Who owes whom. ${line}`,
    table: {
      caption: "What each person paid of the shared costs, against their fair share", head: ["Person", "Paid", "Fair share", "Balance"],
      rows: balance.members.map(member => ({ key: member.id, cells: [member.name, format(member.paidMinor), format(member.shareMinor), member.netMinor === 0 ? "even" : member.netMinor < 0 ? `owes ${format(-member.netMinor)}` : `is owed ${format(member.netMinor)}`], ...(member.netMinor < 0 ? { tone: "short" as const } : {}) })),
      foot: ["Together", format(balance.members.reduce((sum, m) => sum + m.paidMinor, 0)), format(balance.members.reduce((sum, m) => sum + m.shareMinor, 0)), ""],
    },
  };
};
