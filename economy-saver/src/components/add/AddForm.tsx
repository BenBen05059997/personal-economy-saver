import { ApiForm } from "@/components/ui/ApiForm";
import { AddClientForm } from "@/components/household/AddClientForm";
import { AddPersonForm } from "@/components/household/AddPersonForm";
import { BillForm, ChargeForm } from "@/components/household/AddEntry";
import { PotFields } from "@/components/saving/PotFields";
import { CardFields } from "@/components/settings/CardFields";
import type { AddView } from "@/db/add-view";
import { AddLink } from "./AddLink";
import type { AddKind } from "./context";

export const ADD_TITLES: Record<AddKind, string> = {
  bill: "Add a bill",
  charge: "Add a card charge",
  client: "Add a client",
  card: "Add a card",
  person: "Add a person",
  pot: "Add a pot",
};

export const isAddKind = (value: string): value is AddKind => value in ADD_TITLES;

/** The one form for each kind of thing a person can add. The Add dialog and the Add page both draw it. `id` is minted per open, so a double submit saves once. */
export function AddForm({ kind, id, returnTo, view }: { kind: AddKind; id: string; returnTo: string; view: AddView }) {
  const { today, homeCurrency, people, cards, own } = view;
  switch (kind) {
    case "bill": return <BillForm id={id} returnTo={returnTo} today={today} currency={homeCurrency} people={people} own={own} />;
    case "charge": return cards.length
      ? <ChargeForm id={id} returnTo={returnTo} today={today} currency={homeCurrency} people={people} cards={cards} own={own} />
      : <p className="ui-hint">A card charge needs a card. <AddLink kind="card">Add a card first ›</AddLink></p>;
    case "client": return <AddClientForm id={id} returnTo={returnTo} />;
    case "card": return <ApiForm><CardFields returnTo={returnTo} data={{ people, household: { currency: homeCurrency } }} /></ApiForm>;
    case "person": return <AddPersonForm returnTo={returnTo} />;
    case "pot": return <ApiForm action="/api/pots">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="returnTo" value={returnTo} />
      <PotFields currency={homeCurrency} />
      <button className="ui-button primary">Add pot</button>
    </ApiForm>;
  }
}
