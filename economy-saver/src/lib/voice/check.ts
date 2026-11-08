// Voice fill (28B): the model reads, the code checks (D61). Pure. Nothing here invents a value: a proposal is kept as it is, or dropped.
import { numbersSaid } from "@/lib/ai/number-check";
import { latestDate } from "@/lib/money/horizon";
import { readAmount } from "@/lib/money/amount";
import type { FieldSpec, VoiceFillRequest } from "./schema";

const DOLLARS = /[$＄]|ドル|\bdollars?\b|\busd\b/i;
const YEN = /[¥￥]|円|万|\byen\b|\bjpy\b/i;
const CURRENCY_WORD: Record<string, string> = { JPY: "yen", USD: "dollars" };

/** The words for an amount said in the other currency, or null when what was said fits the field. */
function currencyClash(said: string, currency: string): string | null {
  const dollars = DOLLARS.test(said), yen = YEN.test(said);
  if (currency === "JPY" && dollars && !yen) return "You said dollars; this field takes yen.";
  if (currency === "USD" && yen && !dollars) return "You said yen; this field takes dollars.";
  return null;
}

function amountValue(proposed: unknown, spec: Extract<FieldSpec, { kind: "amount" }>, said: string, notes: string[]): string | null {
  const text = typeof proposed === "number" ? String(proposed) : typeof proposed === "string" ? proposed : null;
  if (text === null || !text.trim()) return null;
  const clash = currencyClash(said, spec.currency);
  const read = readAmount(text, spec.currency, spec.signed ?? false);
  if ("problem" in read) {
    // A mark of the other currency in the proposal is the same mistake as saying it.
    notes.push(clash ?? (DOLLARS.test(text) || YEN.test(text) ? `This field takes ${CURRENCY_WORD[spec.currency] ?? spec.currency}.` : `${spec.label}: ${read.problem}.`));
    return null;
  }
  if (clash) { notes.push(clash); return null; }
  if (read.minor === 0) return null;
  const places = spec.currency === "USD" ? 100 : 1;
  const units = read.minor / places;
  // The number must have been said, in the field's own units (the unit as a whole number, or dollars and cents).
  if (!numbersSaid(said).some(n => Math.abs(n - Math.abs(units)) < 0.005)) {
    notes.push(`I didn't hear the amount for ${spec.label}, so it is left empty.`);
    return null;
  }
  return Number.isInteger(units) ? String(units) : units.toFixed(2);
}

function dateValue(proposed: unknown, spec: Extract<FieldSpec, { kind: "date" }>, today: string, notes: string[]): string | null {
  if (typeof proposed !== "string") return null;
  const date = proposed.trim();
  const real = /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(`${date}T00:00:00Z`)) && new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;
  if (!real) return null;
  const max = spec.max && spec.max < latestDate(today) ? spec.max : latestDate(today);
  if ((spec.min && date < spec.min) || date > max) {
    notes.push(`${spec.label}: that date is outside what this field takes, so it is left empty.`);
    return null;
  }
  return date;
}

/** The values to put in the form: only fields in the request, each one read by its kind and kept only when it passes. */
export function checkFill(proposed: Record<string, unknown>, request: VoiceFillRequest, today: string): { values: Record<string, string>; notes: string[] } {
  const values: Record<string, string> = {};
  const notes: string[] = [];
  for (const spec of request.fields) {
    if (!Object.hasOwn(proposed, spec.name)) continue;
    const value = proposed[spec.name];
    let kept: string | null = null;
    switch (spec.kind) {
      case "amount": kept = amountValue(value, spec, request.text, notes); break;
      case "date": kept = dateValue(value, spec, today, notes); break;
      case "select": kept = typeof value === "string" && spec.options.some(o => o.value === value) ? value : null; break;
      case "text": {
        const text = typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").trim() : "";
        kept = text && text.length <= (spec.maxLength ?? 160) ? text : null;
        break;
      }
      case "check": kept = value === true || value === "on" ? "on" : value === false || value === "" || value === "off" ? "" : null; break;
    }
    if (kept !== null) values[spec.name] = kept;
  }
  return { values, notes };
}
