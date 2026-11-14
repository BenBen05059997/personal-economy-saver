// The model never invents a number (D56): every money amount in an answer must appear in the question or in a tool result.
// Pure; no imports.

// A number with thousands separators and an optional decimal part.
const NUM = String.raw`\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?`;
// A scale after the number: 万 (10,000), k (1,000), million or M (1,000,000).
const SCALE = String.raw`(?:万|千|k(?![a-z])|million(?![a-z])|m(?![a-z]))`;
// A minus sign after the mark is ignored (¥-50,000 is the amount 50,000); a 万 may be followed by the rest: 1万8780.
const SIGN = String.raw`[-\u2212\u2013]?`;
// What follows a 万: 3千 and/or up to four more digits, with an optional grouped last three (1万8780, 5万8,000, 5万8千).
const TAIL = String.raw`((?:\d{1,4}千)?(?:\d{1,4}(?:,\d{3})?(?![\d,.]))?)`;
// A currency mark before (¥ ￥ $ US$) or a currency word after/before (yen 円 ドル JPY USD dollars).
const BEFORE = new RegExp(String.raw`(¥|￥|US\$|\$|\b(?:JPY|USD|yen|dollars?)\b\s*)\s*${SIGN}\s*(${NUM})(?:\s?(${SCALE})${TAIL})?`, "gi");
const AFTER = new RegExp(String.raw`(${NUM})(?:\s?(${SCALE})${TAIL})?\s*(円|ドル|\b(?:Japanese yen|US dollars?|yen|JPY|USD|dollars?)\b)`, "gi");

type Amount = { text: string; value: number; currency: "JPY" | "USD" };
const currencyOf = (mark: string): "JPY" | "USD" => /¥|￥|円|yen|jpy/i.test(mark) ? "JPY" : "USD";
const scaleOf = (mark?: string) => !mark ? 1 : mark === "万" ? 10_000 : mark === "千" || /^k/i.test(mark) ? 1_000 : 1_000_000;
/** What follows a 万, in yen: "8千" is 8000, "8780" and "8,780" are 8780. */
const tailValue = (tail: string) => {
  const thousands = /^(\d{1,4})千/.exec(tail);
  return (thousands ? Number(thousands[1]) * 1_000 : 0) + Number(tail.slice(thousands ? thousands[0].length : 0).replace(/,/g, "") || 0);
};
const scaled = (digits: string, mark?: string, tail?: string) =>
  Math.round((Number(digits.replace(/,/g, "")) * scaleOf(mark) + (mark === "万" && tail ? tailValue(tail) : 0)) * 100) / 100;
// Full-width digits, commas, dots and ￥ become ordinary ones.
const fold = (text: string) => text.normalize("NFKC");

function amountsIn(answer: string): Amount[] {
  const found: Amount[] = [];
  for (const m of fold(answer).matchAll(BEFORE)) found.push({ text: m[0].trim(), value: scaled(m[2], m[3], m[4]), currency: currencyOf(m[1]) });
  for (const m of fold(answer).matchAll(AFTER)) found.push({ text: m[0].trim(), value: scaled(m[1], m[2], m[3]), currency: currencyOf(m[4]) });
  return found;
}

// A JSON field whose number is money: any key ending in Minor (amountMinor, lowMinor, costMinor…) or one of the plain money names the tools use.
// Dates, ids, day counts (lateDays), percentages and basis points (businessBp) are never in this set.
const MONEY_KEY = /(?:Minor$)|^(?:minor|amount|amountUsd|amountHigh|cash|low|total|balance|limit|original|safeToSpend|short|gap|cost|fee|gross|landed|billed|price|saved)$/;

/** Numbers read from plain text (the question, the memory block): the person's own, so any number counts. Thousands separators removed (18,780 -> 18780), decimals kept, a 万 / k / M scale applied as an extra value (1.878万 -> 18780). */
function addPlainNumbers(text: string, set: Set<number>): void {
  // Grouped numbers first so "18,780" is one number, not 18 and 780. A group cannot start right after "digit," so list
  // items like [1,2,4000] stay 1, 2 and 4000 rather than 1 and "2,400".
  const found = new RegExp(String.raw`((?<!\d,)\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)(?:\s?(${SCALE})${TAIL})?`, "gi");
  for (const m of fold(text).matchAll(found)) {
    set.add(scaled(m[1])); // the plain number, read with the same rounding as the answer
    if (m[2]) set.add(scaled(m[1], m[2], m[3]));
  }
}

/** A tool result: only amounts count. A number counts when its JSON key says money; text inside a string counts only next to a currency mark or word. */
function addJsonAmounts(value: unknown, moneyKey: boolean, set: Set<number>): void {
  if (typeof value === "number") { if (moneyKey && Number.isFinite(value)) set.add(Math.round(Math.abs(value) * 100) / 100); return; }
  if (typeof value === "string") {
    if (moneyKey && /^-?\d[\d,]*(?:\.\d+)?$/.test(value.trim())) set.add(scaled(value.trim().replace(/^-/, "")));
    for (const amount of amountsIn(value)) set.add(amount.value);
    return;
  }
  if (Array.isArray(value)) { for (const item of value) addJsonAmounts(item, moneyKey, set); return; }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    // A fact (D79) with unit "money" and a numeric value is a confirmed amount in integer minor units; one the person gave confirms nothing.
    if (record.unit === "money" && typeof record.value === "number") {
      if (record.by !== "person" && Number.isFinite(record.value)) set.add(Math.round(Math.abs(record.value) * 100) / 100);
      return;
    }
    for (const [key, item] of Object.entries(record)) addJsonAmounts(item, MONEY_KEY.test(key), set);
  }
}

/** The numbers the sources confirm. A source that is a JSON object or array (a tool result) confirms only its amounts; any other text confirms every number in it. */
function sourceNumbers(sources: string[]): Set<number> {
  const set = new Set<number>();
  for (const source of sources) {
    let json: unknown;
    try { json = JSON.parse(source); } catch { json = undefined; }
    if (json !== null && typeof json === "object") addJsonAmounts(json, false, set); else addPlainNumbers(source, set);
  }
  return set;
}

/** The amounts written in `answer` that cannot be found in `sources` (the question plus every tool result of that Ask). */
export function unconfirmedAmounts(answer: string, sources: string[]): string[] {
  const known = sourceNumbers(sources);
  const unconfirmed: string[] = [];
  for (const amount of amountsIn(answer)) {
    if (amount.value === 0) continue;
    // Plain number, or minor units: JPY has none, USD cents are the number x 100 (source 120000 confirms $1,200).
    const minor = Math.round(amount.value * (amount.currency === "USD" ? 100 : 1));
    if (known.has(amount.value) || known.has(minor)) continue;
    if (!unconfirmed.includes(amount.text)) unconfirmed.push(amount.text);
  }
  return unconfirmed;
}

/**
 * The numbers a person said or typed (voice fill): "12,000" and "12000" are 12000, full-width digits read as ordinary ones,
 * "12万" / "12万円" is 120000, "1.5万" is 15000, "12万5千" is 125000, "3千" is 3000, "5k" is 5000, "1.2 million" is 1200000.
 * A number with a scale is returned only scaled (12万 does not also confirm 12). Decimals are kept, rounded to two places.
 */
export function numbersSaid(text: string): number[] {
  const folded = fold(text);
  const found = new RegExp(String.raw`((?<!\d,)\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)\s?(万|千|k(?![a-z])|million(?![a-z])|m(?![a-z]))?`, "gi");
  const said: number[] = [];
  let skipUntil = 0;
  for (const m of folded.matchAll(found)) {
    if (m.index < skipUntil) continue;
    const digits = Number(m[1].replace(/,/g, ""));
    let value = m[2] === "千" ? digits * 1_000 : digits * scaleOf(m[2]);
    let end = m.index + m[0].length;
    if (m[2] === "万") {
      // 12万5千 and 1万8780: the rest of the number follows the 万.
      const thousands = /^(\d{1,4})千/.exec(folded.slice(end));
      if (thousands) { value += Number(thousands[1]) * 1_000; end += thousands[0].length; }
      const tail = /^(\d{1,4})(?![\d,.])/.exec(folded.slice(end));
      if (tail) { value += Number(tail[1]); end += tail[0].length; }
    }
    skipUntil = end;
    said.push(Math.round(value * 100) / 100);
  }
  return said;
}

/** The part of a D79 fact the check reads. `value` is integer minor units for money, a count for days, a percentage for percent (12.2 is 12.2%), an ISO date string for date. */
export type CheckFact = {
  value: number | string;
  unit: string;
  currency?: string;
  by?: string;
  period?: string | { on?: string; from?: string; to?: string } | null;
};

const MONTH = String.raw`(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)`;
const monthNumber = (name: string) => ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(name.slice(0, 3).toLowerCase()) + 1;
const WEEKDAY = String.raw`(?:(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?,?\s+)?`;
type DateMention = { month?: number; day: number; year?: number };
// Forms a model writes: 2026-11-27, Fri, Nov 27 / Friday, November 27 / Nov. 27, 27 Nov / 27th of November, 11月27日, the 27th.
const DATE_FORMS: { re: RegExp; read: (m: RegExpExecArray) => DateMention }[] = [
  { re: /\b(\d{4})-(\d{2})-(\d{2})\b/g, read: m => ({ year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) }) },
  { re: new RegExp(String.raw`\b${WEEKDAY}${MONTH}\b\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b(?:,?\s+(\d{4})\b)?`, "gi"),
    read: m => ({ month: monthNumber(m[1]), day: Number(m[2]), year: m[3] ? Number(m[3]) : undefined }) },
  { re: new RegExp(String.raw`\b${WEEKDAY}(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?${MONTH}\b\.?(?:,?\s+(\d{4})\b)?`, "gi"),
    read: m => ({ month: monthNumber(m[2]), day: Number(m[1]), year: m[3] ? Number(m[3]) : undefined }) },
  { re: /(?:(\d{4})年\s*)?(\d{1,2})月\s*(\d{1,2})日/g, read: m => ({ year: m[1] ? Number(m[1]) : undefined, month: Number(m[2]), day: Number(m[3]) }) },
  { re: new RegExp(String.raw`\b${WEEKDAY}(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)\b`, "gi"), read: m => ({ day: Number(m[1]) }) },
];

function isoParts(text: string): DateMention[] {
  return [...text.matchAll(/(\d{4})-(\d{2})-(\d{2})/g)].map(m => ({ year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) }));
}

type Mention =
  | { unit: "money"; text: string; currency: "JPY" | "USD"; minor: number }
  | { unit: "percent" | "days"; text: string; value: number }
  | { unit: "date"; text: string; date: DateMention };

/** Every date, amount, percentage and day count written in `text`, each read once (a date is not also a day count, an amount is not also a percentage). */
function mentionsIn(text: string): Mention[] {
  let rest = fold(text);
  const blank = (m: RegExpMatchArray | RegExpExecArray) => { rest = rest.slice(0, m.index) + " ".repeat(m[0].length) + rest.slice(m.index! + m[0].length); };
  const out: Mention[] = [];
  // Dates first: "11月27日" and "27th" must not be read as days or money.
  for (const form of DATE_FORMS) {
    for (const m of [...rest.matchAll(form.re)] as RegExpExecArray[]) { out.push({ unit: "date", text: m[0].trim(), date: form.read(m) }); blank(m); }
  }
  const money: { text: string; value: number; currency: "JPY" | "USD"; match: RegExpMatchArray }[] = [];
  for (const m of rest.matchAll(BEFORE)) money.push({ text: m[0].trim(), value: scaled(m[2], m[3], m[4]), currency: currencyOf(m[1]), match: m });
  for (const m of rest.matchAll(AFTER)) money.push({ text: m[0].trim(), value: scaled(m[1], m[2], m[3]), currency: currencyOf(m[4]), match: m });
  for (const a of money) {
    blank(a.match);
    out.push({ unit: "money", text: a.text, currency: a.currency, minor: Math.round(a.value * (a.currency === "USD" ? 100 : 1)) });
  }
  for (const m of [...rest.matchAll(/(\d+(?:\.\d+)?)\s*%/g)]) { blank(m); out.push({ unit: "percent", text: m[0].trim(), value: Number(m[1]) }); }
  for (const m of [...rest.matchAll(/(\d+)\s*(?:days?\b|日(?!本))/gi)]) { blank(m); out.push({ unit: "days", text: m[0].trim(), value: Number(m[1]) }); }
  return out;
}

const sameDate = (a: DateMention, b: DateMention) => a.day === b.day && (a.month === undefined || b.month === undefined || a.month === b.month) && (a.year === undefined || b.year === undefined || a.year === b.year);

/** What a person's own fact or text says, as mentions of the same shapes. */
function factMention(f: CheckFact): Mention[] {
  if (typeof f.value === "number" && f.unit === "money") return [{ unit: "money", text: "", currency: f.currency === "USD" ? "USD" : "JPY", minor: Math.abs(f.value) }];
  if (typeof f.value === "number" && (f.unit === "days" || f.unit === "percent")) return [{ unit: f.unit, text: "", value: Math.abs(f.value) }];
  if (f.unit === "date") return isoParts(String(f.value)).map(date => ({ unit: "date" as const, text: "", date }));
  return [];
}

/**
 * The numbers in `text` that no engine fact of the same unit confirms: money, days, percent and dates alike (D79).
 * Only engine facts confirm. A number the person said (opts.person: the question, earlier questions, memory) or a by:"person"
 * fact (amount_tested) may be quoted back, and confirms exactly its own value in its own unit and nothing else.
 * Limit: matching is by value and unit, so the person's "¥40,000" also lets an answer say "¥40,000 left"; numbers alone cannot
 * tell a quote ("¥40,000 on Card A") from a claim. What the person said never lets any other number through.
 * A rounded form ("¥18.8k" for 18,780) is flagged: only the exact figure is a fact. `today` (ISO) counts as a known date.
 */
export function unconfirmedNumbers(text: string, facts: readonly CheckFact[], opts: { today?: string; person?: readonly string[] } = {}): string[] {
  const { today, person = [] } = opts;
  const engine = facts.filter(f => f.by !== "person");
  const of = (unit: string) => engine.filter(f => f.unit === unit);
  const quoted: Mention[] = [...person.flatMap(mentionsIn), ...facts.filter(f => f.by === "person").flatMap(factMention)];
  const quotedBack = (m: Mention) => quoted.some(q => q.unit === m.unit && (
    m.unit === "money" && q.unit === "money" ? q.minor === m.minor && q.currency === m.currency
    : m.unit === "date" && q.unit === "date" ? sameDate(q.date, m.date)
    : m.unit !== "money" && m.unit !== "date" && q.unit !== "money" && q.unit !== "date" && Math.abs(q.value - m.value) < (m.unit === "percent" ? 0.05 : 1)));

  // A date fact's value, and the period of any engine fact (the day a figure is on, or its range), are known dates.
  const knownDates: DateMention[] = [...(today ? isoParts(today) : [])];
  for (const f of of("date")) knownDates.push(...isoParts(String(f.value)));
  for (const f of engine) {
    const p = f.period;
    if (typeof p === "string") knownDates.push(...isoParts(p)); else if (p) knownDates.push(...isoParts(`${p.on ?? ""} ${p.from ?? ""} ${p.to ?? ""}`));
  }
  const moneyFacts = of("money"), percents = of("percent"), days = of("days");
  const out: string[] = [];
  for (const m of mentionsIn(text)) {
    let ok: boolean;
    if (m.unit === "date") ok = knownDates.some(k => sameDate(k, m.date));
    else if (m.unit === "money") ok = m.minor === 0 || moneyFacts.some(f => typeof f.value === "number" && Math.abs(f.value) === m.minor && (!f.currency || f.currency === m.currency));
    else if (m.unit === "percent") ok = percents.some(f => typeof f.value === "number" && Math.abs(Math.abs(f.value) - m.value) < 0.05);
    else ok = days.some(f => typeof f.value === "number" && Math.abs(f.value) === m.value);
    if (!ok && !quotedBack(m) && !out.includes(m.text)) out.push(m.text);
  }
  return out;
}
