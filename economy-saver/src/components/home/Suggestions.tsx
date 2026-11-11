import Link from "next/link";
import type { openSuggestions } from "@/db/suggestions";
import { ApiForm, ApiFormGroup } from "@/components/ui/ApiForm";
import { hrefFor } from "@/lib/links";
import { findingsBySpace } from "@/lib/money/suggestion-types";

type Suggestion = Awaited<ReturnType<typeof openSuggestions>>[number];

function actionFor(row: Suggestion) {
  if (row.action === "regular") return { label: "Review regular costs", href: "/spending/over-time#regular-costs" };
  if (row.action === "runway") return { label: "Review safe to spend", href: "/#next-30-days" };
  if (!row.refId) throw new Error("Suggestion action needs a reference");
  switch (row.action) {
    case "remind": return { label: "Copy link again", href: hrefFor({ type: "invoice", id: row.refId }) };
    case "statement": return { label: "Review statement", href: hrefFor({ type: "statement", id: row.refId }) };
    case "check_bill": return { label: "Review in To check", href: "/to-check#check-" + row.refId };
    case "bill": return { label: "Review bill", href: hrefFor({ type: "bill", id: row.refId }) };
    case "pot": return { label: "Review pot", href: hrefFor({ type: "pot", id: row.refId }) };
  }
}

function SuggestionCard({ row, grouped }: { row: Suggestion; grouped: boolean }) {
  const action = actionFor(row), Heading = grouped ? "h4" : "h3";
  return <article className="home-suggestion">
    <Heading>{row.title}</Heading>
    <p className="home-note">{row.reason}{row.spaceName && ` Space: ${row.spaceName}.`}</p>
    <Link prefetch={false} href={action.href} className="home-button home-primary">{action.label}</Link>
    <ApiForm action="/api/suggestions" className="home-suggestion-choice">
      <input type="hidden" name="id" value={row.id} />
      <button className="home-button home-secondary" name="kind" value="not_now">Not now</button>
      <button className="home-button home-secondary" name="kind" value="dismiss">Dismiss</button>
    </ApiForm>
  </article>;
}

export function Suggestions({ rows }: { rows: readonly Suggestion[] }) {
  if (!rows.length) return null;
  const groups = findingsBySpace(rows), grouped = groups.length > 1;
  return <section id="assistant-suggestions" className="home-panel" aria-labelledby="assistant-suggestions-title">
    <h2 id="assistant-suggestions-title">From your assistant</h2>
    <ApiFormGroup>{grouped
      ? groups.map(group => <div key={group.id ?? "general"} className="home-suggestion-group">
        <h3>{group.name}</h3>
        {group.rows.map(row => <SuggestionCard key={row.id} row={row} grouped />)}
      </div>)
      : rows.map(row => <SuggestionCard key={row.id} row={row} grouped={false} />)
    }</ApiFormGroup>
  </section>;
}
