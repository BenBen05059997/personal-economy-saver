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
  if (value && typeof value === "object") for (const [key, item] of Object.entries(value)) addJsonAmounts(item, MONEY_KEY.test(key), set);
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
