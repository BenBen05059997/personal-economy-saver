"use client";

import { useState } from "react";
import { FORM_FETCH_HEADER } from "@/lib/form-fetch";

/** The invoice's payment link in a read-only field and one button that copies it, then tells fipa it was offered. Without JavaScript the field alone is there to copy. */
export function CopyLink({ url, invoiceId, client }: { url: string; invoiceId: string; client: string }) {
  const [message, setMessage] = useState("");
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      setMessage("Couldn’t copy. Select the link and copy it.");
      return;
    }
    setMessage("Copied.");
    const body = new FormData();
    body.set("id", invoiceId);
    try {
      const response = await fetch("/api/invoices/offered", { method: "POST", body, headers: { [FORM_FETCH_HEADER]: "1" } });
      if (!response.ok) setMessage(await response.text());
    } catch { setMessage("Copied. fipa could not note it; check your connection."); }
  }
  return <div className="invoice-copy">
    <input className="invoice-link" readOnly value={url} aria-label="Payment link" onFocus={event => event.currentTarget.select()} />
    <button type="button" className="ui-button primary" onClick={copy}>{`Copy link for ${client}`}</button>
    <p role="status" className="ui-hint">{message}</p>
  </div>;
}
