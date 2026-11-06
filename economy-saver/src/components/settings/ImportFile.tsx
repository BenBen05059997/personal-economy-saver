"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const MAX_BYTES = 1_000_000;

/** Import (D59): reads a version 2 household file in the browser and posts it to /api/restore. The route answers with a sentence when it refuses. */
export function ImportFile() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function pick(input: HTMLInputElement) {
    const file = input.files?.[0];
    if (!file || busy) return;
    setMessage("");
    if (file.size > MAX_BYTES) { setMessage("This file is over 1 MB, which is more than Import takes."); input.value = ""; return; }
    setBusy(true);
    try {
      const response = await fetch("/api/restore", { method: "POST", headers: { "Content-Type": "application/json" }, body: await file.text() });
      if (response.ok) { setMessage("Imported."); router.refresh(); }
      else setMessage(await response.text());
    } catch { setMessage("Couldn’t import. Check your connection and try again."); }
    finally { setBusy(false); input.value = ""; }
  }
  return <div className="settings-import">
    <label className="ui-field">Import a file you exported from here
      <input type="file" accept="application/json,.json" disabled={busy} onChange={event => void pick(event.currentTarget)} /></label>
    <p role="status" className="ui-hint">{busy ? "Importing…" : message}</p>
  </div>;
}
