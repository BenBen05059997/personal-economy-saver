"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { Currency } from "@/lib/catalogue/types";
import type { Check, CheckChoice } from "@/lib/money/checks";
import { DOCUMENT_WORDS, needsForm as readingNeedsForm, type DocumentCard as Card, type DocumentCardItem } from "@/lib/reader/document-card";
import { ApiForm } from "@/components/ui/ApiForm";
import { SessionEnded } from "@/components/ui/SessionEnded";
import { guessedOwn, type OwnChoices } from "@/lib/reader/own-choices";
import { answerCheck, type CheckAnswers } from "@/components/reader/check-answers";
import { majorText, ReadingForm } from "@/components/reader/ReadingForm";
import { LoadingIndicator } from "@/components/ui/LoadingState";
import { WhoseFields, type WhosePerson } from "@/components/reader/WhoseFields";

export type CardForm = { today: string; homeCurrency: Currency; cards: { id: string; label: string }[]; own: OwnChoices; people: WhosePerson[] };

const POLL_MS = 2000, GIVE_UP_MS = 60_000;

/** D61: the card under a document turn in Ask. Every word on it is written by code. It reads (polling), asks each failed check one at a time, then offers Confirm, Edit and Don't add it for every item. */
export function DocumentCard({ documentId, initial, form, readOnly, returnTo, busy, onCard, onCanvas }: {
  documentId: string; initial: Card | null; form: CardForm; readOnly: boolean; returnTo: string; busy: boolean;
  onCard: (card: Card) => void; onCanvas: (canvas: NonNullable<Card["canvas"]>) => void;
}) {
  const [card, setCard] = useState<Card | null>(initial);
  const [gaveUp, setGaveUp] = useState(false);
  const [ended, setEnded] = useState(false);
  const started = useRef<number | null>(null);
  const callbacks = useRef({ onCard, onCanvas });
  useEffect(() => { callbacks.current = { onCard, onCanvas }; });

  async function load(afterPost = false) {
    try {
      const response = await fetch(`/api/ask/document?id=${encodeURIComponent(documentId)}`, { cache: "no-store" });
      if (response.status === 401) { setEnded(true); return; }
      if (!response.ok) return;
      const next = (await response.json() as { card: Card }).card;
      setCard(next);
      callbacks.current.onCard(next);
      if (afterPost && next.canvas) callbacks.current.onCanvas(next.canvas);
    } catch { /* the next poll or the next action asks again */ }
  }
  const loadRef = useRef(load);
  useEffect(() => { loadRef.current = load; });

  useEffect(() => { if (initial === null) void loadRef.current(); }, [initial]);

  // An Ask turn can change a reading waiting on this card (the agent's set_whose), so the card asks again when a turn ends.
  const wasBusy = useRef(busy);
  useEffect(() => {
    if (wasBusy.current && !busy) void loadRef.current();
    wasBusy.current = busy;
  }, [busy]);

  const reading = card?.status === "reading";
  useEffect(() => {
    if (!reading || gaveUp) return;
    started.current ??= Date.now();
    const poll = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - (started.current ?? Date.now()) > GIVE_UP_MS) { setGaveUp(true); return; }
      void loadRef.current();
    };
    const timer = window.setInterval(poll, POLL_MS);
    const visible = () => { if (document.visibilityState === "visible") poll(); };
    document.addEventListener("visibilitychange", visible);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", visible); };
  }, [reading, gaveUp]);

  if (card === null) return <p className="ui-hint ask-document">{ended ? <SessionEnded /> : <LoadingIndicator label="Opening…" />}</p>;
  const words = reading && gaveUp ? DOCUMENT_WORDS.stillReading : card.words;
  return <div className="ask-document">
    <p className="ask-document-words" aria-live="polite">{words}</p>
    {reading && gaveUp && <p className="ask-document-link"><Link prefetch={false} href="/to-check">To check</Link></p>}
    {card.status === "read" && card.items.length > 0 && <ul className="ask-document-items">
      {card.items.map(item => <li key={item.readingId} className="ask-document-item">
        {readOnly && item.status === "to_check"
          ? <><p className="ask-document-read">{item.read}</p><Link prefetch={false} href="/to-check">Open in To check ›</Link></>
          : <Item item={item} form={form} returnTo={returnTo} onDone={() => void load(true)} />}
      </li>)}
    </ul>}
  </div>;
}

function Item({ item, form, returnTo, onDone }: { item: DocumentCardItem; form: CardForm; returnTo: string; onDone: () => void }) {
  const [answers, setAnswers] = useState<CheckAnswers>({ kinds: [] });
  const [editing, setEditing] = useState<{ focus?: "amount" | "date" } | null>(null);
  const { value } = item;
  if (item.status !== "to_check") return <>
    <p className="ask-document-read">{item.read}</p>
    {item.saved ? <>
      <p className="ask-document-saved">{item.saved.words}</p>
      <p className="ask-document-places">{item.saved.links.map(link => <Link key={link.href} prefetch={false} href={link.href} className="ui-button primary">{link.label} ›</Link>)}</p>
    </> : <p className="ui-hint ask-document-status">{item.status === "confirmed" ? DOCUMENT_WORDS.added : DOCUMENT_WORDS.notAdded}</p>}
  </>;

  const next = item.checks.find(check => !answers.kinds.includes(check.kind));
  const answer = (check: Check, choice: CheckChoice) => {
    const step = choice.step;
    setAnswers(current => answerCheck(current, check.kind, choice));
    if (step.do === "edit") setEditing({ focus: step.field });
  };
  const hidden = <>
    <input type="hidden" name="from" value="ask" /><input type="hidden" name="returnTo" value={returnTo} />
    {answers.kinds.map(kind => <input key={kind} type="hidden" name="answered" value={kind} />)}
  </>;
  const preset = { repeat: answers.repeat ?? value.repeat ?? "", date: answers.date, amountUnknown: answers.amountUnknown, dueUnknown: answers.dueUnknown };
  const reading = { id: item.readingId, value, link: item.link };
  const needsForm = readingNeedsForm(value);
  const full = (focus?: "amount" | "date") => <ReadingForm key={`${answers.kinds.join()}-${focus ?? ""}`} reading={reading} today={form.today} homeCurrency={form.homeCurrency} cards={form.cards} own={form.own} people={form.people}
    hidden={hidden} preset={preset} focus={focus} onDone={onDone} />;

  return <>
    <p className="ask-document-read">{item.read}</p>
    {editing ? full(editing.focus)
      : next ? <div className="check-line ask-document-question" role="group" aria-label={next.words}>
        <p className="check-line-words">{next.words}</p>
        {next.choices.some(choice => choice.step.do === "dismiss") ? <ApiForm action="/api/confirm" onDone={onDone}>
          <input type="hidden" name="kind" value="reading" /><input type="hidden" name="id" value={item.readingId} /><input type="hidden" name="decision" value="reject" />{hidden}
          <Choices check={next} onChoose={answer} />
        </ApiForm> : <Choices check={next} onChoose={answer} />}
      </div>
      : needsForm ? full()
      : <ConfirmRow item={item} own={form.own} people={form.people} answers={answers} hidden={hidden} onEdit={() => setEditing({})} onDone={onDone} />}
  </>;
}

const SETTLE_MS = 400;

/** A new question replaces the last one under the pointer, so a second click meant for the answer just given must not pick on the next: clicks in the first moments of a question are ignored. */
function Choices({ check, onChoose }: { check: Check; onChoose: (check: Check, choice: CheckChoice) => void }) {
  const shown = useRef(0);
  useEffect(() => { shown.current = performance.now(); }, [check.kind]);
  const settled = (event: { timeStamp: number }) => event.timeStamp - shown.current >= SETTLE_MS;
  return <div className="check-line-choices ask-choices">{check.choices.map(choice => choice.step.do === "dismiss"
    ? <button key={choice.label} type="submit" className="ui-button" formNoValidate onClick={event => { if (!settled(event)) event.preventDefault(); }}>{choice.label}</button>
    : <button key={choice.label} type="button" className="ui-button" onClick={event => { if (settled(event)) onChoose(check, choice); }}>{choice.label}</button>)}</div>;
}

function ConfirmRow({ item, own, people, answers, hidden, onEdit, onDone }: { item: DocumentCardItem; own: OwnChoices; people: WhosePerson[]; answers: CheckAnswers; hidden: React.ReactNode; onEdit: () => void; onDone: () => void }) {
  const { value } = item;
  const bp = value.businessBp ?? 0;
  const share = bp <= 0 ? "personal" : bp >= 10000 ? "business" : "mixed";
  const amountUnknown = answers.amountUnknown === true, dueUnknown = answers.dueUnknown === true;
  const field = (name: string, text: string) => <input type="hidden" name={name} value={text} />;
  return <ApiForm action="/api/confirm" onDone={onDone} className="ask-document-confirm">
    {field("kind", "reading")}{field("id", item.readingId)}{field("target", value.kind)}{field("name", value.name ?? "")}
    {field("amount", amountUnknown ? "" : majorText(value))}{field("currency", value.currency ?? "")}{field("date", dueUnknown ? "" : answers.date ?? value.date ?? "")}
    {field("category", value.category ?? "")}{field("businessShare", share)}{share === "mixed" && field("businessPercent", String(bp / 100))}
    {field("ownCategory", guessedOwn(own, value.category ?? "", value.name ?? "")?.id ?? "")}{field("cardId", value.cardId ?? "")}{field("repeat", answers.repeat ?? value.repeat ?? "")}
    {amountUnknown && field("amountUnknown", "on")}{dueUnknown && field("dueUnknown", "on")}
    {hidden}
    {people.length >= 2 && <div className="ask-document-whose"><WhoseFields kind={value.kind} people={people} value={value.whose} /></div>}
    <div className="check-line-choices ask-choices">
      <button className="ui-button primary" name="decision" value="confirm">Confirm</button>
      <button type="button" className="ui-button" onClick={onEdit}>Edit</button>
      <button className="ui-button" name="decision" value="reject" formNoValidate>Don&rsquo;t add it</button>
    </div>
  </ApiForm>;
}
