import { roomOnCard, type SafeToSpend } from "@/lib/money/runway";
import type { MoneyState } from "@/lib/money/types";
import { dayLabel, homeFormat } from "./format";

export type AffordLine = { ok: boolean; kind: "cash" | "card"; text: string };

/** What a typed amount would do: out of cash, and on the card with the most room. Plain sentences, the person's own numbers. */
export function afford(money: MoneyState, safe: SafeToSpend, amount: number): AffordLine[] {
  const fmt = homeFormat(money);
  const date = dayLabel(safe.low.date);
  const lines: AffordLine[] = [];

  if (amount <= safe.amount) {
    lines.push({ ok: true, kind: "cash", text: `Cash: yes. ${fmt(safe.amount - amount)} would still be safe until ${date}.` });
  } else if (safe.shortBy > 0) {
    lines.push({ ok: false, kind: "cash", text: `Cash: not now, ${date} is already short.` });
  } else {
    lines.push({ ok: false, kind: "cash", text: `Cash: not now, only ${fmt(safe.amount)} is safe until ${date}. This would leave ${date} ${fmt(amount - safe.amount)} short.` });
  }

  // The card with the most room; on a tie, the one whose statement is paid first.
  type Option = { card: MoneyState["cards"][number]; room: ReturnType<typeof roomOnCard> };
  const best = money.cards
    .map((c): Option => ({ card: c, room: roomOnCard(money, c.id) }))
    .reduce<Option | undefined>((top, x) => (!top || x.room.room > top.room.room || (x.room.room === top.room.room && x.room.dueOn < top.room.dueOn) ? x : top), undefined);
  if (best) {
    const due = dayLabel(best.room.dueOn);
    lines.push(
      amount <= best.room.room
        ? { ok: true, kind: "card", text: `On ${best.card.label}: yes, paid ${due}. ${fmt(best.room.room - amount)} of room would be left.` }
        : { ok: false, kind: "card", text: `On ${best.card.label}: no. ${best.room.room > 0 ? `Only ${fmt(best.room.room)} of room` : "No room"}, so its ${due} statement and the bills after it might not be covered.` },
    );
  }
  return lines;
}

/** A typed amount in whole units, or an error to show next to the field. "12,000", "¥12,000" and "$1,200.50" all work. */
export function parseWhole(text: string): { amount: number } | { error: string } {
  const t = text.trim().replace(/^[¥$]\s*/, "").replace(/,/g, "");
  if (t === "") return { error: "Enter an amount to check." };
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return { error: "Use numbers only, like 12,000." };
  const n = Math.round(parseFloat(t));
  if (n <= 0) return { error: "Enter an amount above zero." };
  return { amount: n };
}
