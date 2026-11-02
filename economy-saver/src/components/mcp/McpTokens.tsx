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
    } catch { setMessage("Couldn’t create a token. Check the token list before trying again."); }
    finally { setBusy(false); }
  }

  async function revoke(id: string) {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/mcp/tokens", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ revoke: id }) });
      if (!response.ok) { setMessage("Couldn’t revoke this token."); return; }
      setItems(current => current.filter(token => token.id !== id));
      if (issued?.id === id) setIssued(null);
      setMessage("Token revoked.");
    } catch { setMessage("Couldn’t revoke this token."); }
    finally { setBusy(false); }
  }

  return <section className="ui-panel" id="mcp">
    <h2>MCP access</h2>
    <p className="ui-hint">Connect an MCP client to <code>/api/mcp</code> with a bearer token. Choose whether it can draft invoices.</p>
    <form onSubmit={issue}>
      <label className="ui-field">Token name<input name="name" maxLength={80} required /></label>
      <label><input type="checkbox" name="draft" /> Allow invoice drafts</label>{" "}
      <button className="ui-button" disabled={busy}>Create token</button>
    </form>
    {issued && <div className="ui-field"><label htmlFor="new-mcp-token">Copy this token now. It’s shown once.</label>
      <input id="new-mcp-token" readOnly value={issued.value} onFocus={event => event.target.select()} autoComplete="off" spellCheck={false} />
      <button className="ui-button" onClick={() => setIssued(null)}>Done</button></div>}
    {items.map(token => <div className="ui-row" key={token.id}>
      <div>{token.name}<p className="ui-hint">…{token.last4} · {token.scopes.join(", ")}</p></div>
      <button className="ui-button" disabled={busy} onClick={() => revoke(token.id)}>Revoke</button>
    </div>)}
    <p role="status" className="ui-hint">{message}</p>
  </section>;
}
