"use client";

import { useState, type FormEvent } from "react";
import type { McpTokenInfo } from "@/db/mcp-tokens";

export function McpTokens({ tokens }: { tokens: McpTokenInfo[] }) {
  const [items, setItems] = useState(tokens);
  const [issued, setIssued] = useState<{ id: string; value: string } | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function issue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy(true);
    setMessage("");
    setIssued(null);
    try {
      const response = await fetch("/api/mcp/tokens", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: data.get("name"), scopes: data.has("draft") ? ["read", "draft"] : ["read"] }) });
      if (!response.ok) { setMessage(await response.text()); return; }
      const result: { token: string; info: McpTokenInfo } = await response.json();
      setItems(current => [result.info, ...current]);
      setIssued({ id: result.info.id, value: result.token });
      form.reset();
    } catch { setMessage("Couldn’t create the key. Check the list below before trying again."); }
    finally { setBusy(false); }
  }

  async function revoke(id: string) {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/mcp/tokens", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ revoke: id }) });
      if (!response.ok) { setMessage("Couldn’t revoke this key."); return; }
      setItems(current => current.filter(token => token.id !== id));
      if (issued?.id === id) setIssued(null);
      setMessage("Key revoked.");
    } catch { setMessage("Couldn’t revoke this key."); }
    finally { setBusy(false); }
  }

  return <section className="ui-panel" id="mcp">
    <h2>Connect another AI assistant</h2>
    <p className="ui-hint">Give an AI assistant you use a key so it can read your household. You choose whether it may also draft invoices; it can never send one.</p>
    <form onSubmit={issue}>
      <label className="ui-field">Key name<input name="name" maxLength={80} required /></label>
      <label className="ui-check"><input type="checkbox" name="draft" /> Allow invoice drafts</label>{" "}
      <button className="ui-button" disabled={busy}>Create key</button>
    </form>
    {issued && <div className="ui-field"><label htmlFor="new-mcp-token">Copy this key now. It’s shown once.</label>
      <input id="new-mcp-token" readOnly value={issued.value} onFocus={event => event.target.select()} autoComplete="off" spellCheck={false} />
      <button className="ui-button" onClick={() => setIssued(null)}>Done</button></div>}
    {items.map(token => <div className="ui-row" key={token.id}>
      <div>{token.name}<p className="ui-hint">…{token.last4} · {token.scopes.join(", ")}</p></div>
      <button className="ui-button" disabled={busy} onClick={() => revoke(token.id)}>Revoke</button>
    </div>)}
    <p role="status" className="ui-hint">{message}</p>
    <details className="settings-dev"><summary>For developers</summary>
      <p className="ui-hint">An MCP client connects to <code>/api/mcp</code> with the key as a bearer token. Keys are stored hashed. The server offers read and draft tools only; sending an invoice stays behind your tap in the app.</p></details>
  </section>;
}
