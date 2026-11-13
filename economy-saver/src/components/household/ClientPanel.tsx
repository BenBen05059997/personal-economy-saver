import Link from "next/link";
import { dayLabel, usd } from "@/lib/money/format";
import { paceLine } from "@/lib/money/pace";
import { project } from "@/lib/money/runway";
import type { Client, MoneyState } from "@/lib/money/types";
import { Detail } from "./ListPage";
import "./household.css";

export function ClientPanel({ state, client }: { state: MoneyState; client: Client }) {
  const invoices = state.invoices.filter(i => i.clientId === client.id);
  const pace = paceLine(client);
  return <Detail title={client.name} close="/clients">
    <p className="ui-hint">{client.email}</p>
    <dl>
      <div className="ui-row"><dt>Payment terms</dt><dd>{client.termsDays === 0 ? "Due on receipt" : `${client.termsDays} days`}</dd></div>
      {pace && <div className="ui-row"><dt>Time to pay</dt><dd>{pace}</dd></div>}
    </dl>
    <h3>Work and invoices</h3>
    {invoices.map(invoice => <Link prefetch={false} className="ui-row directory-link" key={invoice.id} href={`/invoices/${invoice.id}`}>
      <div>{invoice.item}<small>{invoice.number ? `#${invoice.number} · ` : ""}{invoice.status}
        {invoice.status === "sent" && ` · expected ${dayLabel(project(state, invoice).expectedOn)}`}</small></div>
      <span className="num">{usd(invoice.amountUsd)}</span>
    </Link>)}
    {!invoices.length && <p className="ui-hint">No current work or recent invoices.</p>}
    <p className="directory-next"><Link prefetch={false} href={`/invoices/new?client=${client.id}`}>New invoice for this client ›</Link></p>
  </Detail>;
}
