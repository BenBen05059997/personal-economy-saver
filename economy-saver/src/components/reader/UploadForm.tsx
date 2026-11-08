"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FORM_FETCH_HEADER } from "@/lib/form-fetch";

type Line = { name: string; result: string };

/** Posts each chosen file to /api/upload on its own, one after another, and shows a line per file; a refused file does not stop the others. */
export function UploadForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const files = Array.from(new FormData(event.currentTarget).getAll("document")).filter((item): item is File => item instanceof File && item.size > 0);
    if (files.length === 0) return;
    setBusy(true);
    setLines(files.map(file => ({ name: file.name, result: "waiting" })));
    let sent = 0;
    for (const [index, file] of files.entries()) {
      let result: string;
      try {
        const body = new FormData();
        body.set("document", file);
        const response = await fetch("/api/upload", { method: "POST", body, headers: { [FORM_FETCH_HEADER]: "1" } });
        if (response.ok) { sent += 1; result = "sent"; }
        else result = (await response.text()) || "Upload failed.";
      } catch { result = "Couldn’t upload. Check your connection and try again."; }
      setLines(current => current.map((line, at) => at === index ? { ...line, result } : line));
    }
    if (sent === files.length) { router.push("/to-check"); return; }
    setBusy(false);
  }
  return <form onSubmit={submit} method="post" action="/api/upload" encType="multipart/form-data" aria-busy={busy}>
    <label className="ui-field">Documents<input type="file" name="document" required multiple accept="image/jpeg,image/png,image/webp,application/pdf" disabled={busy} /></label>
    <p className="ui-hint">JPEG, PNG, WebP or PDF · up to 6 MiB each · choose as many as you like</p>
    <div className="ui-row"><button className="ui-button primary" disabled={busy}>{busy ? "Uploading…" : "Upload and read"}</button><Link className="reader-check" href="/to-check">To check</Link></div>
    <ul aria-live="polite" className="ui-hint reader-error">{lines.map((line, index) => <li key={index}>{line.name} — {line.result}</li>)}</ul>
  </form>;
}
