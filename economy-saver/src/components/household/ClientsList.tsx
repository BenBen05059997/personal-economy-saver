import Link from "next/link";
import { usd } from "@/lib/money/format";
import { paceLine } from "@/lib/money/pace";
import type { MoneyState } from "@/lib/money/types";
import { hrefFor } from "@/lib/links";
import { MoneyIn } from "@/components/clients/MoneyIn";
import { PanelHint } from "@/components/ui/PanelHint";
import "./household.css";

/** The Clients page's rows and the empty hint. */
export function ClientsList({ state, selected }: { state: MoneyState; selected?: string }) {
  return <>
    <MoneyIn state={state} />
    {state.clients.map(item => {
      const outstanding = state.invoices.filter(i => i.clientId === item.id && i.status === "sent").reduce((sum, i) => sum + i.amountUsd, 0);
      return <Link key={item.id} id={`client-${item.id}`} prefetch={false} className="ui-row directory-link" href={hrefFor({ type: "client", id: item.id })} aria-label={item.name} aria-current={item.id === selected ? "page" : undefined}>
        <div>{item.name}<small>{item.email}</small>{paceLine(item) && <small>Time to pay: {paceLine(item)}</small>}</div><div>{outstanding > 0 ? <>{usd(outstanding)}<small>Outstanding</small></> : <small>Nothing outstanding</small>}</div>
      </Link>;
    })}
    {state.clients.length === 0 && <PanelHint className="directory-empty" add="client" label="Add a client">No clients yet.</PanelHint>}
  </>;
}
