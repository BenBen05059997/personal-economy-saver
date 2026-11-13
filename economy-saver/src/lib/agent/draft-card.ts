// The card under a draft in Ask (D60, D61). Pure: the rows a turn left behind, the money state and the engine's what_changed in; the words out.
// Every word and number is written here from the rows and the engine, never by the model (D40). The state of a draft is read from the rows now:
// still pending = waiting for the person's OK, confirmed = confirmed, gone = not added.
import { categoryLabel } from "@/lib/money/categories";
import { dayLabel, minorMoney, minorPerUnit } from "@/lib/money/format";
import { goalPace } from "@/lib/money/goals";
import { allocate } from "@/lib/money/split";
import type { SpendingInput } from "@/lib/money/spending";
import type { Charge, MoneyState, Pot, StoredBill } from "@/lib/money/types";
import { resolveView } from "@/lib/views/resolve";
import { ViewError, type ViewResult } from "@/lib/views/types";
import type { DraftKind, DraftView } from "./view";

/** A draft the turn made, from its to_check event: which row, and the words the event gave it (all that is left of a row that was removed). */
export type DraftRow = { kind: DraftKind; id: string; eventTitle: string };
/** A bank balance update row. The data keeps only the new balance, never the one it replaced, so a saved balance has no before to compare. */
export type BalanceRow = { amountMinor: number; status: "pending" | "confirmed" };

const KIND_LABEL: Record<DraftKind, string> = { bill: "Bill", charge: "Card charge", pot: "Pot", balance: "Bank balance" };
const EVENT_SUFFIX = / (bill|charge|pot) to check$/;

/** "Sat Nov 14". */
export function dayWithWeekday(iso: string): string {
  const day = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return `${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][day]} ${dayLabel(iso)}`;
}

type Context = { state: MoneyState; spending: SpendingInput };

/** The card names what moves: the lowest-day row stays only when the item moves it. */
function tidy(result: ViewResult): ViewResult {
  const data = result.data as { rows: { key: string; change: string | null }[] } | null;
  if (!data || data.rows.some(row => row.key === "low" && row.change !== null)) return result;
  return { ...result, data: { ...data, rows: data.rows.filter(row => row.key !== "low") } as never, table: result.table && { ...result.table, rows: result.table.rows.filter(row => row.key !== "low") } };
}

function whatChangedOf(ctx: Context, itemId: string): ViewResult | null {
  try { return tidy(resolveView("what_changed", { itemId }, ctx)); }
  catch (error) { if (error instanceof ViewError) return null; throw error; }
}

type Built = Omit<DraftView, "id" | "kind" | "state" | "kindLabel" | "result" | "title"> & { label: string; name: string };

const members = (state: MoneyState) => state.split.members;
const whole = (state: MoneyState, value: number) => Math.round(value * minorPerUnit(state.homeCurrency));
const fieldIf = (label: string, value: string | null | undefined) => value ? [{ label, value }] : [];

function billWords(bill: StoredBill, state: MoneyState) {
  const money = (value: number | null) => value === null ? null : minorMoney(whole(state, value), state.homeCurrency);
  const amount = money(bill.amount);
  const names = members(state), many = names.length >= 2;
  const owner = bill.ownerId ? names.find(member => member.id === bill.ownerId)?.name : undefined;
  const payer = bill.paidBy ? names.find(member => member.id === bill.paidBy)?.name : undefined;
  const whose = !many ? null : owner ? `${owner}’s` : bill.paidBy ? (payer ? `Shared, ${payer} pays` : "Shared") : null;
  const repeat = bill.repeatUnit === "month" ? "Every month" : bill.repeatUnit === "year" ? "Every year" : bill.repeatUnit ? `Every ${bill.repeatUnit}` : null;
  const name = amount ? `${bill.biller} ${amount}` : bill.biller;
  const due = bill.due === null ? null : dayWithWeekday(bill.due);
  return {
    name, label: name, day: due,
    fields: [
      { label: "Item", value: amount ? `${bill.biller} · ${amount}` : `${bill.biller} · amount not known yet` },
      { label: "Due", value: due ?? "Date not known yet" },
      ...fieldIf("Repeats", repeat), ...fieldIf("Category", categoryLabel(bill.category)), ...fieldIf("Whose", whose),
    ],
    summary: [amount ? `${bill.biller} · ${amount}` : bill.biller, ...(bill.due === null ? [] : [`due ${dayLabel(bill.due)}`]), ...(repeat ? [repeat.toLowerCase()] : []), categoryLabel(bill.category), ...(whose ? [whose] : [])].join(" · "),
  };
}

function chargeWords(charge: Charge, state: MoneyState) {
  const per = minorPerUnit(state.homeCurrency), minor = Math.round(charge.amount * per);
  const amount = minorMoney(minor, state.homeCurrency);
  const card = state.cards.find(item => item.id === charge.cardId);
  const names = members(state);
  const shared = charge.shared === true && card?.ownerId !== undefined && names.length >= 2;
  const parts = shared ? allocate(minor, names.map(member => member.shareBp)) : [];
  const split = shared ? names.map((member, index) => `${member.name} ${minorMoney(parts[index], state.homeCurrency)}`).join(", ") : null;
  const name = `${charge.merchant} ${amount}`;
  return {
    name, label: `${name}${card ? ` on ${card.label}` : ""}`, day: dayWithWeekday(charge.date),
    fields: [
      { label: "Item", value: `${charge.merchant} · ${amount}` }, ...fieldIf("Card", card?.label), { label: "Date", value: dayWithWeekday(charge.date) },
      { label: "Category", value: categoryLabel(charge.category) }, ...fieldIf("Shared", split),
    ],
    summary: [`${charge.merchant} · ${amount}`, ...(card ? [card.label] : []), categoryLabel(charge.category), ...(split ? [`Shared: ${split}`] : [])].join(" · "),
  };
}

function potWords(pot: Pot, state: MoneyState) {
  const money = (value: number) => minorMoney(whole(state, value), state.homeCurrency);
  const target = pot.target === undefined ? null : `${money(pot.target)}${pot.targetDate ? ` by ${dayLabel(pot.targetDate)}` : ""}`;
  const fill = pot.fillPct === undefined || pot.fillPct <= 0 ? null : `${pot.fillPct}% of each client payment`;
  return {
    name: pot.name, label: `Pot “${pot.name}”`, day: null as string | null,
    fields: [{ label: "Pot", value: pot.name }, ...fieldIf("Target", target), ...fieldIf("Fills from", fill),
      ...fieldIf("To get there", ((pace) => pace && pace.neededMinor > 0 && pace.targetDate > state.today ? `${minorMoney(pace.monthlyNeededMinor, state.homeCurrency)} a month` : null)(goalPace(pot, state)))],
    summary: [pot.name, ...(target ? [target] : []), ...(fill ? [fill] : [])].join(" · "),
  };
}

function balanceWords(amountMinor: number, state: MoneyState) {
  const money = (minor: number) => minorMoney(minor, state.homeCurrency);
  return {
    name: `Bank balance ${money(amountMinor)}`, label: `Bank balance ${money(amountMinor)}`, day: null as string | null,
    fields: [{ label: "New balance", value: money(amountMinor) }, { label: "Now", value: money(whole(state, state.bank)) }],
    summary: `Bank balance ${money(amountMinor)}`,
  };
}

/** Where each kind is seen and edited; a bill's series or a charge's card are the pages the rest of the app uses for the same items (D61). */
function placesOf(kind: DraftKind, id: string, charge: Charge | undefined, state: MoneyState, shared: boolean, card: string | undefined): { places: DraftView["places"]; edit: string } {
  const sharedHome = shared ? [{ label: "Shared costs on Home ›", href: "/" }] : [];
  if (kind === "bill") return { places: [{ label: "See the bill ›", href: `/bills#bill-${id}` }, ...sharedHome], edit: `/bills#bill-${id}` };
  if (kind === "charge" && charge) return { places: [{ label: `See ${card ?? "the card"} ›`, href: `/cards/${charge.cardId}#charge-${id}` }, ...sharedHome], edit: `/cards/${charge.cardId}#charge-${id}` };
  if (kind === "pot") return { places: [{ label: "See Saving ›", href: "/saving" }], edit: "/saving" };
  return { places: [{ label: "See Home ›", href: "/" }], edit: "/#bank-balance" };
}

/**
 * The drafts a turn made, in the order they were made. `balances` holds the balance update rows by id (the state keeps only the pending ones).
 * A row that no longer exists is "not added": it was removed before it counted.
 */
export function draftViews(rows: readonly DraftRow[], ctx: Context, balances: ReadonlyMap<string, BalanceRow>, olderCharges: ReadonlyMap<string, "pending" | "confirmed"> = new Map()): DraftView[] {
  const { state } = ctx;
  return rows.map((row): DraftView => {
    const base = { id: row.id, kind: row.kind, kindLabel: KIND_LABEL[row.kind] };
    const removed = (): DraftView => ({
      ...base, state: "not_added", name: row.eventTitle.replace(EVENT_SUFFIX, "").replace(/ update to check$/, ""), fields: [], saved: null, result: null,
      title: "", places: [], edit: null, remove: null, removeKind: null,
    });
    let built: Built | null = null, itemState: DraftView["state"] = "not_added", day: string | null = null, summary = "";
    let result: ViewResult | null = null, linkSource: { charge?: Charge; shared: boolean; card?: string } = { shared: false };
    if (row.kind === "bill") {
      const bill = state.storedBills.find(item => item.id === row.id);
      if (!bill) return removed();
      const words = billWords(bill, state);
      itemState = bill.status === "pending" ? "waiting" : "confirmed"; day = words.day; summary = words.summary;
      built = { ...words, saved: null, places: [], edit: null, remove: null, removeKind: null };
      result = whatChangedOf(ctx, row.id);
      linkSource = { shared: bill.ownerId === undefined && bill.paidBy !== undefined && members(state).length >= 2 };
    } else if (row.kind === "charge") {
      const charge = state.charges.find(item => item.id === row.id);
      const older = olderCharges.get(row.id);
      // A charge dated before the state's window is not in it, but its row is: it is still there, so it was not removed.
      if (!charge && older) return { ...removed(), state: older === "pending" ? "waiting" : "confirmed", places: [{ label: "See Cards \u203a", href: "/cards" }], saved: older === "confirmed" ? { day: null, line: row.eventTitle.replace(EVENT_SUFFIX, "") } : null };
      if (!charge) return removed();
      const words = chargeWords(charge, state), card = state.cards.find(item => item.id === charge.cardId);
      itemState = charge.status === "pending" ? "waiting" : "confirmed"; day = words.day; summary = words.summary;
      built = { ...words, saved: null, places: [], edit: null, remove: null, removeKind: null };
      result = whatChangedOf(ctx, row.id);
      linkSource = { charge, card: card?.label, shared: charge.shared === true && card?.ownerId !== undefined && members(state).length >= 2 };
    } else if (row.kind === "pot") {
      const waiting = state.pendingPots.find(item => item.id === row.id), pot = waiting ?? state.pots.find(item => item.id === row.id);
      if (!pot) return removed();
      const words = potWords(pot, state);
      itemState = waiting ? "waiting" : "confirmed"; summary = words.summary;
      built = { ...words, saved: null, places: [], edit: null, remove: null, removeKind: null };
      result = whatChangedOf(ctx, row.id);
    } else {
      const update = balances.get(row.id);
      if (!update) return removed();
      const words = balanceWords(update.amountMinor, state);
      itemState = update.status === "pending" ? "waiting" : "confirmed"; summary = words.summary;
      built = { ...words, saved: null, places: [], edit: null, remove: null, removeKind: null };
      // A confirmed balance has no before: only the new balance is kept, so its card shows Saved and the new balance.
      if (update.status === "pending") result = whatChangedOf(ctx, row.id);
    }
    const title = `What changed: ${built.label}`;
    const { places, edit } = placesOf(row.kind, row.id, linkSource.charge, state, linkSource.shared, linkSource.card);
    return {
      ...base, state: itemState, name: built.name, fields: built.fields,
      saved: itemState === "confirmed" ? { day, line: summary } : null,
      result: result && itemState === "confirmed" ? { ...result, title } : result,
      title, places, edit,
      remove: row.kind === "bill" || row.kind === "charge" ? "/api/remove" : row.kind === "pot" ? "/api/pots/remove" : null,
      removeKind: row.kind === "bill" || row.kind === "charge" ? row.kind : null,
    };
  });
}

/** The chip on the agent's reply, from every draft the turn made: waiting while any waits, else confirmed if any was, else not added. Null when the turn drafted nothing. */
export function chipOf(drafts: readonly Pick<DraftView, "state">[]): DraftView["state"] | null {
  if (drafts.length === 0) return null;
  if (drafts.some(draft => draft.state === "waiting")) return "waiting";
  return drafts.some(draft => draft.state === "confirmed") ? "confirmed" : "not_added";
}

export const CHIP_WORDS: Record<DraftView["state"], string> = { waiting: "Waiting for your OK", confirmed: "Confirmed", not_added: "Not added" };
