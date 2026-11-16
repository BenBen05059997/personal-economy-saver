import { dayLabel } from "@/lib/money/format";
import { STATEMENT_COVERED, type cardSummary } from "@/lib/money/card-summary";

type Summary = ReturnType<typeof cardSummary>;

/** "So far ¥86,450 · due Dec 26" for a statement still building, "Statement …" for a closed one, or "No statement due". */
export function statementWords(next: Summary["next"], format: (amount: number) => string): string {
  return next ? `${next.open ? "So far" : "Statement"} ${format(next.amount)} · due ${dayLabel(next.dueOn)}` : "No statement due";
}

/** The mark under a card's statement: how short it is, or Covered with the words behind the tick. The caller gives the two class names of its own list. */
export function CardStatus({ shortBy, format, shortClass, coveredClass }: { shortBy: number; format: (amount: number) => string; shortClass: string; coveredClass: string }) {
  return shortBy > 0 ? <span className={shortClass}>Short {format(shortBy)}</span> : <span className={coveredClass} title={STATEMENT_COVERED} aria-label={STATEMENT_COVERED}>Covered ✓</span>;
}
