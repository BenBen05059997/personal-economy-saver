/** Settings → PayPal: the app runs against the PayPal sandbox only; the import reads the sandbox account's clients and invoices when this household may. */
export function PayPalTab({ canImportPayPal }: { canImportPayPal: boolean }) {
  return <section className="ui-panel" id="paypal-import"><h2>PayPal history</h2>
    <p className="ui-hint">PayPal runs in sandbox here, so no real money moves.</p>
    {canImportPayPal ? <>
      <p className="ui-hint">Add the clients and invoices from your PayPal sandbox account. This only reads from PayPal and never changes your balance.</p>
      <form method="post" action="/api/paypal/import"><button className="ui-button">Import clients and invoices from PayPal</button></form>
    </> : <p className="ui-hint">Importing from PayPal is not set up for this household.</p>}
  </section>;
}
