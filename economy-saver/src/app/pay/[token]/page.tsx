import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { LoadingState } from "@/components/ui/LoadingState";
import { db } from "@/db/client";
import { paymentLinkView } from "@/db/payment-link";
import { minorMoney } from "@/lib/money/format";
import { Currency } from "@/lib/catalogue/types";
import { Confirming } from "../Confirming";
import "../pay.css";

export const metadata: Metadata = {
  title: "Pay an invoice · fipa",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

async function Pay({ params }: { params: Promise<{ token: string }> }) {
  await connection();
  const { token } = await params;
  const view = await paymentLinkView(db(), token);
  if (view.state === "paid") return <main className="pay-page">
    <h1 className="ui-title">This invoice is paid. Thank you.</h1>
  </main>;
  if (view.state === "processing") return <main className="pay-page">
    <Confirming />
  </main>;
  if (view.state === "ended") return <main className="pay-page">
    <h1 className="ui-title">This link has ended</h1>
    <p>This payment link can no longer be used. If you still need to pay, ask the person who sent it for a new one.</p>
  </main>;
  return <main className="pay-page">
    <p className="pay-brand">fipa</p>
    <h1 className="ui-title">Pay this invoice</h1>
    <dl className="pay-details">
      <div><dt>For</dt><dd>{view.item}</dd></div>
      <div><dt>Amount</dt><dd className="pay-amount">{minorMoney(view.amountMinor, Currency.parse(view.currency))}</dd></div>
    </dl>
    <form method="post" action="/api/pay">
      <input type="hidden" name="token" value={token} />
      <button type="submit" className="ui-button primary">Pay</button>
    </form>
    <p className="pay-note">You pay on PayPal’s own page, by PayPal or by card.</p>
  </main>;
}

export default function PayPage(props: { params: Promise<{ token: string }> }) {
  return <Suspense fallback={<LoadingState label="Opening the invoice…" />}><Pay {...props} /></Suspense>;
}
