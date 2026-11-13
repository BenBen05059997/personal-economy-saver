import { notFound } from "next/navigation";
import type { MoneyState } from "@/lib/money/types";
import type { loadSettings } from "@/db/settings";
import type { OwnChoices } from "@/lib/reader/own-choices";
import { CardPanel } from "./CardPanel";
import { CardsList } from "./CardsList";
import { ClientPanel } from "./ClientPanel";
import { ClientsList } from "./ClientsList";
import { ListPage } from "./ListPage";
import "./household.css";

/** What the cards page also needs beyond the money state: the settings read (the card form's people and fields) and the own categories (the statement import). */
export type CardsData = { settings: Awaited<ReturnType<typeof loadSettings>>; own: OwnChoices };

/** Cards or Clients: the list, and the selected row's panel on the right. */
export function Directory({ state, section, selected, cardsData }: { state: MoneyState; section: "cards" | "clients"; selected?: string; cardsData?: CardsData }) {
  const card = section === "cards" && selected ? state.cards.find(row => row.id === selected) : undefined;
  const client = section === "clients" && selected ? state.clients.find(row => row.id === selected) : undefined;
  if (selected && !card && !client) notFound();
  const isCards = section === "cards";
  if (isCards && !cardsData) throw new Error("The cards page needs its settings");
  const panel = card && cardsData ? <CardPanel state={state} card={card} data={cardsData.settings} /> : client ? <ClientPanel state={state} client={client} /> : undefined;
  return <ListPage title={isCards ? "Cards" : "Clients"} hint={isCards ? "Statements, charges and what will cover them." : "Work to invoice, payments due and how soon clients usually pay."}
    add={isCards ? "card" : "client"} addLabel={isCards ? "Add a card" : "Add a client"} panel={panel}>
    {isCards ? <CardsList state={state} selected={selected} cardsData={cardsData!} /> : <ClientsList state={state} selected={selected} />}
  </ListPage>;
}
