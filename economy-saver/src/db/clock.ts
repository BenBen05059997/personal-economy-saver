import type { households } from "./schema";

/** The day every Try it household is anchored at (D34). */
export const DEMO_DATE = "2026-11-14";

type ClockHousehold = Pick<typeof households.$inferSelect, "isDemo" | "timeZone">;

/** The household's "today": the demo date for a demo household, otherwise the calendar date in its time zone. */
export function clockForHousehold(household: ClockHousehold, now = new Date()) {
  const today = household.isDemo ? DEMO_DATE : new Intl.DateTimeFormat("en-CA", {
    timeZone: household.timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
  return { today, timeZone: household.timeZone, isDemo: household.isDemo };
}

/** Wall-clock time of an instant in a time zone, as "YYYY-MM-DDTHH:MM:SS". */
function wallTime(instant: Date, timeZone: string) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(instant).map(part => [part.type, part.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
}

/**
 * When something recorded now happened, on the household's clock (D34). A real household's moment is the
 * real one. A demo household's is its anchor date at the current time of day in its time zone, so a fresh
 * event dates and sorts with the scenario instead of the real calendar.
 */
export function householdMoment(household: ClockHousehold, now = new Date()): Date {
  if (!household.isDemo) return now;
  const timeOfDay = wallTime(now, household.timeZone).slice(11);
  const wallAsUtc = Date.parse(`${DEMO_DATE}T${timeOfDay}Z`);
  // The zone's offset on the demo date: the wall time shown at that guess, read as UTC, minus the guess itself.
  const offset = Date.parse(`${wallTime(new Date(wallAsUtc), household.timeZone)}Z`) - wallAsUtc;
  return new Date(wallAsUtc - offset + now.getMilliseconds());
}
