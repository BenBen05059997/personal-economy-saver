import Link from "next/link";
import { Currency } from "@/lib/catalogue/types";
import { minorMoney } from "@/lib/money/format";
import type { publicEvent } from "@/db/event-feed";
import "./household.css";

export function ActivityView({ rows, index, hasOlder, timeZone }: {
  rows: ReturnType<typeof publicEvent>[]; index: number; hasOlder: boolean; timeZone: string;
}) {
  return <>
    <h1 className="ui-title">Activity</h1>
    {!rows.length ? <p>No activity yet.</p> : <table className="household-table">
      <thead><tr><th className="date">Date</th><th>What happened</th><th className="event-kind">Type</th><th className="amount">Amount</th></tr></thead>
      <tbody>{rows.map(row => <tr key={row.id}>
        <td className="date"><time dateTime={row.occurredAt}>{new Date(row.occurredAt).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: timeZone })}</time></td>
        <td>{row.title}{row.body && <p className="ui-hint">{row.body}</p>}</td>
        <td className="event-kind">{row.kind.replaceAll("_", " ")}</td>
        <td className="amount num">{row.amountMinor !== null && row.currency ? minorMoney(row.amountMinor, Currency.parse(row.currency)) : "—"}</td>
      </tr>)}</tbody>
    </table>}
    <nav aria-label="Activity pages" className="household-pages">
      {index > 1 && <Link href={`/activity?page=${index - 1}`}>‹ Newer</Link>}
      {hasOlder && <Link href={`/activity?page=${index + 1}`}>Older ›</Link>}
    </nav>
  </>;
}
