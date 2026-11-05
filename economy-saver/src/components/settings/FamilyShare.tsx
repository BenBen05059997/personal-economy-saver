"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiForm } from "@/components/ui/ApiForm";
import { FORM_FETCH_HEADER } from "@/lib/form-fetch";

export type FamilyLinkRow = { id: string; made: string; until: string };

/**
 * Settings → People → Share a family view (D52). Only the hash of a link is stored, so the full link and the message for LINE
 * are on screen once, right after the link is made. The list underneath shows the live links without their addresses.
 */
export function FamilyShare({ links }: { links: FamilyLinkRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [made, setMade] = useState<{ link: string; message: string } | null>(null);
  const [copied, setCopied] = useState("");
  const linkField = useRef<HTMLInputElement>(null);
  const textField = useRef<HTMLTextAreaElement>(null);

  async function create() {
    if (busy) return;
    setBusy(true); setMessage(""); setMade(null); setCopied("");
    try {
      const body = new FormData();
      body.set("kind", "create");
      const response = await fetch("/api/family-links", { method: "POST", body, headers: { [FORM_FETCH_HEADER]: "1" } });
      if (!response.ok) { setMessage(await response.text()); return; }
      setMade(await response.json());
      router.refresh();
    } catch { setMessage("Couldn’t make the link. Check your connection and try again."); }
    finally { setBusy(false); }
  }

  async function copy(what: "link" | "message", value: string, field: HTMLInputElement | HTMLTextAreaElement | null) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(what === "link" ? "Link copied." : "Message copied.");
    } catch {
      field?.focus(); field?.select(); // no clipboard access: the text is selected so the person can copy it
      setCopied("Select and copy the text above.");
    }
  }

  return <div className="settings-family" id="family-view">
    <h3>Share a family view</h3>
    <p className="ui-hint">Anyone with the link can see the month, the bills coming up and who owes whom for 7 days. Nothing can be changed from it.</p>
    <button type="button" className="ui-button" disabled={busy || links.length >= 5} onClick={create}>Make a link</button>
    {links.length >= 5 && <p className="ui-hint">5 links are live. Stop sharing one to make another.</p>}
    <p role="status" className="ui-hint">{message}</p>
    {made && <div className="ui-field">
      <label htmlFor="family-link">Copy this link now. It’s shown once.</label>
      <input id="family-link" ref={linkField} readOnly value={made.link} onFocus={event => event.target.select()} autoComplete="off" spellCheck={false} />
      <button type="button" className="ui-button" onClick={() => copy("link", made.link, linkField.current)}>Copy link</button>
      <label htmlFor="family-message">Or send this on LINE</label>
      <textarea id="family-message" ref={textField} readOnly rows={4} value={made.message} onFocus={event => event.target.select()} />
      <button type="button" className="ui-button" onClick={() => copy("message", made.message, textField.current)}>Copy message for LINE</button>
      <p role="status" className="ui-hint">{copied}</p>
    </div>}
    {links.map(link => <div className="ui-row" key={link.id}>
      <div>Made {link.made}<p className="ui-hint">Lasts until {link.until}</p></div>
      <ApiForm action="/api/family-links"><input type="hidden" name="kind" value="stop" /><input type="hidden" name="id" value={link.id} />
        <button className="ui-button">Stop sharing</button></ApiForm>
    </div>)}
  </div>;
}
