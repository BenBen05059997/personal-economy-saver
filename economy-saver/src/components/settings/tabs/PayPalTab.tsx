import { ApiForm } from "@/components/ui/ApiForm";
import type { ConnectionView } from "@/lib/paypal/contracts";
import { connectWords, OWNER_ONLY_CONNECT } from "@/components/paypal/ConnectLine";

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
    <p>{connectWords(connection)?.head}</p>
    <p className="ui-hint">{connectWords(connection)?.body}</p>
    {isOwner ? <div className="settings-actions">
      <ApiForm action="/api/paypal/connect/return"><button className="ui-button">Check again</button></ApiForm>
      {connect}
    </div> : <p className="ui-hint">{OWNER_ONLY_CONNECT}</p>}
  </section>;
  return <section className="ui-panel" id="paypal-connection"><h2>Your PayPal</h2>
    <p className="ui-hint">{connectWords(connection)?.body}</p>
    {isOwner ? connect : <p className="ui-hint">{OWNER_ONLY_CONNECT}</p>}
  </section>;
}

/** Settings → PayPal: the connection (D76). */
export function PayPalTab({ connection, isOwner }: { connection: ConnectionView; isOwner: boolean }) {
  return <Connection connection={connection} isOwner={isOwner} />;
}
