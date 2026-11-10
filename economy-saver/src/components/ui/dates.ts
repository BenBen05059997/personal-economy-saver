const HOME = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", weekday: "short", timeZone: "UTC" });
const MEDIUM = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" });

/** Home's date line, "Sat Nov 14", for a day in UTC. */
export const homeDateLabel = (iso: string) => HOME.format(new Date(iso)).replace(",", "");

/** A day in the medium style, "Nov 14, 2026", for a day in UTC. */
export const mediumDate = (iso: string) => MEDIUM.format(new Date(iso));
