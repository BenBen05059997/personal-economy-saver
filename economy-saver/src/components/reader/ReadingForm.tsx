"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Currency } from "@/lib/catalogue/types";
import type { Extracted } from "@/lib/reader/extract";
import type { LinkPreview } from "@/lib/money/varies";
import { CategoryFields } from "@/components/household/CategoryFields";
import { ScheduleFields, type Repeat } from "@/components/household/ScheduleFields";
import { ApiForm } from "@/components/ui/ApiForm";
import { minorMoney } from "@/lib/money/format";
import { monthName } from "@/lib/money/spending";
import { CorrectionOffer } from "./CorrectionOffer";
import { ReadingFields } from "./ReadingFields";

/** The amount as the form field shows it: whole yen, or dollars with cents; empty when not known. */
export function majorText(entry: Extracted) {
  if (entry.amountMinor === null || !entry.currency) return "";
  if (entry.currency === "JPY") return String(entry.amountMinor);
  return Math.floor(entry.amountMinor / 100) + "." + String(entry.amountMinor % 100).padStart(2, "0");
}

/**
 * D54: the one line a one-off bill reading carries when confirming it as read would link it to an amount-varies series:
 * "Sakura Gas for November — replaces the estimate of about ¥9,330." Worked out by `readerInbox` from the reading as proposed.
 */
function LinkLine({ link, today, homeCurrency }: { link: LinkPreview | null; today: string; homeCurrency: Currency }) {
  if (link === null) return null;
  const month = monthName(link.month) + (link.month.slice(0, 4) === today.slice(0, 4) ? "" : ` ${link.month.slice(0, 4)}`);
  return <p className="ui-hint reader-link">{link.biller} for {month} — {link.estimateMinor === null ? "counts toward its estimate." : `replaces the estimate of about ${minorMoney(link.estimateMinor, homeCurrency)}.`}</p>;
}

/**
 * The review form of one reading, shared by To check (through ReaderReview) and Ask (through DocumentCard): posts to /api/confirm.
 * It takes narrow, serializable props so a client component can render it. `checks` is the slot for To check's check lines, `hidden`
 * the slot for Ask's extra hidden inputs; `preset` carries what the person already answered in Ask; `focus` puts the cursor in the
 * amount or the date when the form opens.
 */
export function ReadingForm({ reading, today, homeCurrency, cards, checks, hidden, preset, focus, onDone }: {
  reading: { id: string; value: Extracted; link: LinkPreview | null };
  today: string; homeCurrency: Currency; cards: { id: string; label: string }[];
  checks?: ReactNode; hidden?: ReactNode;
  preset?: { repeat?: Repeat; date?: string; amountUnknown?: boolean; dueUnknown?: boolean };
  focus?: "amount" | "date";
  onDone?: () => void;
}) {
  const { id, value, link } = reading;
  const [repeat, setRepeat] = useState<Repeat | null>(preset?.repeat ?? null);
  const fields = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focus) fields.current?.querySelector<HTMLElement>(focus === "amount" ? "input[name=amount]" : "input[name=date]")?.focus();
  }, [focus]);
  return <ApiForm action="/api/confirm" onDone={onDone}>
    <input type="hidden" name="kind" value="reading" /><input type="hidden" name="id" value={id} />
    {hidden}
    <LinkLine link={link} today={today} homeCurrency={homeCurrency} />
    {checks}
    <div className="reader-fields" ref={fields}>
      <label className="ui-field">Entry<select name="target" defaultValue={value.kind}><option value="bill">Bill</option><option value="charge">Card charge</option></select></label>
      <label className="ui-field">Biller or merchant<input name="name" defaultValue={value.name ?? ""} required maxLength={160}/></label>
      <ReadingFields isBill={value.kind === "bill"} amount={majorText(value)} currency={value.currency ?? ""} date={preset?.date ?? value.date ?? ""} today={today}
        amountUnknown={preset?.amountUnknown} dueUnknown={preset?.dueUnknown} />
      {value.dateBasis && <small className="ui-hint reader-link">{value.dateBasis}. Check the date or type the day.</small>}
      {value.kind === "bill" && <details className="add-entry-more" open={Boolean(value.periodStart)}>
        <summary>Month this bill covers</summary>
        <label className="ui-field">First day<input name="periodStart" type="date" defaultValue={value.periodStart ?? ""} /></label>
        <label className="ui-field">Last day<input name="periodEnd" type="date" defaultValue={value.periodEnd ?? ""} /></label>
        <small className="ui-hint add-entry-hint">What the bill is for, like “11月分”. Information only: the forecast counts it on the due date.</small>
      </details>}
      {preset?.repeat !== undefined ? <ScheduleFields id={`reading-${id}`} today={today} chosen={repeat} onChoose={setRepeat} /> : <ScheduleFields id={`reading-${id}`} today={today} />}
      <CategoryFields name={value.name ?? ""} defaultCategory={value.category} defaultBp={value.businessBp ?? 0} />
      <label className="ui-field">Card for a charge<select name="cardId" defaultValue={value.cardId ?? ""}><option value="">Choose card</option>{cards.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>
    </div>
    <CorrectionOffer read={{ kind: value.kind, name: value.name, category: value.category, businessBp: value.businessBp, cardId: value.cardId }} cards={cards} />
    <div className="reader-buttons"><button className="ui-button primary" name="decision" value="confirm">Confirm reading</button><button className="ui-button" name="decision" value="reject" formNoValidate>Dismiss</button></div>
  </ApiForm>;
}
