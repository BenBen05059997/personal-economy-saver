import { fromMinor } from "@/lib/money/format";
import { AmountInput } from "@/components/ui/CheckedInput";

export function Person({ people, selected, shared = false }: { people: { id: string; name: string }[]; selected: string | null; shared?: boolean }) {
  return <label className="ui-field">{shared ? "Bill belongs to" : "Card belongs to"}
    <select name="memberId" defaultValue={selected ?? ""}><option value="">{shared ? "Shared" : "Shared card"}</option>
      {people.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}
    </select></label>;
}
/** The card form; Settings and the setup steps share it. */
export function CardFields({ data, card, returnTo }: { returnTo?: string; data: { people: { id: string; name: string }[]; household: { currency: string } }; card?: { id: string; label: string; memberId: string | null; closingDay: number; dueDay: number; limitMinor: number | null; currency: string; foreignFeeBp: number | null } }) {
  return <><input type="hidden" name="kind" value="card" /><input type="hidden" name="id" value={card?.id ?? ""} />{returnTo && <input type="hidden" name="returnTo" value={returnTo} />}
    <label className="ui-field">Card label<input name="label" defaultValue={card?.label} maxLength={80} required /></label>
    {data.people.length < 2 ? <input type="hidden" name="memberId" value={card?.memberId ?? ""} /> : <Person people={data.people} selected={card?.memberId ?? null} />}
    <div className="settings-grid"><label className="ui-field">Statement closing day<input name="closingDay" type="number" min="1" max="31" defaultValue={card?.closingDay} required /></label>
      <label className="ui-field">Card bill payment day<input name="dueDay" type="number" min="1" max="31" defaultValue={card?.dueDay} required /></label></div>
    <p className="ui-hint">Day of the month, 1 to 31.</p>
    <label className="ui-field">Credit limit ({data.household.currency}, optional)<AmountInput name="limit" currency={data.household.currency} defaultValue={card?.limitMinor == null ? "" : fromMinor(card.limitMinor, card.currency)} /></label>
    <label className="ui-field">Foreign transaction fee, optional (%)<input name="foreignFee" inputMode="decimal" maxLength={5} placeholder="2.2" defaultValue={card?.foreignFeeBp == null ? "" : String(card.foreignFeeBp / 100)} pattern="(10(\.0{1,2})?|[0-9](\.[0-9]{1,2})?)" title="Enter a percentage from 0 to 10, like 2.2" /></label>
    <p className="ui-hint">From your card’s terms: the fee the issuer adds to purchases in another currency. The app uses it only to estimate what a foreign purchase cost.</p>
    <button className="ui-button">{card ? "Save card" : "Add card"}</button></>;
}

