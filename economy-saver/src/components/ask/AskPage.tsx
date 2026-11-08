"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { Canvas } from "@/components/canvas/Canvas";
import { ApiForm } from "@/components/ui/ApiForm";
import { ConfirmRemove } from "@/components/ui/ConfirmRemove";
import { DocumentCard, type CardForm } from "./DocumentCard";
import { readAskStream } from "./read-stream";
import { SESSION_ENDED, SessionEnded } from "./SessionEnded";
import { DOCUMENT_WORDS, type DocumentCard as Card } from "@/lib/reader/document-card";
import type { ResolvedBlock } from "@/lib/canvas/resolve";
import type { Recipe } from "@/lib/canvas/schema";
import type { Place } from "@/db/place";
import type { MemoryItem } from "@/lib/schema/memory";
import type { ConversationTurn, TurnKind } from "@/lib/schema/turn";
import {
  applyDeviceMemoryChanges, deleteDeviceConversation, deviceLatest, deviceMemory, deviceRecent, devicePins, listDevice, pinOnDevice, saveDeviceTurn, setDeviceThumb, updateDevicePin,
} from "@/lib/store/device";
import { DRAFT_EVENT, takeStoredDraft } from "./draft";
import { useSpeech } from "../voice/use-speech";
import "./ask.css";

export type TurnView = {
  id: string; question: string; kind: TurnKind; text: string; choices: string[] | null;
  sources: { label: string; href: string }[]; links: { label: string; href: string }[]; thumb: 1 | -1 | null; documentId: string | null;
};
export type Drawn = { key: string; title: string; recipe: Recipe; blocks: ResolvedBlock[] };
type Pin = { id: string; title: string };
type Places = { memory: Place; journal: Place; canvases: Place };

const viewOf = (turn: ConversationTurn): TurnView => ({
  id: turn.id, question: turn.question, kind: turn.kind, text: turn.reply, choices: turn.choices, sources: turn.sources, links: [], thumb: turn.thumb, documentId: turn.documentId ?? null,
});
const wordsOf = (error: unknown) => (error instanceof Error ? error.message : "Couldn’t use this device’s storage.");
/** Draws a recipe through the engine; the route reads the household's records and keeps nothing. */
async function drawOnServer(recipe: Recipe): Promise<ResolvedBlock[] | string> {
  try {
    const response = await fetch("/api/canvas/resolve", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ recipe }) });
    return response.ok ? (await response.json() as { blocks: ResolvedBlock[] }).blocks : response.status === 401 ? SESSION_ENDED : await response.text();
  } catch { return "Couldn’t reach your household. Try again."; }
}

const MAX_FILE_BYTES = 6 * 1024 * 1024;
const FILE_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
const DAY_MS = 24 * 60 * 60 * 1000;
/** A card is waiting while its file is being read or one of its readings still needs the person's OK. */
const isWaiting = (card: Card) => card.status === "reading" || card.items.some(item => item.status === "to_check");

const EXAMPLES = ["Am I OK until the end of the month?", "What if a client pays two weeks late?", "Where did last month go?"];

/**
 * Ask (D60): the conversation beside the canvas. The question box, the microphone and Enter-to-ask are here; the top bar only links to this
 * page. A reply is chosen by the server (answer, a clarifying question with buttons, or a fixed decline); a canvas comes with it when it helps.
 */
export function AskPage({ householdId, places, pinId, conversationId: initialConversation, turns: initialTurns, starters, shown, pin, firstUse, unavailable, form }: {
  householdId: string; form: CardForm; places: Places; pinId: string | null;
  conversationId: string; turns: TurnView[]; starters: Drawn[]; shown: Drawn | null; pin: Pin | null; firstUse: string | null; unavailable: string | null;
}) {
  // D59: a kind kept on this device is read from and written to this browser; the question carries what the server needs for it and the server keeps none of it.
  const onDevice = { memory: places.memory === "device", journal: places.journal === "device", canvases: places.canvases === "device" };
  const router = useRouter();
  const field = useRef<HTMLTextAreaElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const requestId = useRef("");
  // The text the id was first sent with: a retry reuses the id only for the same question.
  const requestText = useRef("");
  const [conversationId, setConversationId] = useState(initialConversation);
  const [turns, setTurns] = useState(initialTurns);
  const [canvas, setCanvas] = useState<Drawn | null>(shown);
  const [starter, setStarter] = useState(0);
  const [text, setText] = useState("");
  const [source, setSource] = useState<"manual" | "voice">("manual");
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState("");
  const [problem, setProblem] = useState(unavailable ?? "");
  const [intro, setIntro] = useState(firstUse);
  const [devicePin, setDevicePin] = useState<Pin | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [cards, setCards] = useState<Record<string, Card>>({});
  const turnsRef = useRef(turns);
  useEffect(() => { turnsRef.current = turns; }, [turns]);
  const attached = useRef<{ key: string; id: string } | null>(null);
  const docCanvases = useRef(0);
  const canvasChosen = useRef(false);
  const waiting = new Set(Object.values(cards).filter(isWaiting).map(card => card.documentId));

  // Conversations and pins kept on this device are read here, once: the newest conversation (under ten minutes old) and the canvas it or the pin shows.
  useEffect(() => {
    if (!onDevice.journal && !(onDevice.canvases && pinId)) return;
    let cancelled = false;
    (async () => {
      try {
        const pinned = onDevice.canvases && pinId ? (await devicePins(householdId)).find(item => item.id === pinId) : undefined;
        // The newest conversation's files are asked about first, so a reading still waiting keeps that conversation for 24 hours.
        const loaded: Record<string, Card> = {};
        let docShown = false;
        if (onDevice.journal) {
          const all = await listDevice(householdId, "journal");
          const newest = all.reduce<ConversationTurn | null>((best, turn) => (best === null || turn.createdAt > best.createdAt ? turn : best), null);
          if (newest && Date.now() - Date.parse(newest.createdAt) < DAY_MS) {
            const ids = all.filter(turn => turn.conversationId === newest.conversationId && turn.documentId).map(turn => turn.documentId as string);
            await Promise.all(ids.map(async documentId => {
              const response = await fetch(`/api/ask/document?id=${encodeURIComponent(documentId)}`, { cache: "no-store" }).catch(() => null);
              if (response?.ok) loaded[documentId] = (await response.json() as { card: Card }).card;
            }));
          }
        }
        const latest = onDevice.journal ? await deviceLatest(householdId, new Date(), new Set(Object.values(loaded).filter(isWaiting).map(card => card.documentId))) : null;
        const answered = onDevice.journal ? (await listDevice(householdId, "journal")).some(turn => turn.kind === "answer") : false;
        if (cancelled) return;
        if (latest) {
          setCards(loaded); setConversationId(latest.conversationId); setTurns(latest.turns.map(viewOf));
          const lastTurn = latest.turns[latest.turns.length - 1];
          const lastCard = lastTurn?.documentId ? loaded[lastTurn.documentId] : undefined;
          if (lastCard?.canvas && !pinned) { canvasChosen.current = true; docCanvases.current += 1; setCanvas({ key: `doc-${lastCard.documentId}-${docCanvases.current}`, title: lastCard.canvas.recipe.title, recipe: lastCard.canvas.recipe, blocks: lastCard.canvas.blocks }); docShown = true; }
        }
        if (answered) setIntro(null);
        if (pinned) setDevicePin({ id: pinned.id, title: pinned.title });
        const last = latest?.turns.findLast(turn => turn.recipe !== null);
        const recipe = pinned?.recipe ?? last?.recipe ?? null;
        const key = pinned ? `pin-${pinned.id}` : last?.id;
        if (recipe && key && !docShown) {
          const blocks = await drawOnServer(recipe);
          if (cancelled) return;
          if (typeof blocks === "string") setProblem(blocks); else setCanvas({ key, title: recipe.title, recipe, blocks });
        }
      } catch (error) { if (!cancelled) setProblem(wordsOf(error)); }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A character typed on the top bar arrives in sessionStorage (never in the address); it is read once and cleared.
  useEffect(() => {
    function takeDraft() {
      const draft = takeStoredDraft();
      if (!draft) return;
      setText(draft.text); setSource(draft.source); requestId.current = "";
      field.current?.focus();
      requestAnimationFrame(() => field.current?.setSelectionRange(draft.text.length, draft.text.length));
    }
    takeDraft();
    if (window.location.hash === "#ask") field.current?.focus();
    window.addEventListener(DRAFT_EVENT, takeDraft);
    return () => { window.removeEventListener(DRAFT_EVENT, takeDraft); };
  }, []);

  const speech = useSpeech(words => { setText(words); setSource("voice"); requestId.current = ""; });
  const listening = speech.listening;
  function speak() { setProblem(""); speech.start(); }

  function scrollToCanvas() {
    // On a phone the canvas sits below the conversation: bring it into view.
    requestAnimationFrame(() => { if (window.matchMedia("(max-width: 899px)").matches) canvasRef.current?.scrollIntoView({ block: "start", behavior: "smooth" }); });
  }
  function showDocumentCanvas(documentId: string, drawn: NonNullable<Card["canvas"]>, scroll = false) {
    docCanvases.current += 1;
    canvasChosen.current = true;
    setCanvas({ key: `doc-${documentId}-${docCanvases.current}`, title: drawn.recipe.title, recipe: drawn.recipe, blocks: drawn.blocks });
    if (scroll) scrollToCanvas();
  }
  /** Each card reports itself here; when the page has just opened on a document turn that already has a canvas, that canvas is the one shown. */
  function takeCard(card: Card) {
    setCards(current => (JSON.stringify(current[card.documentId]) === JSON.stringify(card) ? current : { ...current, [card.documentId]: card }));
    const last = turnsRef.current[turnsRef.current.length - 1];
    if (!canvasChosen.current && last?.documentId === card.documentId && card.canvas) showDocumentCanvas(card.documentId, card.canvas);
  }

  /** Attaches one file as its own turn and card; returns the sentence for a refusal, or null when it went through. */
  async function attachOne(file: File, note: string): Promise<string | null> {
    if (file.size > MAX_FILE_BYTES) return "Document exceeds the 6 MiB limit.";
    if (!FILE_TYPES.includes(file.type)) return "Select a PDF, JPEG, PNG or WebP file.";
    const key = `${file.name}|${file.size}|${file.lastModified}|${note}`;
    if (attached.current?.key !== key) attached.current = { key, id: crypto.randomUUID() };
    try {
      const body = new FormData();
      body.set("document", file); body.set("id", attached.current.id); body.set("conversationId", conversationId); body.set("text", note);
      const response = await fetch("/api/ask/document", { method: "POST", body });
      if (!response.ok) return response.status === 401 ? SESSION_ENDED : (await response.text()) || "Upload failed.";
      const { turn, card } = await response.json() as { turn: ConversationTurn; card: Card };
      attached.current = null;
      setCards(current => ({ ...current, [card.documentId]: card }));
      setTurns(current => [...current.filter(item => item.id !== turn.id), viewOf(turn)]);
      if (onDevice.journal) {
        try { await saveDeviceTurn(householdId, turn); } catch (error) { return wordsOf(error); }
      }
      return null;
    } catch { return "Couldn’t reach your household. Try again."; }
  }

  /** Several files go one after another, each its own turn and card; the typed note goes with the first, and a refused file does not stop the others. */
  async function attach(files: File[]) {
    if (files.length === 0 || busy) return;
    setBusy(true);
    setProblem("");
    const problems: string[] = [];
    let note = text.trim();
    for (const file of files) {
      const refused = await attachOne(file, note);
      if (refused === SESSION_ENDED) { problems.length = 0; problems.push(SESSION_ENDED); break; }
      if (refused) problems.push(files.length > 1 ? `${file.name}: ${refused}` : refused);
      else if (note || text) { note = ""; setText(""); setSource("manual"); requestId.current = ""; }
    }
    setProblem(problems.join(" "));
    setBusy(false);
  }

  async function ask(question: string, how: "manual" | "voice") {
    const trimmed = question.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setStep("");
    setProblem("");
    if (requestText.current !== trimmed) requestId.current = "";
    requestText.current = trimmed;
    requestId.current ||= crypto.randomUUID();
    const id = requestId.current;
    try {
      // The memory and the last turns kept on this device travel with the question and nowhere else.
      let memory: MemoryItem[] | undefined, recent: ConversationTurn[] | undefined;
      try {
        if (onDevice.memory) memory = await deviceMemory(householdId);
        if (onDevice.journal) recent = await deviceRecent(householdId, conversationId, new Date(), waiting);
      } catch (error) { setProblem(wordsOf(error)); return; }
      const response = await fetch("/api/ask", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, conversationId, text: trimmed, source: how, canvas: canvas?.recipe ?? null, ...(memory && { memory }), ...(recent && { recent }) }) });
      // A 503 carries a fixed message written for this box, such as a missing key.
      if (!response.ok) { setProblem(response.status === 401 ? SESSION_ENDED : response.status === 429 ? "Ask again in a minute." : response.status === 503 || response.status === 400 ? await response.text() : "Couldn’t check your household. Try again."); return; }
      const last = await readAskStream(response, setStep);
      if (!last) { setProblem("Couldn’t check your household. Try again."); return; }
      // An error line reads like the 503 it replaced; the same question keeps its id for a retry.
      if ("error" in last) { setProblem(last.error); return; }
      const reply = last.reply;
      requestId.current = "";
      setText(""); setSource("manual");
      setTurns(current => [...current.filter(turn => turn.id !== reply.id), { id: reply.id, question: trimmed, kind: reply.kind, text: reply.text, choices: reply.choices, sources: reply.sources, links: reply.links, thumb: null, documentId: null }]);
      setIntro(current => (onDevice.journal ? (reply.kind === "answer" ? null : current) : reply.firstUse));
      if (onDevice.journal) {
        try {
          await saveDeviceTurn(householdId, {
            version: 1, id: reply.id, conversationId, question: trimmed, kind: reply.kind, reply: reply.text, choices: reply.choices,
            recipe: reply.canvas?.recipe ?? null, sources: reply.sources, thumb: null, createdAt: new Date().toISOString(),
          });
        } catch (error) { setProblem(wordsOf(error)); }
      }
      if (onDevice.memory && reply.memoryChanges.length > 0) {
        try { await applyDeviceMemoryChanges(householdId, reply.memoryChanges); } catch (error) { setProblem(wordsOf(error)); }
      }
      if (reply.canvas) {
        canvasChosen.current = true;
        setCanvas({ key: reply.id, title: reply.canvas.recipe.title, recipe: reply.canvas.recipe, blocks: reply.canvas.blocks });
        scrollToCanvas();
      }
      if (reply.pending) router.refresh();
    } catch { setProblem("Couldn’t reach your household. Try again."); }
    finally { setBusy(false); setStep(""); }
  }

  async function thumb(turn: TurnView, which: 1 | -1) {
    const next = turn.thumb === which ? null : which;
    // On this device the thumb is kept here; the server only writes its content-free log line.
    if (onDevice.journal) {
      try { if (!await setDeviceThumb(householdId, turn.id, next)) return; } catch (error) { setProblem(wordsOf(error)); return; }
    }
    const response = await fetch("/api/ask/thumb", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: turn.id, thumb: next === 1 ? "up" : next === -1 ? "down" : null, ...(onDevice.journal && { device: true }) }) }).catch(() => null);
    if (response?.ok || onDevice.journal) setTurns(current => current.map(item => (item.id === turn.id ? { ...item, thumb: next } : item)));
  }

  function fresh() {
    speech.stop();
    setConversationId(crypto.randomUUID());
    setTurns([]); setCards({}); setCanvas(null); canvasChosen.current = false; attached.current = null; setText(""); setProblem(unavailable ?? ""); requestId.current = "";
    field.current?.focus();
  }

  const submit = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); void ask(text, source); };
  // Enter asks, Shift+Enter is a newline, and Enter that confirms an IME candidate (Japanese input) never asks.
  function enterAsks(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    if (text.trim() && !busy && !listening) event.currentTarget.form?.requestSubmit();
  }

  const showing = canvas ?? starters[starter] ?? null;
  const onStarters = canvas === null;
  async function pinHere(update: boolean) {
    if (!showing) return;
    try {
      if (update && devicePin) { if (!await updateDevicePin(householdId, devicePin.id, showing.recipe)) { setProblem("That canvas is no longer pinned on this device."); return; } }
      else await pinOnDevice(householdId, { title: showing.recipe.title, recipe: showing.recipe });
      router.push("/");
    } catch (error) { setProblem(wordsOf(error)); }
  }
  const pinFields = (recipe: Recipe) => <>
    <input type="hidden" name="recipe" value={JSON.stringify(recipe)} />
    <input type="hidden" name="returnTo" value="/" />
  </>;

  return <div className="ask-page">
    <section className="ask-conversation" aria-label="Conversation">
      <div className="ask-head">
        <h1 className="ui-title">Ask</h1>
        {turns.length > 0 && <button type="button" className="ui-button" onClick={fresh}>New conversation</button>}
      </div>
      {turns.length > 0 && onDevice.journal && <details className="ui-remove" open={confirmDelete} onToggle={event => setConfirmDelete(event.currentTarget.open)}>
        <summary aria-label="Delete this conversation">Delete</summary>
        <p>Delete this conversation? Its questions and answers are removed from this device for good. What the assistant remembers and your pinned canvases stay.</p>
        <div className="ui-remove-buttons">
          <button type="button" className="ui-button" onClick={() => setConfirmDelete(false)}>Keep</button>
          <button type="button" className="ui-button" onClick={() => void (async () => {
            try { await deleteDeviceConversation(householdId, conversationId); setConfirmDelete(false); fresh(); } catch (error) { setProblem(wordsOf(error)); }
          })()}>Delete</button>
        </div>
      </details>}
      {turns.length > 0 && !onDevice.journal && <ConfirmRemove kind="conversation" id={conversationId} label="this conversation" note="Its questions and answers are removed for good. What the assistant remembers and your pinned canvases stay." returnTo="/canvas" onDone={fresh} />}
      {turns.length === 0 && <div className="ask-empty">
        <p className="ui-hint">Ask in your own words about your money. Every number comes from your records.</p>
        <ul className="ask-examples">{EXAMPLES.map(example => <li key={example}><button type="button" className="ui-button" disabled={busy || unavailable !== null} onClick={() => void ask(example, "manual")}>{example}</button></li>)}</ul>
      </div>}
      <ol className="ask-turns" aria-live="polite">
        {turns.map(turn => <li key={turn.id} className="ask-turn">
          <p className="ask-question">{turn.question}</p>
          <p className={`ask-reply is-${turn.kind}`}>{turn.text}</p>
          {turn.kind === "document" && (turn.documentId
            ? <DocumentCard documentId={turn.documentId} initial={cards[turn.documentId] ?? null} form={form} onCard={takeCard}
              onCanvas={drawn => showDocumentCanvas(turn.documentId as string, drawn, true)} />
            : <p className="ui-hint">{DOCUMENT_WORDS.notKept}</p>)}
          {turn.kind === "clarify" && turn.choices && <div className="ask-choices">{turn.choices.map(choice =>
            <button key={choice} type="button" className="ui-button" disabled={busy} onClick={() => void ask(choice, "manual")}>{choice}</button>)}</div>}
          {turn.links.length > 0 && <div className="ask-links">{turn.links.map(link => <a key={link.href} className="ui-button primary" href={link.href}>{link.label}</a>)}</div>}
          {turn.sources.length > 0 && <p className="ask-sources ui-hint">Based on: {turn.sources.map((item, index) => <span key={item.href + item.label}>{index > 0 && ", "}<a href={item.href}>{item.label}</a></span>)}</p>}
          {turn.kind === "answer" && <div className="ask-thumbs">
            <button type="button" className="ui-button" aria-pressed={turn.thumb === 1} onClick={() => void thumb(turn, 1)}>Helpful</button>
            <button type="button" className="ui-button" aria-pressed={turn.thumb === -1} onClick={() => void thumb(turn, -1)}>Not helpful</button>
          </div>}
        </li>)}
      </ol>
      {busy && <p role="status" aria-live="polite" className="ui-hint">{step || "Checking your numbers…"}</p>}
      {(problem || speech.problem) && <p role="alert" className="ui-problem">{problem === SESSION_ENDED ? <SessionEnded /> : problem || speech.problem}</p>}
      {intro && <p className="ask-intro ui-hint">{intro}</p>}
      <form id="ask" className="ask-form" onSubmit={submit}>
        <label className="ui-field">Your question
          <textarea ref={field} maxLength={320} rows={3} value={text} required placeholder="What’s due this week? Can I spend ¥4,000?"
            onKeyDown={enterAsks}
            onChange={event => { setText(event.target.value); setSource("manual"); requestId.current = ""; }} />
        </label>
        <div className="ask-buttons">
          <button type="button" className="ui-button" disabled={busy} onClick={listening ? speech.stop : speak}>{listening ? "Stop listening" : "Use microphone"}</button>
          <label className={`ui-button ask-attach${busy ? " is-disabled" : ""}`}>Attach a bill
            <input type="file" multiple accept="image/jpeg,image/png,image/webp,application/pdf" disabled={busy}
              onChange={event => { const input = event.currentTarget; void attach(Array.from(input.files ?? [])).finally(() => { input.value = ""; }); }} />
          </label>
          <button className="ui-button primary" disabled={busy || listening || unavailable !== null}>{busy ? "Checking…" : "Ask"}</button>
        </div>
      </form>
    </section>
    <section className="ask-canvas" ref={canvasRef} aria-label="Canvas" tabIndex={-1}>
      {onStarters && <nav className="ask-starters" aria-label="Canvases to start from">
        {starters.map((item, index) => <button key={item.key} type="button" aria-pressed={index === starter} onClick={() => setStarter(index)}>{item.title}</button>)}
      </nav>}
      {showing && <Canvas key={showing.key} recipe={showing.recipe} initial={showing.blocks}>
        {onDevice.canvases ? <div className="ask-pin">
          {devicePin && canvas && <button type="button" className="ui-button primary" onClick={() => void pinHere(true)}>Save to this pin</button>}
          <button type="button" className="ui-button" onClick={() => void pinHere(false)}>Pin to Home</button>
          <p className="ui-hint">Pinned on this device only.</p>
        </div> : <div className="ask-pin">
          {pin && canvas && <ApiForm action="/api/canvases" className="ask-pin-form">
            <input type="hidden" name="kind" value="update" /><input type="hidden" name="id" value={pin.id} />{pinFields(canvas.recipe)}
            <button className="ui-button primary">Save to this pin</button>
          </ApiForm>}
          <ApiForm action="/api/canvases" className="ask-pin-form">
            <input type="hidden" name="kind" value="pin" /><input type="hidden" name="title" value={showing.recipe.title} />{pinFields(showing.recipe)}
            <button className="ui-button">Pin to Home</button>
          </ApiForm>
        </div>}
      </Canvas>}
    </section>
  </div>;
}
