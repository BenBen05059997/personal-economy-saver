import Link from "next/link";
import { ApiForm } from "@/components/ui/ApiForm";
import { ConnectLine } from "@/components/paypal/ConnectLine";
import type { invoiceReview } from "@/db/approval";
import { convertMinor, fromRateMicro } from "@/db/money";
import { Currency } from "@/lib/catalogue/types";
import { dayLabel, minorMoney } from "@/lib/money/format";
import { clientPace } from "@/lib/money/pace";
import { expectedPayOn } from "@/lib/money/runway";
import type { MoneyState } from "@/lib/money/types";
import type { ReadPaymentCandidate } from "@/db/invoice-match";
import type { ConnectionView } from "@/lib/paypal/contracts";
import { ConfirmingRefresh } from "./ConfirmingRefresh";
import { CopyLink } from "./CopyLink";
import "./invoice.css";

type Review = NonNullable<Awaited<ReturnType<typeof invoiceReview>>>;

export function InvoiceReview({ review, state, canApprove, connection, candidates, tryIt }: { review: Review; state: MoneyState; canApprove: boolean; connection: ConnectionView; candidates: ReadPaymentCandidate[]; tryIt: boolean }) {
  const { invoice, client, payLink, isRequest } = review;
  const draft = invoice.status === "draft" || invoice.status === "unbilled";
  const sent = invoice.status === "sent";
  // PayPal has taken the payment (a capture is stored) but its verified event has not yet marked the invoice paid.
  const taking = sent && invoice.paypalCaptureId !== null;
  // Late has one meaning everywhere: the day the forecast expects this invoice to be paid is already behind us.
  const forecast = sent ? state.invoices.find(i => i.id === invoice.id) : undefined;
  const late = forecast !== undefined && expectedPayOn(state, forecast) < state.today;
  const canTakePayments = connection.state === "demo" || connection.state === "connected";
  const currency = Currency.parse(invoice.currency);
  // A member's request (D45) is for what they owed, in the household's currency; the dollar amount is only what PayPal is asked for.
  const homeAmount = invoice.owedMinor ?? convertMinor(invoice.amountMinor, currency, state.homeCurrency,
    invoice.fxRateMicro === null ? state.fxPerUsd : fromRateMicro(invoice.fxRateMicro));
  const due = invoice.dueOn ? dayLabel(invoice.dueOn) : "On receipt";
  const paidOutside = !isRequest && (draft || sent) && invoice.paypalCaptureId === null; // a request is settled by Mark settled on Home
  const clientRow = state.clients.find(c => c.id === invoice.clientId);
  const pace = clientRow ? clientPace(clientRow) : null;
  const first = client.split(" ")[0];
  const amount = minorMoney(invoice.amountMinor, currency);
  const into = connection.state === "connected" ? `your PayPal${connection.email ? ` (${connection.email})` : ""}` : "fipa’s sandbox account";
  const paidOutsideForm = <form method="post" action="/api/invoices/paid">
    <input type="hidden" name="id" value={invoice.id} />
    {candidates.length > 0 && sent
      ? <p className="ui-hint">{`PayPal already counted a payment of this amount, so this is only for ${first} paying you separately by bank or cash. It adds ${minorMoney(homeAmount, state.homeCurrency)} to your bank balance.`}</p>
      : <p className="ui-hint">{connection.state === "connected" ? `A payment into your PayPal shows up on its own. Use this if ${client} paid you another way. It adds ${minorMoney(homeAmount, state.homeCurrency)} to your bank balance.`
        : `Use this if ${client} paid you another way. It adds ${minorMoney(homeAmount, state.homeCurrency)} to your bank balance.`}</p>}
    <button className="ui-button">Paid another way (bank, cash)</button>
  </form>;
  return <article className="invoice-review">
    <Link prefetch={false} href="/" className="ui-hint ui-back">← Home</Link>
    <h1 className="ui-title">{isRequest ? (draft ? "Review request" : "Request") : draft ? "Review invoice" : "Invoice"}</h1>
    <dl className="invoice-details">
      <div className="ui-row"><dt>To</dt><dd>{client}</dd></div>
      <div className="ui-row"><dt>For</dt><dd>{invoice.item}</dd></div>
      {invoice.number && <div className="ui-row"><dt>Number</dt><dd>{invoice.number}</dd></div>}
      {!isRequest && <div className="ui-row"><dt>Due</dt><dd>{due}</dd></div>}
      <div className="ui-row"><dt>Amount</dt><dd className="invoice-amount">{amount}
        {currency !== state.homeCurrency && <small>≈ {minorMoney(homeAmount, state.homeCurrency)}</small>}</dd></div>
      {pace && <div className="ui-row"><dt>Pace</dt><dd className="invoice-pace">{client} usually pays {pace.usual} days after you send, slowest {pace.slowest}</dd></div>}
      {invoice.note && <div className="ui-row"><dt>Note</dt><dd>{invoice.note}</dd></div>}
    </dl>
    {isRequest && draft && <p className="ui-hint">{`${first} owes you ${minorMoney(homeAmount, state.homeCurrency)} for shared costs. Approve makes a PayPal link for ${amount}; when ${first} pays it, those costs are marked settled.`}</p>}
    {draft && (canTakePayments
      ? canApprove
        // The sandbox call takes 5 to 10 s: ApiForm disables the button while it runs, and the busy line shows (invoice.css).
        ? <ApiForm action="/api/approve" className="invoice-approve">
          <input type="hidden" name="approve_key" value={invoice.approveKey} />
          <input type="hidden" name="action" value="send" />
          <button className="ui-button primary">Approve and make payment link</button>
          <p className="ui-hint invoice-sending">Asking PayPal sandbox for a payment link…</p>
          <p className="ui-hint invoice-send-hint">{`PayPal sandbox makes a link for ${amount} that ${first} pays into ${into}. No real money moves.`}</p>
        </ApiForm>
        : <p className="invoice-status">Only the household owner can approve PayPal actions.</p>
      : <ConnectLine connection={connection} isOwner={canApprove} />)}
    {sent && payLink && <section className="invoice-link-section">
      <p className="invoice-status">{`Link made${invoice.sentOn ? ` ${dayLabel(invoice.sentOn)}` : ""}. Awaiting payment.`}</p>
      {taking ? <ConfirmingRefresh /> : late && <p className="ui-hint">{`${first} is late. To send the link again, copy it again and send it the way you did before.`}</p>}
      <CopyLink url={payLink} invoiceId={invoice.id} client={first} plain={tryIt && !taking} />
      {tryIt && !taking && <ApiForm action="/api/try/pay-as-client" className="invoice-play-client">
        <input type="hidden" name="id" value={invoice.id} />
        <p className="ui-hint">{isRequest
          ? `Play ${first}: fipa pays this link with PayPal’s sandbox test card, so no PayPal login is needed. PayPal confirms in about 20 seconds; then the payment shows at the top of Activity and the shared costs are settled.`
          : `Play the client: fipa pays this link with PayPal’s sandbox test card, so no PayPal login is needed. PayPal confirms in about 20 seconds; then the payment shows at the top of Activity and your PayPal balance rises by ${minorMoney(homeAmount, state.homeCurrency)}.`}</p>
        <button className="ui-button primary">{isRequest ? `Pay as ${first} (sandbox test card)` : "Pay as the client (sandbox test card)"}</button>
      </ApiForm>}
      {!taking && candidates.map(c => <form key={c.paymentId} method="post" action="/api/invoices/match" className="invoice-match">
        <input type="hidden" name="id" value={invoice.id} />
        <input type="hidden" name="paymentId" value={c.paymentId} />
        <p className="invoice-status">{`${c.ownClient ? first : payerLabel(c)} paid ${minorMoney(c.amountMinor, Currency.parse(c.currency))} on PayPal on ${dayLabel(c.paidOn)}. Is this that ${isRequest ? "request" : "invoice"}?`}</p>
        <button className="ui-button primary">{isRequest ? "Yes, that’s this request" : "Yes, that’s this invoice"}</button>
      </form>)}
      {canApprove && !taking && <details className="invoice-end">
        <summary>End this link</summary>
        <ApiForm action="/api/invoices/end">
          <input type="hidden" name="id" value={invoice.id} />
          <p className="ui-hint">{`${first} will no longer be able to pay with this link, and ${isRequest ? "fipa stops asking for this request" : "fipa stops counting this invoice"}. This can’t be undone.`}</p>
          <button className="ui-button">Yes, end the link</button>
        </ApiForm>
      </details>}
    </section>}
    {sent && !payLink && <p className="invoice-status">{isRequest ? "Request sent. Awaiting payment." : "Invoice sent. Awaiting payment."}</p>}
    {invoice.status === "paid" && <p className="invoice-status">{`Paid ${dayLabel(invoice.paidOn!)}.`}</p>}
    {invoice.status === "paid" && tryIt && <p className="ui-hint">{`Paid. ${first}’s payment is now at the top of Activity and in your PayPal balance on Home. `}<Link prefetch={false} href="/">Back to Home</Link></p>}
    {invoice.status === "closed" && <p className="invoice-status">This payment link has ended. No one can pay with it.</p>}
    {paidOutside && (candidates.length > 0 && sent
      ? <details className="invoice-paid-outside invoice-paid-folded">
        <summary>Paid another way (bank, cash)</summary>
        {paidOutsideForm}
      </details>
      : <div className="invoice-paid-outside">{paidOutsideForm}</div>)}
  </article>;
}

/** The payer as PayPal reported them: the name, with the email when it adds something. */
function payerLabel(c: ReadPaymentCandidate) {
  return c.payer === c.payerEmail || !c.payerEmail ? c.payer : `${c.payer} (${c.payerEmail})`;
}
