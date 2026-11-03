"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

/** Posts the file to /api/upload and keeps the person here with the server's message when it refuses. */
export function UploadForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/upload", { method: "POST", body: new FormData(event.currentTarget) });
      if (response.ok) { router.push("/to-check"); return; }
      setMessage(await response.text());
    } catch { setMessage("Couldn’t upload. Check your connection and try again."); }
    setBusy(false);
  }
  return <form onSubmit={submit} method="post" action="/api/upload" encType="multipart/form-data" aria-busy={busy}>
    <label className="ui-field">Document<input type="file" name="document" required accept="image/jpeg,image/png,image/webp,application/pdf" disabled={busy} /></label>
    <p className="ui-hint">JPEG, PNG, WebP or PDF · up to 6 MiB</p>
    <div className="ui-row"><button className="ui-button primary" disabled={busy}>{busy ? "Uploading…" : "Upload and read"}</button><Link className="reader-check" href="/to-check">To check</Link></div>
    <p role="alert" className="ui-hint reader-error">{message}</p>
  </form>;
}
