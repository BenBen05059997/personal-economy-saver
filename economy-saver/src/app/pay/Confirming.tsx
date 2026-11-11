// The one wording for a payment PayPal has not yet confirmed (D15).
export function Confirming() {
  return <>
    <h1 className="ui-title">Thank you</h1>
    <p>PayPal is confirming your payment. The person who sent you this link will see it as soon as PayPal confirms.</p>
  </>;
}
