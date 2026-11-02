import { dayLabel } from "@/lib/money/format";
import { addDays, low, type Series } from "@/lib/money/runway";

export function RunwayChart({ balances, format }: { balances: Series; format: (n: number) => string }) {
  const minimum = low(balances);
  const floor = Math.min(0, minimum.amount);
  const ceiling = Math.max(0, ...balances);
  const last = balances.length - 1;
  const x = (day: number) => 1 + (98 * day) / last;
  const y = (balance: number) => 8 + 74 * (ceiling - balance) / Math.max(ceiling - floor, 1);
  const path = balances.map((value, i) => i === 0 ? `M${x(i)} ${y(value)}` : `H${x(i)} V${y(value)}`).join(" ");
  const caption = `${format(minimum.amount)} · ${dayLabel(minimum.date)}`;
  const start = addDays(minimum.date, -minimum.dayIndex);

  return <figure className="home-chart" aria-label={`30-day cash balance if clients pay late. Lowest point ${caption}.`}>
    <div className="home-plot" aria-hidden="true">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none">
        <path className="home-baseline" d={`M1 ${y(0)} H99`} />
        <path className="home-runway-line" d={path} />
      </svg>
      <span className="home-zero" style={{ top: `${y(0)}%` }}>{format(0)}</span>
      <span className={`home-low-dot ${minimum.amount < 0 ? "is-short" : ""}`} style={{ left: `${x(minimum.dayIndex)}%`, top: `${y(minimum.amount)}%` }} />
      <span className={`home-low-label ${minimum.amount < 0 ? "is-short" : ""}`} style={{ left: `clamp(5em, ${x(minimum.dayIndex)}%, 100% - 5em)`, top: `${y(minimum.amount)}%` }}>{caption}</span>
    </div>
    <figcaption aria-hidden="true"><span>{dayLabel(start)}</span><span>{dayLabel(addDays(start, last))}</span></figcaption>
  </figure>;
}
