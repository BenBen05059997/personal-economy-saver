import { minorMoney } from "@/lib/money/format";
import type { Fact } from "@/lib/money/facts";

export type ReminderDigest = { title: string; body: string; url: string };

const TITLE = "Personal Economy Saver";
const LINES = {
  statement_due: "A card statement is due soon",
  bill_due: "A bill is due soon",
  invoice_nudge: "A client's payment is overdue",
  goal_behind: "A goal is behind its pace",
  safe_below: "Safe to spend is below your rule",
  cancel_by: "A cancellation deadline is coming up",
  tax_short: "A tax pot falls short of its bills",
} as const;
const MAX_LINES = 6;

function home(appUrl: string): string {
  const url = new URL("/", appUrl);
  if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) {
    throw new Error("APP_URL must be an HTTP or HTTPS address without credentials");
  }
  return url.href;
}

/** Keep the space name in plain words. Only the app supplies a link in a reminder. */
function spaceWords(name: string | null | undefined): string {
  if (!name) return "";
  const words = name.replace(/[\p{Cc}\p{Cf}]+/gu, " ").replace(/\s+/gu, " ").trim();
  return Array.from(words).slice(0, 60).join("")
    .replace(/(?<=[\p{L}\p{N}])[:：](?=\S)/gu, " ")
    .replace(/(?<=\S)[@＠](?=\S)/gu, " at ")
    .replace(/(?<=[\p{L}\p{N}])[.。．｡](?=[\p{L}\p{N}])/gu, " dot ");
}

export function reminderDigest(findings: readonly { kind: string; facts?: readonly Fact[]; spaceName?: string | null }[], appUrl: string): ReminderDigest | null {
  const eligible = findings.filter(row => Object.hasOwn(LINES, row.kind));
  if (!eligible.length) return null;
  const names = eligible.map(row => spaceWords(row.spaceName));
  const lines = eligible.slice(0, MAX_LINES).map((row, index) => {
    const label = LINES[row.kind as keyof typeof LINES];
    const amounts = (row.facts ?? []).filter(item => item.unit === "money" && item.currency && typeof item.value === "number")
      .slice(0, 2).map(item => minorMoney(item.value as number, item.currency!));
    const words = amounts.length ? label + " (" + amounts.join(", ") + ")." : label + ".";
    return names[index] ? words + " Space: " + names[index] + "." : words;
  });
  const more = eligible.length - lines.length;
  if (more) {
    lines.push(more === 1 ? "1 more finding on Home." : more + " more findings on Home.");
    const shown = new Set(names.slice(0, MAX_LINES));
    const others = [...new Set(names.slice(MAX_LINES).filter(name => name && !shown.has(name)))];
    if (others.length) lines.push("More findings in these spaces: " + others.join(", ") + ".");
  }
  return { title: TITLE, body: lines.join("\n"), url: home(appUrl) };
}

export function testReminder(appUrl: string): ReminderDigest {
  return { title: TITLE, body: "Your test reminder arrived.", url: home(appUrl) };
}
