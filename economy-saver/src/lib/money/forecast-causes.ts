import type { timeline } from "./runway";

type Event = ReturnType<typeof timeline>[number];

/** The last statement before the low and its day's confirmed outflows, provided no later payment replenished that statement. */
export function forecastCosts(events: readonly Event[], lowDate: string): Event[] {
  const due = events.filter(event => event.date === lowDate && event.amount < 0 && !event.pending && !event.uncounted);
  let index = -1;
  events.forEach((event, i) => { if (event.date < lowDate && event.kind === "statement" && event.amount < 0 && !event.pending) index = i; });
  if (index < 0) return due;
  const replenished = events.slice(index + 1).some(event => event.date <= lowDate && event.kind === "arrival" && event.amount > 0 && !event.pending);
  return replenished ? due : [events[index], ...due];
}
