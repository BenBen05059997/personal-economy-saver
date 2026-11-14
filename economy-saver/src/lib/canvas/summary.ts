// What the engine filled in for a canvas, as text for the model to read (make_canvas result). Block type, label and values; never the
// text of a note or a letter (the model wrote those, and amounts in them must come from other tools).
import { forModel } from "@/lib/money/facts";
import type { ResolvedBlock } from "./resolve";

const MAX_ROWS = 12;

function describe(block: ResolvedBlock): Record<string, unknown> {
  switch (block.type) {
    case "sentence": return { text: block.data.text, ...(block.data.note && { note: block.data.note }) };
    case "number": return { label: block.data.label, value: block.data.value, ...(block.data.sub && { detail: block.data.sub }), ...forModel(block.data.facts) };
    case "progress": return "rows" in block.data ? {
      label: "Goals",
      rows: block.data.rows.slice(0, MAX_ROWS).map(row => ({ label: row.label, value: row.valueLabel, target: row.targetLabel, targetDate: row.targetDate, summary: row.summary })),
      ...(block.data.empty && { empty: block.data.empty }),
    } : { label: block.data.label, value: block.data.valueLabel, target: block.data.targetLabel, ...forModel(block.data.facts) };
    case "flow_chart": return { caption: block.data.caption, lowest: block.data.lowLabel, short: block.data.short, ...forModel(block.data.view.facts) };
    case "timeline": return { caption: block.data.caption, rows: block.data.rows.slice(0, MAX_ROWS).map(row => `${row.dateLabel} ${row.label} ${row.amountLabel}, balance ${row.balanceLabel}`), ...(block.data.empty && { empty: block.data.empty }) };
    case "table": return { ...(block.data.title && { title: block.data.title }), head: block.data.head, rows: block.data.rows.slice(0, MAX_ROWS).map(row => row.cells), ...(block.data.foot && { foot: block.data.foot }), ...(block.data.empty && { empty: block.data.empty }) };
    case "compare": return { a: block.data.aName, b: block.data.bName, aTotal: block.data.aTotal, bTotal: block.data.bTotal, difference: block.data.difference, rows: block.data.rows.slice(0, MAX_ROWS).map(row => `${row.label}: ${row.aLabel} to ${row.bLabel} (${row.change})`), ...forModel(block.data.view.facts) };
    case "by_person": return { month: block.data.month, head: block.data.table.head, rows: block.data.table.rows.slice(0, MAX_ROWS).map(row => row.cells), ...(block.data.table.foot && { foot: block.data.table.foot }), ...(block.data.owes && { owes: block.data.owes }), ...(block.data.empty && { empty: block.data.empty }), ...forModel(block.data.view.facts) };
    case "sliders": return { clients: block.data.controls.map(control => ({ name: control.name, maxDays: control.maxDays })) };
    case "action": return { label: block.data.label, href: block.data.href };
    case "view": return { title: block.data.title, ...(block.data.line && { line: block.data.line }), ...forModel(block.data.facts), ...(block.data.table && { head: block.data.table.head, rows: block.data.table.rows.slice(0, MAX_ROWS).map(row => row.cells) }), ...(block.data.empty && { empty: block.data.empty.words }) };
    case "note": case "letter": return {};
  }
}

/** One JSON line per block, in order. */
export function canvasSummary(blocks: ResolvedBlock[]): string {
  return JSON.stringify({ blocks: blocks.map((block, index) => ({ block: index + 1, type: block.type, ...describe(block) })) });
}
