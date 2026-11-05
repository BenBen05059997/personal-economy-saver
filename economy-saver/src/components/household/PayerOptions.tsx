/** The choices for "who pays it?" on a shared bill, on every form: the people, then "Nobody" (an empty value: the bill is left out of who owes whom). */
export function PayerOptions({ people }: { people: { id: string; name: string }[] }) {
  return <>{people.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}<option value="">Nobody (not split by shares)</option></>;
}
