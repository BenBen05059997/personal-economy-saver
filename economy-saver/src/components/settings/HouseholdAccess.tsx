import Link from "next/link";
import type { McpTokenInfo } from "@/db/mcp-tokens";
import type { FamilyLinkRow } from "./FamilyShare";

type Person = { id: string; name: string; role: "owner" | "member"; signedIn: boolean };

export function HouseholdAccess({ people, familyLinks, tokens }: { people: Person[]; familyLinks: FamilyLinkRow[]; tokens: McpTokenInfo[] }) {
  return <section className="ui-panel settings-access" id="access" aria-labelledby="access-title">
    <h2 id="access-title">Who has access</h2>
    <h3>People</h3>
    <ul>{people.map(person => <li key={person.id}>
      <strong>{person.name}</strong> · {person.role === "owner" ? "Owner" : "Member"} · {person.signedIn ? "Has a login" : "No login yet"}
    </li>)}</ul>
    <h3>Family links</h3>
    {familyLinks.length ? <ul>{familyLinks.map(link => <li key={link.id}>Made {link.made} · Until {link.until}</li>)}</ul> : <p className="ui-hint">No active family links.</p>}
    <Link href="#family-view" className="account-link" prefetch={false}>Manage family links ›</Link>
    <h3>MCP keys</h3>
    {tokens.length ? <ul>{tokens.map(token => <li key={token.id}>
      <strong>{token.name}</strong> · …{token.last4} · {token.scopes.join(", ")}
    </li>)}</ul> : <p className="ui-hint">No active MCP keys.</p>}
    <Link href="/settings/ai-model#mcp" className="account-link" prefetch={false}>Manage MCP keys ›</Link>
  </section>;
}
