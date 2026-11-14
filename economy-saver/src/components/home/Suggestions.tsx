import Link from "next/link";
import type { openSuggestions } from "@/db/suggestions";
import { ApiForm, ApiFormGroup } from "@/components/ui/ApiForm";
import { findingAction, findingsBySpace } from "@/lib/money/suggestion-types";

type Suggestion = Awaited<ReturnType<typeof openSuggestions>>[number];

function SuggestionCard({ row, grouped }: { row: Suggestion; grouped: boolean }) {
  const action = findingAction(row), Heading = grouped ? "h4" : "h3";
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
