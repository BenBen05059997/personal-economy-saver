import type { Metadata } from "next";
import { Confirming } from "../../Confirming";
import "../../pay.css";

export const metadata: Metadata = {
  title: "Confirming your payment",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

// Only a verified payment from PayPal marks an invoice paid (D15): this page never reads or changes anything.
export default function Done() {
  return <main className="pay-page">
    <Confirming />
    <p className="pay-note">You can close this page.</p>
  </main>;
}
