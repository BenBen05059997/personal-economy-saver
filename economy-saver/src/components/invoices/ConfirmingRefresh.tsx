"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

const EVERY_MS = 3000;
const GIVE_UP_MS = 2 * 60 * 1000;

/** While PayPal has taken a payment but not yet confirmed it, asks the page for fresh data every few seconds, then stops. */
export function ConfirmingRefresh() {
  const router = useRouter();
  const [gaveUp, setGaveUp] = useState(false);
  useEffect(() => {
    const timer = setInterval(() => router.refresh(), EVERY_MS);
    const stop = setTimeout(() => { clearInterval(timer); setGaveUp(true); }, GIVE_UP_MS);
    return () => { clearInterval(timer); clearTimeout(stop); };
  }, [router]);
  return <p role="status" className="ui-hint">{gaveUp ? "PayPal hasn’t confirmed yet. Reload in a minute." : "PayPal is confirming the payment. This page updates by itself."}</p>;
}
