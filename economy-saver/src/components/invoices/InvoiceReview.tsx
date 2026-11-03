import Link from "next/link";
import type { invoiceReview } from "@/db/approval";
import { convertMinor, fromRateMicro } from "@/db/money";
import { Currency } from "@/lib/catalogue/types";
import { dayLabel, minorMoney } from "@/lib/money/format";
import type { MoneyState } from "@/lib/money/types";
import "./invoice.css";

type Review = NonNullable<Awaited<ReturnType<typeof invoiceReview>>>;

export function InvoiceReview({ review, state }: { review: Review; state: MoneyState }) {
  const { invoice, client } = review;
  const draft = invoice.status === "draft" || invoice.status === "unbilled";
  const late = invoice.status === "sent" && invoice.dueOn !== null && invoice.dueOn < state.today;
  const reminder = late && !!invoice.paypalInvoiceId && !invoice.reminderAttemptedAt;
  const currency = Currency.parse(invoice.currency);
  const homeAmount = convertMinor(invoice.amountMinor, currency, state.homeCurrency,
    invoice.fxRateMicro === null ? state.fxPerUsd : fromRateMicro(invoice.fxRateMicro));
  const due = invoice.dueOn ? dayLabel(invoice.dueOn) : "On receipt";
  const paidOutside = !invoice.paypalInvoiceId && (draft || invoice.status === "sent");
  const label = draft ? "Approve and send" : "Approve reminder";
  return <article className="invoice-review">
    <Link prefetch={false} href="/" className="ui-hint ui-back">← Home</Link>
    <h1 className="ui-title">{draft ? "Review invoice" : reminder ? "Review reminder" : "Invoice"}</h1>
    <dl className="invoice-details">
      <div className="ui-row"><dt>To</dt><dd>{client}</dd></div>
      <div className="ui-row"><dt>For</dt><dd>{invoice.item}</dd></div>
      <div className="ui-row"><dt>Due</dt><dd>{due}</dd></div>
      <div className="ui-row"><dt>Amount</dt><dd className="invoice-amount">{minorMoney(invoice.amountMinor, currency)}
        {currency !== state.homeCurrency && <small>≈ {minorMoney(homeAmount, state.homeCurrency)}</small>}</dd></div>
      {invoice.note && <div className="ui-row"><dt>Note</dt><dd>{invoice.note}</dd></div>}
    </dl>
    {draft || reminder ? <form method="post" action="/api/approve">
      <input type="hidden" name="approve_key" value={invoice.approveKey} />
      <input type="hidden" name="action" value={draft ? "send" : "remind"} />
      <button className="ui-button primary">{label}</button>
      <p className="ui-hint">PayPal Sandbox will send this {draft ? "invoice" : "reminder"} to the configured test client.</p>
    </form> : <p className="invoice-status">
      {invoice.status === "paid" ? `Paid ${dayLabel(invoice.paidOn!)}.`
        : invoice.status === "closed" ? "Closed in PayPal Sandbox."
        : invoice.remindedAt ? "Reminder sent through PayPal Sandbox."
        : invoice.reminderAttemptedAt ? "Reminder requested. Check its delivery in PayPal Sandbox."
        : late && !invoice.paypalInvoiceId ? "No sandbox invoice is linked for a reminder."
        : "Invoice sent. Awaiting payment."}
    </p>}
    {paidOutside && <form method="post" action="/api/invoices/paid" className="invoice-paid-outside">
      <input type="hidden" name="id" value={invoice.id} />
      <button className="ui-button">Mark paid outside PayPal</button>
      <p className="ui-hint">Use this if {client} paid you another way. It adds {minorMoney(homeAmount, state.homeCurrency)} to your bank balance.</p>
    </form>}
  </article>;
}
