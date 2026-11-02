import { AccountFrame } from "./AccountFrame";

export function SetupForm() {
  return <AccountFrame title="Set up your household">
    <p className="ui-hint">Start with your bank balance and one card. Your household starts fresh with the figures you enter here. Demo bills and payments stay out of your accounts.</p>
    <form method="post" action="/api/onboarding">
      <label className="ui-field">Your display name<input name="name" autoComplete="given-name" maxLength={80} required /></label>
      <div className="account-grid">
        <label className="ui-field">Home currency<select name="currency" defaultValue="JPY"><option value="JPY">Japanese yen</option><option value="USD">US dollars</option></select></label>
        <label className="ui-field">Time zone<input name="timeZone" defaultValue="Asia/Tokyo" maxLength={80} required /></label>
      </div>
      <label className="ui-field">Current bank balance<input name="bank" type="text" inputMode="decimal" maxLength={16} required /></label>
      <label className="ui-field">Card label<input name="card" placeholder="Card A" maxLength={80} required /></label>
      <div className="account-grid">
        <label className="ui-field">Closing day<input name="closingDay" type="number" min="1" max="31" required /></label>
        <label className="ui-field">Payment day<input name="dueDay" type="number" min="1" max="31" required /></label>
      </div>
      <label className="ui-field">Credit limit (optional)<input name="limit" inputMode="decimal" maxLength={16} /></label>
      <p className="ui-hint">You can set up bill forwarding and an AI key later in Settings.</p>
      <button className="ui-button primary">Open my household</button>
    </form>
  </AccountFrame>;
}
