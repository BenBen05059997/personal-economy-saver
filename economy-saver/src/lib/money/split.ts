// Who owes whom (D45). Pure functions over a SplitState: no DB, no clock, no float money. Everything is an integer count of
// minor units of the home currency. The split moves no money in the runway; it only says who should pay whom back.
//
// What counts: each confirmed shared bill or charge dated after the last settlement (or dated that day but created after
// the settlement happened, so an item entered for today after settling today is not lost), on or before today and on or
// after the day the household got its second member. A monthly shared bill counts once per past occurrence (its first due date
// through today); the runway looks forward, so the past ones are counted here. The payer paid the whole amount and every
// member owes their share of it at the current shares.
//
// Rounding: each item's amount is cut by the shares with the largest-remainder rule (floor of each share, then the
// leftover units go one each to the largest fractional parts, ties to the earlier member, the owner first), so every item
// splits to exactly its amount and the transfers sum to the balances to the yen.

import type { Currency } from "@/lib/catalogue/types";
import { minorMoney } from "./format";
import { occurrenceDates } from "./repeat";
import type { SplitState } from "./types";

export const SHARE_TOTAL_BP = 10_000;

export type MemberBalance = { id: string; name: string; paidMinor: number; shareMinor: number; netMinor: number };
export type Transfer = { fromId: string; fromName: string; toId: string; toName: string; amountMinor: number };
export type SplitBalance = {
  members: MemberBalance[]; // in the split's member order; net = paid - share, so they sum to zero
  transfers: Transfer[]; // the fewest payments that bring everyone to zero, largest first
  items: number; // how many shared bills and charges are counted
  from: string | null; // the first day that counts; null while the household has one member
};

/** Splits `amountMinor` by the shares so the parts add up to it exactly (largest remainder, ties to the earlier member). */
export function allocate(amountMinor: number, shares: readonly number[]): number[] {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) throw new Error("A split amount must be a non-negative integer");
  if (shares.reduce((a, b) => a + b, 0) !== SHARE_TOTAL_BP) throw new Error("Shares must total 10,000 basis points");
  const amount = BigInt(amountMinor); // up to 1e12 minor units times 1e4 would pass 2^53
  const parts = shares.map(bp => (amount * BigInt(bp)) / BigInt(SHARE_TOTAL_BP));
  const remainders = shares.map((bp, index) => ({ index, rest: (amount * BigInt(bp)) % BigInt(SHARE_TOTAL_BP) }));
  let left = Number(amount - parts.reduce((a, b) => a + b, BigInt(0)));
  remainders.sort((a, b) => (a.rest === b.rest ? a.index - b.index : a.rest > b.rest ? -1 : 1));
  for (const { index } of remainders) {
    if (left === 0) break;
    parts[index] += BigInt(1);
    left -= 1;
  }
  return parts.map(Number);
}

/** The fewest transfers that settle `nets` (they sum to zero): the largest debtor pays the largest creditor, repeated. */
export function transfersFor(members: readonly { id: string; name: string; netMinor: number }[]): Transfer[] {
  const debtors = members.filter(m => m.netMinor < 0).map(m => ({ ...m, left: -m.netMinor }));
  const creditors = members.filter(m => m.netMinor > 0).map(m => ({ ...m, left: m.netMinor }));
  const transfers: Transfer[] = [];
  const largest = (list: typeof debtors) => list.reduce((best, m) => (m.left > best.left ? m : best));
  while (debtors.length && creditors.length) { // the earlier member wins a tie, because reduce keeps the first of equals
    const debtor = largest(debtors), creditor = largest(creditors);
    const amountMinor = Math.min(debtor.left, creditor.left);
    transfers.push({ fromId: debtor.id, fromName: debtor.name, toId: creditor.id, toName: creditor.name, amountMinor });
    debtor.left -= amountMinor;
    creditor.left -= amountMinor;
    if (debtor.left === 0) debtors.splice(debtors.indexOf(debtor), 1);
    if (creditor.left === 0) creditors.splice(creditors.indexOf(creditor), 1);
  }
  return transfers;
}

/** The first day whose shared items can count (the settlement day itself, for items created after it), or null when there is no split yet. */
export function countingFrom(split: SplitState): string | null {
  if (split.members.length < 2 || split.since === null) return null;
  return split.settledThrough === null || split.settledThrough < split.since ? split.since : split.settledThrough;
}

/** Whether an item dated `date` and created at `createdAt` is still unsettled: dated after the settlement, or that day but created after it. */
function unsettled(split: SplitState, date: string, createdAt: string): boolean {
  if (split.settledThrough === null || date > split.settledThrough) return true;
  return date === split.settledThrough && split.settledAt !== null && createdAt > split.settledAt;
}

export function splitBalance(split: SplitState, today: string): SplitBalance {
  const { members } = split;
  if (members.reduce((sum, m) => sum + m.shareBp, 0) !== SHARE_TOTAL_BP) throw new Error("Shares must total 10,000 basis points");
  const from = countingFrom(split);
  const paid = new Map(members.map(m => [m.id, 0]));
  const share = new Map(members.map(m => [m.id, 0]));
  let items = 0;
  const count = (amountMinor: number, payer: string) => {
    if (!paid.has(payer)) throw new Error("A shared item is paid by someone who is not a member of this household");
    const parts = allocate(amountMinor, members.map(m => m.shareBp));
    paid.set(payer, paid.get(payer)! + amountMinor);
    members.forEach((m, index) => share.set(m.id, share.get(m.id)! + parts[index]));
    items += 1;
  };
  if (from !== null) {
    for (const bill of split.bills) {
      const dates = bill.repeatDay === null ? (bill.due >= from && bill.due <= today ? [bill.due] : []) : occurrenceDates(bill.due, bill.repeatDay, from, today);
      for (const date of dates) if (unsettled(split, date, bill.createdAt)) count(bill.amountMinor, bill.paidBy); // an occurrence takes its bill row's created_at
    }
    for (const charge of split.charges) if (charge.date >= from && charge.date <= today && unsettled(split, charge.date, charge.createdAt)) count(charge.amountMinor, charge.paidBy);
  }
  const balances = members.map(m => ({ id: m.id, name: m.name, paidMinor: paid.get(m.id)!, shareMinor: share.get(m.id)!, netMinor: paid.get(m.id)! - share.get(m.id)! }));
  return { members: balances, transfers: transfersFor(balances), items, from };
}

export const transferLine = (t: Transfer, currency: Currency) => `${t.fromName} owes ${t.toName} ${minorMoney(t.amountMinor, currency)}`;

/** One short sentence for the agent and the screen, built in code. */
export function splitSummary(split: SplitState, balance: SplitBalance, currency: Currency): string {
  if (split.members.length < 2) return "Only one person is in this household, so there is nothing to split.";
  if (!balance.transfers.length) return "Nobody owes anyone anything.";
  return balance.transfers.map(t => transferLine(t, currency)).join(". ") + ".";
}
