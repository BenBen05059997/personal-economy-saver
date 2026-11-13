// Where one month's money went (D77): the clients that paid, the month's money, then what was set aside, what was spent and what is left. Pure; integer minor units.
// Flows in equal flows out at every node. A card charge is one spending item, so it appears once; statements are not nodes.
import type { LookByView } from "./look-by";
import type { IncomeRow, PotFill } from "./types";

export type FlowKind = "client" | "earlier" | "month" | "pot" | "category" | "other" | "left";
export type FlowNode = { id: string; label: string; column: 0 | 1 | 2; minor: number; kind: FlowKind };
export type MoneyFlow = {
  month: string; name: string;
  nodes: FlowNode[]; links: { from: string; to: string; minor: number }[];
  inMinor: number; setAsideMinor: number; spentMinor: number; leftOverMinor: number; fromEarlierMinor: number;
  /** Clients whose payment in the month has no rate to the home currency: named, never counted. */
  unrated: string[];
};

const TOP_CATEGORIES = 5, TOP_CLIENTS = 5;
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

/** The flow of `month` (YYYY-MM), or null when nothing came in, was set aside or was spent. `monthView` is `lookBy` for that month; its rows' `spent` is what went out by today. */
export function moneyFlow(income: IncomeRow[], potFills: PotFill[], monthView: LookByView, month: string): MoneyFlow | null {
  const paid = income.filter(row => row.paidOn.slice(0, 7) === month);
  const unrated = [...new Set(paid.filter(row => row.homeMinor === null).map(row => row.clientName))].sort();
  const byClient = new Map<string, { label: string; minor: number }>();
  for (const row of paid) if (row.homeMinor !== null) {
    const key = row.clientId ?? row.clientName, kept = byClient.get(key);
    byClient.set(key, { label: row.clientName, minor: (kept?.minor ?? 0) + row.homeMinor });
  }
  const clients = [...byClient].map(([key, value]) => ({ key, ...value })).filter(client => client.minor > 0).sort((a, b) => b.minor - a.minor || a.label.localeCompare(b.label));
  const shownClients = clients.length > TOP_CLIENTS + 1 ? clients.slice(0, TOP_CLIENTS) : clients, restClients = clients.slice(shownClients.length);

  const fills = new Map<string, { label: string; minor: number }>();
  for (const fill of potFills) if (fill.date.slice(0, 7) === month && fill.minor > 0) fills.set(fill.potId, { label: fill.potName, minor: (fills.get(fill.potId)?.minor ?? 0) + fill.minor });
  const pots = [...fills].map(([key, value]) => ({ key, ...value })).sort((a, b) => b.minor - a.minor || a.label.localeCompare(b.label));

  const spending = monthView.rows.filter(row => row.spent > 0).sort((a, b) => b.spent - a.spent || a.label.localeCompare(b.label));
  const categories = spending.length > TOP_CATEGORIES + 1 ? spending.slice(0, TOP_CATEGORIES) : spending, restCategories = spending.slice(categories.length);

  const inMinor = sum(clients.map(client => client.minor)), setAsideMinor = sum(pots.map(pot => pot.minor)), spentMinor = sum(spending.map(row => row.spent));
  const out = setAsideMinor + spentMinor;
  if (inMinor === 0 && out === 0) return null;
  const leftOverMinor = Math.max(0, inMinor - out), fromEarlierMinor = Math.max(0, out - inMinor), through = Math.max(inMinor, out);

  const nodes: FlowNode[] = [], links: MoneyFlow["links"] = [];
  const add = (node: FlowNode, from: string | null, to: string | null) => { nodes.push(node); links.push({ from: from ?? node.id, to: to ?? node.id, minor: node.minor }); };
  for (const client of shownClients) add({ id: `c:${client.key}`, label: client.label, column: 0, minor: client.minor, kind: "client" }, null, "month");
  if (restClients.length) add({ id: "c:other", label: "Other clients", column: 0, minor: sum(restClients.map(client => client.minor)), kind: "client" }, null, "month");
  if (fromEarlierMinor > 0) add({ id: "earlier", label: "From earlier money", column: 0, minor: fromEarlierMinor, kind: "earlier" }, null, "month");
  nodes.push({ id: "month", label: "Money in", column: 1, minor: through, kind: "month" });
  for (const pot of pots) add({ id: `p:${pot.key}`, label: `Set aside: ${pot.label}`, column: 2, minor: pot.minor, kind: "pot" }, "month", null);
  for (const row of categories) add({ id: `k:${row.key}`, label: row.label, column: 2, minor: row.spent, kind: "category" }, "month", null);
  if (restCategories.length) add({ id: "other", label: "Everything else", column: 2, minor: sum(restCategories.map(row => row.spent)), kind: "other" }, "month", null);
  if (leftOverMinor > 0) add({ id: "left", label: "Left over", column: 2, minor: leftOverMinor, kind: "left" }, "month", null);
  return { month, name: monthView.name, nodes, links, inMinor, setAsideMinor, spentMinor, leftOverMinor, fromEarlierMinor, unrated };
}
