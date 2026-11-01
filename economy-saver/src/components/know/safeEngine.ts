import { allFor, suggest } from "@/lib/catalogue/engine";
import type { Context, Profile, Suggestion } from "@/lib/catalogue/types";

// The catalogue files can be empty or half-written while they are being authored, and the
// engine throws on a malformed one. A card that cannot be built is better than a broken page.
function guard<T>(fallback: T, run: () => T): T {
  try {
    return run();
  } catch (err) {
    if (process.env.NODE_ENV !== "production") console.error("catalogue unavailable:", err);
    return fallback;
  }
}

// DECISIONS D6: the product is the daily money loop; the catalogue is secondary. These moves are parked
// (job-change moves, subsidies, self-back, sign-up bonuses, other abstract tax tricks) and never shown on screen.
export const PARKED: ReadonlySet<string> = new Set([
  // Japan
  "jp-self-back",
  "jp-card-signup-bonus",
  "jp-jizokuka-subsidy",
  "jp-ninin-keizoku",
  "jp-saishushoku-teate",
  "jp-nenkin-exemption",
  // United States
  "us-bank-signup-bonus",
  "us-card-signup-bonus",
]);

// DECISIONS D6: the "Coming up" strip shows only the one or two tax dates with real money attached.
export const COMING_UP: Record<Profile["region"], ReadonlySet<string>> = {
  JP: new Set(["jp-consumption-tax-election", "jp-yotei-nozei-reduction"]),
  US: new Set(["us-estimated-tax-quarterly"]),
};

const visible = (list: Suggestion[]) => list.filter((s) => !PARKED.has(s.move.id));

// The engine applies `limit` before we can drop parked moves, so ask for everything and cut afterwards.
export const safeSuggest = (p: Profile, c: Context, limit: number): Suggestion[] =>
  visible(guard<Suggestion[]>([], () => suggest(p, c, Number.MAX_SAFE_INTEGER))).slice(0, limit);

export const safeAllFor = (p: Profile, c: Context): Suggestion[] => visible(guard<Suggestion[]>([], () => allFor(p, c)));

/** The dates worth a strip of their own: the allowlisted moves whose deadline is near. */
export const safeComingUp = (p: Profile, c: Context): Suggestion[] =>
  safeSuggest(p, { ...c, moment: "deadline_near" }, Number.MAX_SAFE_INTEGER).filter((s) => COMING_UP[p.region].has(s.move.id));
