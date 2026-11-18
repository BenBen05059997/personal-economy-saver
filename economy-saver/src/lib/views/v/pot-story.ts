// A pot's story (D81, D77): where its money came from and what it became. Pure; every amount integer minor units.
// The tax pot is ready for its bills, never called saved.
import { engineFact, type Fact } from "@/lib/money/facts";
import { dayLabel, minorMoney, toMinor } from "@/lib/money/format";
import { potStory, type PotStory } from "@/lib/money/saving";
import type { SavingRecord } from "@/lib/money/types";
import { VIEW_META } from "../catalogue";
import { ViewError, type Resolver, type Tone, type ViewResult } from "../types";

const EMPTY = "This pot's story starts with its first move.";
const dated = (iso: string, today: string) => iso.slice(0, 4) === today.slice(0, 4) ? dayLabel(iso) : `${dayLabel(iso)}, ${iso.slice(0, 4)}`;
const cap = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const list = (words: string[]) => words.length < 2 ? words.join("") : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;

/** The choices that put money into a pot, and, through a carry from a pot that ended empty, into the pots before it (each pot once). */
function choicesAlong(record: SavingRecord, potId: string, emptied: (potId: string) => boolean, seen = new Set<string>()): Set<string> {
  const ids = new Set<string>();
  if (seen.has(potId)) return ids;
  seen.add(potId);
  for (const move of record.moves) {
    if (move.potId !== potId) continue;
    if (move.kind === "add" && move.choiceId !== null) ids.add(move.choiceId);
    if (move.kind === "carry" && move.minor > 0) {
      const from = record.moves.find(other => other.pairId !== null && other.pairId === move.pairId && other.potId !== potId);
      if (from && emptied(from.potId)) for (const id of choicesAlong(record, from.potId, emptied, seen)) ids.add(id);
    }
  }
  return ids;
}

export const potStoryView: Resolver<"pot_story"> = (args, ctx): ViewResult => {
  const { state, moves, choices } = ctx;
  if (!moves) throw new ViewError("Pot moves are not loaded for this view.");
  if (!choices) throw new ViewError("Choices are not loaded for this view.");
  const pot = state.pots.find(row => row.id === args.potId);
  if (!pot) throw new ViewError("I couldn't find that pot.");
  const meta = VIEW_META.pot_story, currency = state.homeCurrency, today = state.today, format = (minor: number) => minorMoney(minor, currency);
  const record: SavingRecord = { moves, choices };
  const about = { type: "pot" as const, id: pot.id, name: pot.name };
  const base = { view: "pot_story" as const, args: args as Record<string, unknown>, form: meta.form as "sankey", title: `${pot.name}: its story`, question: meta.question, hint: meta.hint, currency, strip: null, source: "Everything that went into the pot and came out of it" };
  if (!moves.some(move => move.potId === pot.id)) return { ...base, data: null, table: null, line: null, aria: EMPTY, facts: [] as Fact[], empty: { words: EMPTY, add: null, addLabel: null } };

  const story: PotStory = potStory(record, pot, currency);
  const tax = story.tax, since = story.since!;
  const period = { from: since, to: today };
  const money = (name: "went_in" | "pot_start" | "pot_from_payments" | "pot_added" | "pot_from_choices" | "pot_carried_in" | "pot_carried_out" | "pot_became" | "pot_taken_out" | "pot", minor: number, also?: Fact["about"]) =>
    engineFact(name, minor, { from: "pot_story", currency, period, about: also ?? about });

  // Carries by pot; money whose other pot is gone is named as another pot.
  const byPot = (rows: PotStory["carriedFrom"]) => [...rows.reduce((map, row) => map.set(row.potId, { name: row.potName, minor: (map.get(row.potId)?.minor ?? 0) + row.minor }), new Map<string, { name: string; minor: number }>())];
  const carriedIn = byPot(story.carriedFrom), carriedOut = byPot(story.carriedTo);
  const strayIn = story.carriedInMinor - carriedIn.reduce((sum, [, row]) => sum + row.minor, 0), strayOut = story.carriedOutMinor - carriedOut.reduce((sum, [, row]) => sum + row.minor, 0);

  const facts: Fact[] = [money("went_in", story.wentInMinor), money("pot", story.savedMinor)];
  if (story.startMinor !== 0) facts.push(money("pot_start", story.startMinor));
  if (story.fromPaymentsMinor > 0) facts.push(money("pot_from_payments", story.fromPaymentsMinor));
  if (story.addedMinor > 0) facts.push(money("pot_added", story.addedMinor));
  if (story.fromChoicesMinor > 0) facts.push(money("pot_from_choices", story.fromChoicesMinor));
  if (story.carriedInMinor > 0) facts.push(money("pot_carried_in", story.carriedInMinor));
  for (const [id, row] of carriedIn) facts.push(money("pot_carried_in", row.minor, { type: "pot", id, name: row.name }));
  if (story.takenOutMinor > 0) facts.push(money("pot_taken_out", story.takenOutMinor));
  if (story.carriedOutMinor > 0) facts.push(money("pot_carried_out", story.carriedOutMinor));
  for (const [id, row] of carriedOut) facts.push(money("pot_carried_out", row.minor, { type: "pot", id, name: row.name }));
  const purchases = story.purchases.map((purchase, i) => ({ ...purchase, id: `out:became:${i}`, label: purchase.purchase?.label ?? "A removed purchase" }));
  for (const purchase of purchases) facts.push(money("pot_became", purchase.minor, purchase.purchase ? { type: purchase.purchase.kind, id: purchase.purchase.id, name: purchase.label } : { type: "charge", id: purchase.id, name: purchase.label }));
  // The choices behind the money: this pot's, and those of a pot whose money was carried here when it ended empty.
  const emptied = (potId: string) => { const from = state.pots.find(row => row.id === potId); return from !== undefined && toMinor(from.saved, currency) === 0; };
  const along = choicesAlong(record, pot.id, emptied), winCount = choices.filter(choice => along.has(choice.id) && choice.withdrawnOn === null).length;
  if (winCount > 0) facts.push(engineFact("win_count", winCount, { from: "pot_story", period, about }));

  // The sentence, from those facts.
  const day = dated(since, today);
  const parts = [
    ...(story.fromPaymentsMinor > 0 ? [{ minor: story.fromPaymentsMinor, words: "from client payments" }] : []),
    ...(story.addedMinor > 0 ? [{ minor: story.addedMinor, words: "put in by hand" }] : []),
    ...(story.fromChoicesMinor > 0 ? [{ minor: story.fromChoicesMinor, words: "from your choices" }] : []),
    ...(story.carriedInMinor > 0 ? [{ minor: story.carriedInMinor, words: carriedIn.length === 1 && strayIn === 0 ? `moved in from ${carriedIn[0][1].name}` : "moved in from another pot" }] : []),
  ];
  const head = story.wentInMinor === 0 ? (story.startMinor > 0 ? `${pot.name}: it started with ${format(story.startMinor)} on ${day}` : `${pot.name}: nothing has gone in since ${day}`)
    : parts.length === 1 ? `${pot.name}: ${format(story.wentInMinor)} went in since ${day}, all ${parts[0].words}`
    : `${pot.name}: ${format(story.wentInMinor)} went in since ${day}: ${list(parts.map(part => `${format(part.minor)} ${part.words}`))}`;
  const outs = [
    ...(purchases.length > 0 ? [`it became ${list(purchases.map(purchase => `${purchase.label} ${format(purchase.minor)}`))}`] : []),
    ...(story.takenOutMinor > 0 ? [`${format(story.takenOutMinor)} was taken out`] : []),
    ...(story.carriedOutMinor > 0 ? [`${format(story.carriedOutMinor)} moved to ${carriedOut.length === 1 && strayOut === 0 ? carriedOut[0][1].name : "another pot"}`] : []),
  ];
  const tail = story.savedMinor > 0 ? `${format(story.savedMinor)} ${tax ? "is ready for tax" : "is still in it"}` : tax ? "none of it is ready for tax" : "nothing is left in it";
  const line = `${head}. ${cap([...outs, tail].join("; "))}.`;

  // The picture: ways in on the left, the pot in the middle, what it became on the right.
  const left: { id: string; label: string; minor: number; tone: Tone }[] = [
    { id: "in:payments", label: "From client payments", minor: story.fromPaymentsMinor, tone: "soft" },
    { id: "in:added", label: "Put in by hand", minor: story.addedMinor, tone: "soft" },
    { id: "in:choices", label: "From your choices", minor: story.fromChoicesMinor, tone: "soft" },
    ...carriedIn.map(([id, row]) => ({ id: `in:carry:${id}`, label: `Moved in from ${row.name}`, minor: row.minor, tone: "quiet" as Tone })),
    { id: "in:carry", label: "Moved in from another pot", minor: strayIn, tone: "quiet" },
    { id: "in:start", label: "Start and corrections", minor: Math.max(0, story.startMinor), tone: "quiet" },
  ];
  const right: { id: string; label: string; minor: number; tone: Tone }[] = [
    ...purchases.map(purchase => ({ id: purchase.id, label: purchase.label, minor: purchase.minor, tone: "main" as Tone })),
    { id: "out:taken", label: "Taken out", minor: story.takenOutMinor, tone: "quiet" },
    ...carriedOut.map(([id, row]) => ({ id: `out:carry:${id}`, label: `Moved to ${row.name}`, minor: row.minor, tone: "quiet" as Tone })),
    { id: "out:carry", label: "Moved to another pot", minor: strayOut, tone: "quiet" },
    { id: "out:start", label: "Corrections", minor: Math.max(0, -story.startMinor), tone: "quiet" },
    { id: "out:kept", label: tax ? "Ready for tax" : "Still in it", minor: story.savedMinor, tone: "in" },
  ];
  const lefts = left.filter(node => node.minor > 0), rights = right.filter(node => node.minor > 0);
  const middle = lefts.reduce((sum, node) => sum + node.minor, 0);
  const nodes = [...lefts.map(node => ({ ...node, column: 0 as const })), { id: "pot", label: pot.name, column: 1 as const, minor: middle, tone: "main" as Tone }, ...rights.map(node => ({ ...node, column: 2 as const }))]
    .map(node => ({ ...node, amountLabel: format(node.minor) }));
  const links = [...lefts.map(node => ({ from: node.id, to: "pot", minor: node.minor })), ...rights.map(node => ({ from: "pot", to: node.id, minor: node.minor }))];
  const label = new Map(nodes.map(node => [node.id, node.label]));
  return {
    ...base, empty: null, facts, line, data: { nodes, links },
    table: { caption: `${pot.name}: its story`, head: ["From", "To", "Amount"], align: ["start", "end"], foot: ["Together", "", format(middle)],
      rows: links.map(link => ({ key: `${link.from}>${link.to}`, cells: [label.get(link.from)!, label.get(link.to)!, format(link.minor)] })) },
    aria: `${pot.name}: ${format(story.wentInMinor)} went in${story.savedMinor > 0 ? `, ${format(story.savedMinor)} ${tax ? "is ready for tax" : "is still in it"}` : ""}.`,
  };
};
