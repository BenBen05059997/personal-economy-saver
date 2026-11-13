import { MonthList } from "@/components/spending/MonthSplit";
import { homeDateLabel } from "@/components/ui/dates";
import { PanelHint } from "@/components/ui/PanelHint";
import { Sentence } from "@/components/home/Sentence";
import { RankedBars } from "@/components/views/forms/RankedBars";
import { ViewPanel, type PanelQuestion } from "@/components/views/ViewPanel";
import { ViewTable } from "@/components/views/ViewTable";
import { homeSentence } from "@/lib/money/sentence";
import { monthByCategory } from "@/lib/money/month";
import { resolveView } from "@/lib/views/resolve";
import type { ViewContext, ViewResult } from "@/lib/views/types";
import "@/components/home/home.css";
import "./family.css";

const LOOKS = [["category", "Category"], ["person", "Person"]] as const;

/**
 * D52: the read-only family page, drawn by the same views as the app (D77). The month by Category or Person (Chart · Table, D74), who owes whom and the shared
 * bills coming up. No buttons, no forms, no Ask, Pin or File, no links into the signed-in app, nothing from PayPal and no emails: a view with nothing to
 * draw says so in words and never offers an Add.
 */
export function FamilyView({ name, context }: { name: string; context: ViewContext }) {
  const { state } = context;
  const date = homeDateLabel(state.today);
  const together = state.split.members.length >= 2;
  const people = state.split.members.map(({ id, name }) => ({ id, name }));
  const month = monthByCategory(context.spending!, state.today);
  const look = (by: "category" | "person") => resolveView("month_by_category", { by }, context) as ViewResult<"ranked_bars">;
  const headings = { category: <>Where this month goes <small className="spending-month-name">· {month.name}</small></>, person: "Who this month's spending belongs to" };
  const questions: PanelQuestion[] = (together ? LOOKS : LOOKS.slice(0, 1)).map(([by, label]) => {
    const result = look(by);
    return { key: by, label, result, heading: headings[by], figure: <RankedBars result={result} />, ...(by === "category" ? { tableSlot: <MonthList view={month} people={people} /> } : {}) };
  });
  const owes = resolveView("who_owes_whom", {}, context) as ViewResult<"ranked_bars">;
  const bills = resolveView("bills_calendar", { whose: "shared" }, context) as ViewResult<"calendar">;
  return <main className="family-page"><article className="money-home">
    <p className="home-note">{name} · family view</p>
    <time className="home-date" dateTime={state.today}>{date}</time>
    <h1><Sentence state={state} linked={false} /></h1>
    {homeSentence(state).note && <p className="home-sentence-note">{homeSentence(state).note}</p>}
    <div className="home-panels">
      <div className="home-column">
        {questions[0].result.empty
          ? <section id="family-month" className="home-panel"><h2>{headings.category}</h2><PanelHint className="home-empty">{questions[0].result.empty.words}</PanelHint></section>
          : <ViewPanel id="family-month" questions={questions} readOnly switchLabel="Look at it by" />}
        {together && (owes.empty
          ? <section id="shared-costs" className="home-panel"><h2>{owes.title}</h2><PanelHint className="home-empty">Nobody owes anyone anything.</PanelHint></section>
          : <ViewPanel id="family-owes" questions={[{ key: "owes", label: "Who owes whom", result: owes, figure: <RankedBars result={owes} /> }]} readOnly />)}
      </div>
      <div className="home-column">
        <section id="shared-bills" className="home-panel">
          <h2>Shared bills coming up</h2>
          {bills.empty || !bills.table
            ? <PanelHint className="home-empty">{together ? "No shared bills in the next 30 days." : "Nothing is shared in this household yet."}</PanelHint>
            : <><ViewTable table={bills.table} />{bills.line && <p className="view-line">{bills.line}</p>}</>}
        </section>
      </div>
    </div>
    <p className="family-note">This is a read-only view that {name} shared by link. Nothing can be changed from here.</p>
  </article></main>;
}
