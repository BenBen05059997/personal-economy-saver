"use client";

import { useMemo, useState, type ChangeEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { decodeStatement, IMPORT_BATCH, readRows, readStatement, type Encoding, type Picks, type Statement } from "@/lib/import/csv";
import { ownLabel } from "@/lib/money/own-category";
import { guessedOwn, type OwnChoices } from "@/lib/reader/own-choices";
import { dayLabel, minorMoney } from "@/lib/money/format";
import type { Currency } from "@/lib/catalogue/types";

const PREVIEW_ROWS = 20;
const ENCODING_WORDS: Record<Encoding, string> = { "UTF-8": "Read as UTF-8.", "Shift_JIS": "Read as Shift_JIS, the Japanese encoding most card issuers use." };
const COLUMN_WORDS: Record<keyof Picks, string> = { date: "Date column", name: "Shop or description column", amount: "Amount column" };

/**
 * Settings → Import a statement (D53). The file is read in the browser (lib/import/csv.ts): the preview names the encoding,
 * shows the three guessed columns as choices, the first 20 rows and the counts, and "Import N charges" posts the readable
 * rows to /api/import in batches of 500. Categories are the keyword table's guesses; the person changes them afterwards.
 */
export function ImportStatement({ cards, currency, own }: { cards: { id: string; label: string; lastClose: string }[]; currency: Currency; own: OwnChoices }) {
  const router = useRouter();
  const [cardId, setCardId] = useState(cards[0]?.id ?? "");
  const [file, setFile] = useState<{ name: string; encoding: Encoding; statement: Statement } | null>(null);
  const [picks, setPicks] = useState<Picks>({ date: null, name: null, amount: null });
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ added: number; skipped: number; label: string } | null>(null);
  const read = useMemo(() => file ? readRows(file.statement.body, picks, currency, file.statement.headerIndex + 2) : null, [file, picks, currency]);

  if (!cards.length) return <section className="ui-panel" id="import"><h2>Import a statement</h2>
    <p className="ui-hint">Bring in months of card spending from the CSV file your card issuer or bank lets you download. Add a card first. <Link href="#cards">Add a card ›</Link></p></section>;

  async function choose(event: ChangeEvent<HTMLInputElement>) {
    setProblem(""); setDone(null); setFile(null);
    const picked = event.target.files?.[0];
    if (!picked) return;
    const decoded = decodeStatement(await picked.arrayBuffer());
    if ("problem" in decoded) { setProblem(decoded.problem); return; }
    const statement = readStatement(decoded.text);
    if ("problem" in statement) { setProblem(statement.problem); return; }
    setFile({ name: picked.name, encoding: decoded.encoding, statement });
    setPicks(statement.picks);
  }

  /** D75: a shop whose name matches the latest confirmed item with an own category files itself under it; the preview shows it. */
  const ownFor = (category: string, merchant: string) => { const found = guessedOwn(own, category, merchant); return found ? { ownCategoryId: found.id } : {}; };

  async function importRows() {
    if (busy || !read) return;
    const rows = read.rows.filter(r => !r.problem && !r.skipped).map(({ date, merchant, amountMinor, category }) => ({ date, merchant, amountMinor, category, ...ownFor(category, merchant) }));
    setBusy(true); setProblem(""); setDone(null);
    let added = 0, skipped = 0;
    try {
      for (let i = 0; i < rows.length; i += IMPORT_BATCH) {
        const response = await fetch("/api/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cardId, rows: rows.slice(i, i + IMPORT_BATCH) }) });
        if (!response.ok) {
          const message = await response.text();
          setProblem(i ? `${message} The first ${i.toLocaleString("en-US")} rows were imported (${added} added); import the file again to add the rest. Rows already there are skipped.` : message);
          if (added) router.refresh();
          return;
        }
        const result = await response.json() as { added: number; skipped: number };
        added += result.added; skipped += result.skipped;
      }
      setDone({ added, skipped, label: cards.find(c => c.id === cardId)?.label ?? "the card" });
      setFile(null);
      router.refresh();
    } catch {
      setProblem(`Couldn’t reach the app. Check your connection and import the file again; rows already there are skipped.${added ? ` ${added} were added before it stopped.` : ""}`);
    } finally { setBusy(false); }
  }

  const card = cards.find(c => c.id === cardId);
  const header = file?.statement.header ?? [];
  const count = read?.readable ?? 0;
  return <section className="ui-panel settings-import" id="import"><h2>Import a statement</h2>
    <p className="ui-hint">Bring in months of card spending from the CSV file your card issuer or bank lets you download, so Plan shows where the money went. The file is read on this device; only the charges are sent. Up to 1 MB and 2,000 rows a file.</p>
    <label className="ui-field">Card<select value={cardId} onChange={event => setCardId(event.target.value)}>{cards.map(card => <option key={card.id} value={card.id}>{card.label}</option>)}</select></label>
    <label className="ui-field">Statement file (CSV)<input type="file" accept=".csv,text/csv" onChange={choose} disabled={busy} /></label>
    <p role="status" className="ui-hint">{problem}</p>
    {done && <p role="status" className="settings-import-done">{done.added ? `Added ${done.added} ${done.added === 1 ? "charge" : "charges"} to ${done.label}` : `Nothing new for ${done.label}`}{done.skipped ? ` (${done.skipped} already there)` : ""}. <Link href="/plan">See where the month goes on Plan ›</Link></p>}
    {file && read && <div className="settings-import-preview">
      <p className="ui-hint">{file.name}: {ENCODING_WORDS[file.encoding]}</p>
      <div className="settings-import-columns">{(Object.keys(COLUMN_WORDS) as (keyof Picks)[]).map(kind =>
        <label key={kind} className="ui-field">{COLUMN_WORDS[kind]}<select value={picks[kind] ?? ""} onChange={event => setPicks({ ...picks, [kind]: event.target.value === "" ? null : Number(event.target.value) })}>
          <option value="">Choose a column</option>
          {header.map((cell, i) => <option key={i} value={i}>{cell.trim() || `Column ${i + 1}`}</option>)}
        </select></label>)}</div>
      <p className="settings-import-counts">{count.toLocaleString("en-US")} {count === 1 ? "charge" : "charges"} to import · {read.skipped.toLocaleString("en-US")} skipped (credits, refunds or no amount) · {read.unreadable.toLocaleString("en-US")} unreadable</p>
      <div className="settings-import-scroll"><table className="settings-import-table">
        <thead><tr><th scope="col">Row</th><th scope="col">Date</th><th scope="col">Shop</th><th scope="col">Amount</th><th scope="col">Category</th></tr></thead>
        <tbody>{read.rows.slice(0, PREVIEW_ROWS).map(row => <tr key={row.line} className={row.problem || row.skipped ? "settings-import-out" : undefined}>
          <td>{row.line}</td><td>{row.date}</td><td>{row.merchant}</td>
          <td>{row.problem || row.skipped ? "" : minorMoney(row.amountMinor, currency)}</td>
          <td>{row.problem ?? (row.skipped ? "Skipped: credit or no amount" : ownLabel(row.category, guessedOwn(own, row.category, row.merchant)))}</td>
        </tr>)}</tbody>
      </table></div>
      {read.rows.length > PREVIEW_ROWS && <p className="ui-hint">The first {PREVIEW_ROWS} of {read.rows.length.toLocaleString("en-US")} rows.</p>}
      <p className="ui-hint">Categories are guessed from the shop names, and a shop you filed before goes under the same category of yours; change any later. A row already on this card (same date, amount and shop) is skipped, so importing a file twice adds nothing.</p>
      <p className="ui-hint">{card ? `Charges after ${card.label}’s last statement (closed ${dayLabel(card.lastClose)}) count toward what you owe now; older ones are history only.` : ""}</p>
      <button type="button" className="ui-button primary" disabled={busy || count === 0} onClick={importRows}>{busy ? "Importing…" : `Import ${count.toLocaleString("en-US")} ${count === 1 ? "charge" : "charges"}`}</button>
    </div>}
  </section>;
}
