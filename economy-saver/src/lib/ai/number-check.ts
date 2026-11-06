// The model never invents a number (D56): every money amount in an answer must appear in the question or in a tool result.
// Pure; no imports.

// A number with thousands separators and an optional decimal part.
const NUM = String.raw`\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?`;
// A scale after the number: 万 (10,000), k (1,000), million or M (1,000,000).
const SCALE = String.raw`(?:万|k(?![a-z])|million(?![a-z])|m(?![a-z]))`;
// A currency mark before (¥ ￥ $ US$) or a currency word after/before (yen 円 JPY USD dollars).
const BEFORE = new RegExp(String.raw`(¥|￥|US\$|\$|\b(?:JPY|USD|yen|dollars?)\b\s*)\s?(${NUM})(?:\s?(${SCALE}))?`, "gi");
const AFTER = new RegExp(String.raw`(${NUM})(?:\s?(${SCALE}))?\s?(円|\b(?:yen|JPY|USD|dollars?)\b)`, "gi");

type Amount = { text: string; value: number; currency: "JPY" | "USD" };
const currencyOf = (mark: string): "JPY" | "USD" => /¥|￥|円|yen|jpy/i.test(mark) ? "JPY" : "USD";
const scaleOf = (mark?: string) => !mark ? 1 : mark === "万" ? 10_000 : /^k/i.test(mark) ? 1_000 : 1_000_000;
const scaled = (digits: string, mark?: string) => Math.round(Number(digits.replace(/,/g, "")) * scaleOf(mark) * 100) / 100;
// Full-width digits, commas, dots and ￥ become ordinary ones.
const fold = (text: string) => text.normalize("NFKC");

function amountsIn(answer: string): Amount[] {
  const found: Amount[] = [];
  for (const m of fold(answer).matchAll(BEFORE)) found.push({ text: m[0].trim(), value: scaled(m[2], m[3]), currency: currencyOf(m[1]) });
  for (const m of fold(answer).matchAll(AFTER)) found.push({ text: m[0].trim(), value: scaled(m[1], m[2]), currency: currencyOf(m[3]) });
  return found;
}

/** Every number the sources contain, read with thousands separators removed (18,780 -> 18780), decimals kept (1200.50), and a 万 / k / M scale applied as an extra value (1.878万 -> 18780). */
function sourceNumbers(sources: string[]): Set<number> {
  const set = new Set<number>();
  // Grouped numbers first so "18,780" is one number, not 18 and 780. A group cannot start right after "digit," so list
  // items in JSON like [1,2,4000] stay 1, 2 and 4000 rather than 1 and "2,400".
  const found = new RegExp(String.raw`((?<!\d,)\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)(?:\s?(${SCALE}))?`, "gi");
  for (const source of sources) for (const m of fold(source).matchAll(found)) {
    set.add(scaled(m[1])); // the plain number, read with the same rounding as the answer
    if (m[2]) set.add(scaled(m[1], m[2]));
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
