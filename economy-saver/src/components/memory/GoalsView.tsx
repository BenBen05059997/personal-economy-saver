import Link from "next/link";
import { mediumDate } from "@/components/ui/dates";
import { hrefFor } from "@/lib/links";
import { minorMoney } from "@/lib/money/format";
import type { GoalPace } from "@/lib/money/goals";


export function GoalsView({ goals }: { goals: readonly GoalPace[] }) {
  return <article className="memory-page">
    <header>
      <h1 className="ui-title">Goals</h1>
      <p className="ui-hint">Pots with a target amount and date. The pace compares what you’ve saved with what you’d need by now.</p>
    </header>
    {goals.length === 0 ? <section className="ui-panel">
      <p>No goals yet. Give a pot a target amount and date in Plan.</p>
      <Link className="ui-button" href="/plan" prefetch={false}>Open Plan</Link>
    </section> : <ul className="memory-goals">
      {goals.map(goal => <li className="ui-panel memory-goal" key={goal.id}>
        <h2>{goal.name}</h2>
        <p className="ui-hint">{minorMoney(goal.savedMinor, goal.currency)} of {minorMoney(goal.targetMinor, goal.currency)} saved · by <time dateTime={goal.targetDate}>{mediumDate(goal.targetDate + "T00:00:00Z")}</time></p>
        <p>{goal.summary}</p>
        <Link className="ui-button" href={hrefFor({ type: "pot", id: goal.id })} prefetch={false} aria-label={"Edit " + goal.name + " in Plan"}>Edit in Plan</Link>
      </li>)}
    </ul>}
  </article>;
}
