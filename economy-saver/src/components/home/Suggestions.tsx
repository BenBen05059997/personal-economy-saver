import Link from "next/link";
import type { openSuggestions } from "@/db/suggestions";
import { ApiForm, ApiFormGroup } from "@/components/ui/ApiForm";
import { hrefFor } from "@/lib/links";

type Suggestion = Awaited<ReturnType<typeof openSuggestions>>[number];

function actionFor(row: Suggestion) {
  if (row.action === "regular") return { label: "Review regular costs", href: "/plan#plan-regular-title" };
  if (row.action === "runway") return { label: "Review safe to spend", href: "/#next-30-days" };
  if (!row.refId) throw new Error("Suggestion action needs a reference");
  switch (row.action) {
    case "remind": return { label: "Review reminder", href: hrefFor({ type: "invoice", id: row.refId }) };
    case "invoice": return { label: "Review invoice", href: hrefFor({ type: "invoice", id: row.refId }) };
    case "statement": return { label: "Review statement", href: hrefFor({ type: "statement", id: row.refId }) };
    case "check_bill": return { label: "Review in To check", href: "/to-check#check-" + row.refId };
    case "bill": return { label: "Review bill", href: hrefFor({ type: "bill", id: row.refId }) };
    case "pot": return { label: "Review pot", href: hrefFor({ type: "pot", id: row.refId }) };
  }
}

export function Suggestions({ rows }: { rows: readonly Suggestion[] }) {
  if (!rows.length) return null;
  return <section id="assistant-suggestions" className="home-panel" aria-labelledby="assistant-suggestions-title">
    <h2 id="assistant-suggestions-title">From your assistant</h2>
    <ApiFormGroup>{rows.map(row => {
      const action = actionFor(row);
      return <article key={row.id} className="home-suggestion">
        <h3>{row.title}</h3>
        <p className="home-note">{row.reason}</p>
        <Link prefetch={false} href={action.href} className="home-button home-primary">{action.label}</Link>
        <ApiForm action="/api/suggestions" className="home-suggestion-choice">
          <input type="hidden" name="id" value={row.id} />
          <button className="home-button home-secondary" name="kind" value="not_now">Not now</button>
          <button className="home-button home-secondary" name="kind" value="dismiss">Dismiss</button>
        </ApiForm>
      </article>;
    })}</ApiFormGroup>
  </section>;
}
