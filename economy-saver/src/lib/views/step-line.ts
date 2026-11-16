// The step-line data for any set of day-by-day lines: forecast, what-if, tax ahead and the canvas's cash-flow chart all draw through this. Pure; integer minor units.
import type { Currency } from "@/lib/catalogue/types";
import { addDays } from "@/lib/money/dates";
import { longDay, minorMoney } from "@/lib/money/format";
import type { FormData } from "./types";

type StepLine = FormData["step_line"];
type StepInput = { startDate: string; currency: Currency; lines: StepLine["lines"]; band: StepLine["band"]; lowLine: string; sub: string[]; marks?: StepLine["marks"]; dayWords: StepLine["dayWords"]; direct: StepLine["direct"] };

/** Weekly x labels, the lowest point of `lowLine` with its words, and the rest as given. */
export function stepLine(input: StepInput): StepLine {
  const line = input.lines.find(l => l.key === input.lowLine) ?? input.lines[0], days = line.points.length;
  let index = 0;
  line.points.forEach((v, i) => { if (v < line.points[index]) index = i; });
  const minor = line.points[index], short = minor < 0, date = addDays(input.startDate, index), format = (m: number) => minorMoney(m, input.currency);
  const every = days <= 45 ? 7 : days <= 90 ? 14 : 28;
  const xTicks = Array.from({ length: Math.ceil(days / every) }, (_, k) => k * every).filter(i => i < days).map(i => ({ index: i, label: i === 0 ? "Today" : longDay(addDays(input.startDate, i)).slice(5) }));
  return {
    days, startDate: input.startDate, xTicks, lines: input.lines, band: input.band,
    low: { line: line.key, index, minor, label: `${short ? `Short ${format(-minor)}` : `Lowest ${format(minor)}`} on ${longDay(date)}`, short, sub: input.sub },
    marks: input.marks ?? [], dayWords: input.dayWords, direct: input.direct,
  };
}
