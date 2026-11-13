import type { TableTwin } from "@/lib/views/types";
import "./views.css";

/** A view's table twin: the first column reads as text, the rest as figures unless the table says a column is words; a child row is indented. */
export function ViewTable({ table }: { table: TableTwin }) {
  const cls = (i: number) => (table.align?.[i] === "start" ? "view-text" : "hv-num");
  return <div className="hv-table-wrap view-table"><table>
    <caption>{table.caption}</caption>
    <thead><tr>{table.head.map((label, i) => <th scope="col" key={`${i}-${label}`} className={i === 0 ? undefined : cls(i)}>{label}</th>)}</tr></thead>
    <tbody>{table.rows.map(row => <tr key={row.key} className={[row.tone && `view-row-${row.tone}`, row.child && "view-child"].filter(Boolean).join(" ") || undefined}>
      {row.cells.map((cell, i) => i === 0 ? <th scope="row" key={i}>{cell}</th> : <td key={i} className={cls(i)}>{cell}</td>)}
    </tr>)}</tbody>
    {table.foot && <tfoot><tr>{table.foot.map((cell, i) => i === 0 ? <th scope="row" key={i}>{cell}</th> : <td key={i} className={cls(i)}>{cell}</td>)}</tr></tfoot>}
  </table></div>;
}
