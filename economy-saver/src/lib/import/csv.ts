// Reading a card or bank statement exported as CSV (D53). Pure: it runs in the browser on the file the person picked, and
// in the tests. Nothing here talks to the server; the route checks every row again before anything is saved.
// The steps: decode the bytes (UTF-8, or Shift_JIS which Japanese issuers use, and the preview says which), split the text
// into rows, find the header and guess the date, name and amount columns from their words (the person can change the
// picks), then read each row as a charge, a skipped credit or an unreadable row with the reason.
import { readAmount } from "@/lib/money/amount";
import { guessCategory } from "@/lib/money/categorise";
import type { CategoryKey } from "@/lib/money/categories";
import { normalise } from "@/lib/money/spending";

/** The largest file read: 1 MB. */
export const IMPORT_MAX_BYTES = 1_000_000;
/** The most rows one file may hold after the header. */
export const IMPORT_MAX_ROWS = 2_000;
/** Rows per post to /api/import; the route takes 1 to this many. */
export const IMPORT_BATCH = 500;
/** The longest merchant name kept; a longer one is cut to this length. */
export const MERCHANT_MAX = 160;

export type Encoding = "UTF-8" | "Shift_JIS";

/**
 * The text of a file, and the encoding it was in: UTF-8 when the bytes are valid UTF-8, otherwise Shift_JIS. Invalid UTF-8 is
 * the sign of a Shift_JIS file, so this is detection, and the preview names the one used. Refuses a file over the size limit.
 */
export function decodeStatement(bytes: ArrayBuffer | Uint8Array): { text: string; encoding: Encoding } | { problem: string } {
  if (bytes.byteLength > IMPORT_MAX_BYTES) return { problem: "This file is over 1 MB. Export a shorter period, for example three months, and import each file." };
  if (bytes.byteLength === 0) return { problem: "This file is empty." };
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), encoding: "UTF-8" };
  } catch {
    try {
      return { text: new TextDecoder("shift_jis", { fatal: true }).decode(bytes), encoding: "Shift_JIS" };
    } catch {
      return { problem: "This file is neither UTF-8 nor Shift_JIS text. Export the statement as CSV and try again." };
    }
  }
}

/** Splits CSV text into rows of cells: quoted cells with "" for a quote and line breaks inside, CRLF, LF or CR line ends, a leading BOM. Rows with no text are left out. */
export function parseCsv(text: string): string[][] {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const firstLine = source.slice(0, source.search(/\r|\n|$/));
  const delimiter = !firstLine.includes(",") && firstLine.includes("\t") ? "\t" : ",";
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false, i = 0;
  const endRow = () => { row.push(cell); cell = ""; if (row.some(c => c.trim() !== "")) rows.push(row); row = []; };
  while (i < source.length) {
    const ch = source[i];
    if (quoted) {
      if (ch === '"') {
        if (source[i + 1] === '"') { cell += '"'; i += 2; continue; }
        quoted = false; i++; continue;
      }
      cell += ch; i++; continue;
    }
    if (ch === '"' && cell.trim() === "") { cell = ""; quoted = true; i++; continue; }
    if (ch === delimiter) { row.push(cell); cell = ""; i++; continue; }
    if (ch === "\r" || ch === "\n") { endRow(); i += ch === "\r" && source[i + 1] === "\n" ? 2 : 1; continue; }
    cell += ch; i++;
  }
  if (cell !== "" || row.length) endRow();
  return rows;
}

export type Picks = { date: number | null; name: number | null; amount: number | null };

const KEYWORDS: Record<keyof Picks, string[]> = {
  date: ["日付", "利用日", "取引日", "date"],
  name: ["利用店名", "店名", "摘要", "内容", "description", "merchant", "details", "narrative"],
  amount: ["利用金額", "支払金額", "金額", "出金", "amount", "debit", "charge"],
};

/** The date, name and amount column of a header row, from the words in it; null where no column has one of the words. One column is used once. */
export function guessColumns(header: string[]): Picks {
  const cells = header.map(normalise);
  const taken = new Set<number>();
  const pick = (kind: keyof Picks): number | null => {
    for (const word of KEYWORDS[kind]) {
      const index = cells.findIndex((cell, i) => !taken.has(i) && cell.includes(word));
      if (index >= 0) { taken.add(index); return index; }
    }
    return null;
  };
  const date = pick("date"), amount = pick("amount"), name = pick("name");
  return { date, name, amount };
}

/** The header row: the first of the top ten rows in which all three columns are found (issuers often put a card name or a total above it), else the first row. */
export function findHeader(rows: string[][]): number {
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const p = guessColumns(rows[i]);
    if (p.date !== null && p.name !== null && p.amount !== null) return i;
  }
  return 0;
}

export type ReadRow = {
  line: number; // the row's number in the file, header included, counting from 1
  date: string; // YYYY-MM-DD
  merchant: string;
  amountMinor: number; // positive; the charge
  category: CategoryKey;
  problem?: string; // the row is unreadable, in words
  skipped?: "credit"; // a credit, refund, zero or empty amount: not a charge
};

export type ReadResult = { rows: ReadRow[]; readable: number; skipped: number; unreadable: number };

const validDate = (y: number, m: number, d: number) => {
  if (m < 1 || m > 12 || d < 1 || y < 1900 || y > 2999) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCMonth() !== m - 1) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
};

const YEAR_FIRST = /^(\d{4})[/\-.年](\d{1,2})[/\-.月](\d{1,2})日?$/;
const COMPACT = /^(\d{4})(\d{2})(\d{2})$/;
const YEAR_LAST = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/;

/** The day order of the file's day-month-year dates: "md" when a row has a second part over 12, "dm" when a first part is, null when no row tells (or rows disagree). */
function yearLastOrder(cells: string[]): "md" | "dm" | null {
  let md = false, dm = false;
  for (const cell of cells) {
    const m = YEAR_LAST.exec(cell);
    if (!m) continue;
    if (Number(m[1]) > 12) dm = true;
    if (Number(m[2]) > 12) md = true;
  }
  return md === dm ? null : md ? "md" : "dm";
}

const dateText = (cell: string) => cell.normalize("NFKC").trim().split(/\s+|T/)[0] ?? "";

/** Reads one date cell; `order` settles 11/05/2026 from the rest of the file. A time after the date is ignored. */
export function readDate(cell: string, order: "md" | "dm" | null): string | null {
  const text = dateText(cell);
  let m = YEAR_FIRST.exec(text) ?? COMPACT.exec(text);
  if (m) return validDate(Number(m[1]), Number(m[2]), Number(m[3]));
  m = YEAR_LAST.exec(text);
  if (!m) return null;
  const a = Number(m[1]), b = Number(m[2]), y = Number(m[3]);
  if (a === b) return validDate(y, a, b);
  const use = order ?? (a > 12 ? "dm" : b > 12 ? "md" : null);
  if (!use) return null;
  return use === "md" ? validDate(y, a, b) : validDate(y, b, a);
}

/** The merchant as kept: NFKC, spaces collapsed, at most 160 characters. */
export function cleanMerchant(cell: string): string {
  return cell.normalize("NFKC").replace(/\s+/g, " ").trim().slice(0, MERCHANT_MAX).trim();
}

/** Reads an amount cell in the household's currency: (500), ▲500, △500 and a trailing minus are negative, like -500. */
function readCellAmount(cell: string, currency: string): { minor: number } | { problem: string } | { empty: true } {
  let text = cell.normalize("NFKC").trim().replace(/\s+/g, "").replace(/\u2212/g, "-");
  if (text === "" || text === "-") return { empty: true };
  let negative = false;
  const paren = /^\((.*)\)$/.exec(text);
  if (paren) { negative = true; text = paren[1]; }
  if (/^[▲△]/.test(text)) { negative = true; text = text.slice(1); }
  if (/^[^-].*-$/.test(text)) { negative = true; text = text.slice(0, -1); }
  const read = readAmount(text, currency, true);
  if ("problem" in read) return read;
  return { minor: negative ? 0 - Math.abs(read.minor) : read.minor };
}

/**
 * Reads the rows under the header with the chosen columns: each is a charge (a positive amount), skipped (a credit, refund,
 * zero or an empty amount) or unreadable with the reason. Amounts follow the app's amount rules for `currency`
 * (lib/money/amount.ts); the category is the keyword table's guess from the merchant name.
 */
export function readRows(rows: string[][], picks: Picks, currency: string, firstLine = 2): ReadResult {
  const out: ReadRow[] = [];
  let readable = 0, skipped = 0, unreadable = 0;
  if (picks.date === null || picks.name === null || picks.amount === null) {
    const missing = (["date", "name", "amount"] as const).filter(k => picks[k] === null).map(k => k === "name" ? "shop or description" : k);
    return { rows: rows.map((_, i) => ({ line: firstLine + i, date: "", merchant: "", amountMinor: 0, category: "other", problem: `Choose the ${missing.join(" and ")} column` })), readable: 0, skipped: 0, unreadable: rows.length };
  }
  const { date: dateAt, name: nameAt, amount: amountAt } = picks;
  const order = yearLastOrder(rows.map(r => dateText(r[dateAt] ?? "")));
  rows.forEach((cells, i) => {
    const line = firstLine + i;
    const merchant = cleanMerchant(cells[nameAt] ?? "");
    const date = readDate(cells[dateAt] ?? "", order);
    const category = guessCategory(merchant).category;
    const base = { line, date: date ?? "", merchant, amountMinor: 0, category };
    const amount = readCellAmount(cells[amountAt] ?? "", currency);
    if ("empty" in amount || ("minor" in amount && amount.minor <= 0)) { skipped++; out.push({ ...base, skipped: "credit" }); return; }
    const problem = !date ? (dateText(cells[dateAt] ?? "") ? "The date can't be read as a day" : "No date")
      : !merchant ? "No shop or description"
      : "problem" in amount ? amount.problem : undefined;
    if (problem) { unreadable++; out.push({ ...base, problem }); return; }
    readable++;
    out.push({ ...base, amountMinor: (amount as { minor: number }).minor });
  });
  return { rows: out, readable, skipped, unreadable };
}

export type Statement = { header: string[]; headerIndex: number; body: string[][]; picks: Picks };

/** Splits decoded text into the header and the rows under it, with the guessed columns. Refuses a file with no rows or over the row limit. */
export function readStatement(text: string): Statement | { problem: string } {
  const rows = parseCsv(text);
  if (rows.length < 2) return { problem: "This file has no rows under a header. Export the statement as CSV and try again." };
  const headerIndex = findHeader(rows);
  const body = rows.slice(headerIndex + 1);
  if (!body.length) return { problem: "This file has no rows under a header. Export the statement as CSV and try again." };
  if (body.length > IMPORT_MAX_ROWS) return { problem: `This file has ${body.length.toLocaleString("en-US")} rows; up to ${IMPORT_MAX_ROWS.toLocaleString("en-US")} can be imported at once. Export a shorter period.` };
  return { header: rows[headerIndex], headerIndex, body, picks: guessColumns(rows[headerIndex]) };
}
