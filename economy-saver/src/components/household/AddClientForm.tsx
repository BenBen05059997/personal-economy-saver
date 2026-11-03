import "./add-entry.css";

export function AddClientForm({ id }: { id: string }) {
  return <details className="add-entry">
    <summary>Add a client</summary>
    <form method="post" action="/api/clients">
      <input type="hidden" name="id" value={id} />
      <label className="ui-field">Name<input name="name" maxLength={120} required /></label>
      <label className="ui-field">Email<input name="email" type="email" maxLength={254} required /></label>
      <label className="ui-field">Payment terms (days, 0 = due on receipt)<input name="termsDays" type="number" min={0} max={120} step={1} defaultValue={30} required /></label>
      <button className="ui-button primary">Add client</button>
    </form>
  </details>;
}
