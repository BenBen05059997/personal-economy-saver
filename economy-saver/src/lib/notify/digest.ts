export type ReminderDigest = { title: string; body: string; url: string };

const TITLE = "Personal Economy Saver";
const LINES = {
  statement_due: "A card statement is due soon",
  bill_due: "A bill is due soon",
  late_client: "A client is past their usual payment day",
  goal_behind: "A goal is behind its pace",
  safe_below: "Safe to spend is below your rule",
  cancel_by: "A cancellation deadline is coming up",
} as const;
const MAX_LINES = 6;
const AMOUNT = /[−-]?[¥$]\d+(?:,\d{3})*(?:\.\d{2})?/gu;

function home(appUrl: string): string {
  const url = new URL("/", appUrl);
  if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) {
    throw new Error("APP_URL must be an HTTP or HTTPS address without credentials");
  }
  return url.href;
}

/** The only dynamic words sent out are money tokens from the engine's reason. Titles and names stay in the app. */
export function reminderDigest(findings: readonly { kind: string; reason: string }[], appUrl: string): ReminderDigest | null {
  const eligible = findings.filter(row => Object.hasOwn(LINES, row.kind));
  if (!eligible.length) return null;
  const lines = eligible.slice(0, MAX_LINES).map(row => {
    const label = LINES[row.kind as keyof typeof LINES];
    const amounts = (row.reason.slice(0, 500).match(AMOUNT) ?? []).filter(value => value.length <= 20).slice(0, 2);
    return amounts.length ? label + " (" + amounts.join(", ") + ")." : label + ".";
  });
  const more = eligible.length - lines.length;
  if (more) lines.push(more === 1 ? "1 more finding on Home." : more + " more findings on Home.");
  return { title: TITLE, body: lines.join("\n"), url: home(appUrl) };
}

export function testReminder(appUrl: string): ReminderDigest {
  return { title: TITLE, body: "Your test reminder arrived.", url: home(appUrl) };
}
