// The one name normaliser and the name key (D53, D54): pure text, no dependencies, so repeat.ts, gaps.ts and spending.ts can all use it.

/**
 * The one text normaliser for names and queries (D53, D54): NFKC (full-width letters and digits become plain ones), lower
 * case, trimmed, runs of spaces made one. The search, the name key and anything that matches names by text use it.
 */
export function normalise(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

// Month and date words in a name (read after `normalise`, so lower case and ASCII digits). Each is one whole token, never part of a word.
const EN_MONTH = "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?";
const EDGE_BEFORE = "(?<![\\p{L}\\p{N}])", EDGE_AFTER = "(?![\\p{L}\\p{N}])";
const DATE_WORDS = [
  // 令和8年11月分, 2026年11月25日, 11月分, 11月度, 11月: an optional year (Western or era), the month, an optional day, an optional 分/度.
  /(?<!\p{N})(?:(?:令和|平成)\s*(?:\d{1,2}|元)\s*年\s*|\d{4}\s*年\s*)?\d{1,2}\s*月(?:\s*\d{1,2}\s*日)?(?:\s*[分度])?/gu,
  // 2026/11, 2026-11, 2026.11 and a full date 2026-11-25 or 2026/11/25.
  new RegExp(`${EDGE_BEFORE}\\d{4}[/.-]\\d{1,2}(?:[/.-]\\d{1,2})?${EDGE_AFTER}`, "gu"),
  // 11/2026 and 11/25/2026.
  new RegExp(`${EDGE_BEFORE}\\d{1,2}(?:/\\d{1,2})?/\\d{4}${EDGE_AFTER}`, "gu"),
  // nov, november, sept., "nov 2026", "november 25, 2026", "2026 nov".
  new RegExp(`${EDGE_BEFORE}(?:\\d{4}\\s+)?${EN_MONTH}(?:\\s+\\d{1,2}(?:st|nd|rd|th)?)?(?:,?\\s*\\d{4})?${EDGE_AFTER}`, "gu"),
];
// Company forms (D54). Japanese forms go wherever they stand (after NFKC ㈱ is already (株)); English ones only as whole tokens at the end.
const JP_FORMS = /株式会社|有限会社|合同会社|\(株\)|\(有\)|\(合\)/gu;
const EN_FORM_END = /(?:^|[\s,])(?:co|ltd|inc|llc|corp|k\.k|kk)\.?[\s.,]*$/u;
const SEPARATOR = "[\\s\\-–—・:,/|]";

/**
 * The key that says two bills or charges are the same cost (D54): `normalise`, then month and date words taken out
 * ("11月分", "2026年11月", "令和8年11月", "Nov", "November 2026", "2026/11", "2026-11", "11/2026"), brackets left empty
 * removed, separators left at either end (" - ", "・") dropped and doubled ones made one. So "Hikari Denki 10月分",
 * "Hikari Denki (11月分)" and "Hikari Denki" share a key, and "Rent" and "Rental car" do not. A name that is nothing but
 * a date keeps its normalised text as its key. Company forms go too: 株式会社, 有限会社, 合同会社, (株), ㈱ anywhere, and "Co.", "Ltd.", "Co., Ltd.", "Inc.",
 * "LLC", "Corp.", "K.K." as whole words at the end; then a trailing "." or ",". A name that is only a company form keeps its text. No transliteration:
 * "株式会社ヒカリ電気" and "Hikari Denki" are different keys.
 */
export function nameKey(label: string): string {
  const base = normalise(label);
  let key = base;
  for (const words of DATE_WORDS) key = key.replace(words, " ");
  const dated = key.trim();
  key = key.replace(JP_FORMS, " ").trim();
  for (let next = key.replace(EN_FORM_END, " ").trim(); next !== key; next = key.replace(EN_FORM_END, " ").trim()) key = next;
  if (key.replace(/[.,\s]+/gu, "") === "" && dated !== "") return base; // nothing but a company form
  key = key.replace(/[.,\s]+$/u, "")
    
    .replace(/\(\s*\)|\[\s*\]|【\s*】|「\s*」|〔\s*〕/gu, " ")
    .replace(new RegExp(`^${SEPARATOR}+|${SEPARATOR}+$`, "gu"), "")
    .replace(new RegExp(`\\s*([\\-–—・:,/|])(?:\\s*[\\-–—・:,/|])+\\s*`, "gu"), " $1 ")
    .replace(/\s+/g, " ")
    .trim();
  return key === "" ? base : key;
}
