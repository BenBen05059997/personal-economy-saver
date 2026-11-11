import { ApiForm } from "@/components/ui/ApiForm";
import type { ConnectionView } from "@/lib/paypal/contracts";

/** The connection, in words (D76). Only the household owner gets the buttons; a member sees where it stands. */
function Connection({ connection, isOwner }: { connection: ConnectionView; isOwner: boolean }) {
  if (connection.state === "demo") return <section className="ui-panel" id="paypal-connection"><h2>Your PayPal</h2>
    <p className="ui-hint">Try it pays into fipa&apos;s own PayPal sandbox account. Sign in with your email to connect your own PayPal.</p></section>;
  const connect = <form method="post" action="/api/paypal/connect"><button className="ui-button">Connect your PayPal</button></form>;
  if (connection.state === "connected") return <section className="ui-panel" id="paypal-connection"><h2>Your PayPal</h2>
    <p>{connection.email ? `Connected: ${connection.email}` : "Connected"}</p>
    {isOwner ? <>
      <ApiForm action="/api/paypal/disconnect"><button className="ui-button">Disconnect</button></ApiForm>
      <p className="ui-hint">Disconnect makes fipa forget your PayPal. To take fipa&apos;s permission away in PayPal too: In PayPal, open Settings, then the apps and permissions you&apos;ve granted, and remove fipa.</p>
    </> : <p className="ui-hint">Only the household owner can disconnect PayPal.</p>}
  </section>;
  if (connection.state === "pending") return <section className="ui-panel" id="paypal-connection"><h2>Your PayPal</h2>
    <p>Waiting for PayPal.</p>
    <p className="ui-hint">{connection.detail ?? "PayPal hasn't finished your sign-up yet. Check again in a moment."}</p>
    {isOwner ? <div className="settings-actions">
      <ApiForm action="/api/paypal/connect/return"><button className="ui-button">Check again</button></ApiForm>
      {connect}
    </div> : <p className="ui-hint">Only the household owner can connect PayPal.</p>}
  </section>;
  return <section className="ui-panel" id="paypal-connection"><h2>Your PayPal</h2>
    <p className="ui-hint">Connect your PayPal so fipa can read your balance and make payment links.</p>
    {isOwner ? connect : <p className="ui-hint">Only the household owner can connect PayPal.</p>}
  </section>;
}

/** Settings → PayPal: the connection, and the sandbox import that reads the sandbox account's clients and invoices when this household may. */
export function PayPalTab({ connection, isOwner, canImportPayPal }: { connection: ConnectionView; isOwner: boolean; canImportPayPal: boolean }) {
  return <>
    <Connection connection={connection} isOwner={isOwner} />
    <section className="ui-panel" id="paypal-import"><h2>PayPal history</h2>
      <p className="ui-hint">PayPal runs in sandbox here, so no real money moves.</p>
      {canImportPayPal ? <>
        <p className="ui-hint">Add the clients and invoices from your PayPal sandbox account. This only reads from PayPal and never changes your balance.</p>
        <form method="post" action="/api/paypal/import"><button className="ui-button">Import clients and invoices from PayPal</button></form>
      </> : <p className="ui-hint">Importing from PayPal is not set up for this household.</p>}
    </section>
  </>;
}
