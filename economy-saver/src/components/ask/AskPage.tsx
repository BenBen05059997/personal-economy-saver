"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { Canvas } from "@/components/canvas/Canvas";
import { ApiForm } from "@/components/ui/ApiForm";
import { ConfirmRemove } from "@/components/ui/ConfirmRemove";
import type { ResolvedBlock } from "@/lib/canvas/resolve";
import type { Recipe } from "@/lib/canvas/schema";
import type { AskReply } from "@/db/ask";
import type { Place } from "@/db/place";
import type { MemoryItem } from "@/lib/schema/memory";
import type { ConversationTurn } from "@/lib/schema/turn";
import {
  applyDeviceMemoryChanges, deleteDeviceConversation, deviceLatest, deviceMemory, deviceRecent, devicePins, listDevice, pinOnDevice, saveDeviceTurn, setDeviceThumb, updateDevicePin,
} from "@/lib/store/device";
import { DRAFT_EVENT, DRAFT_KEY } from "./draft";
import "./ask.css";

type Recognition = {
  lang: string;
  interimResults: boolean;
  onresult: null | ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void);
  onerror: null | (() => void);
  onend: null | (() => void);
  start(): void;
  abort(): void;
};
type SpeechWindow = Window & { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };


export type TurnView = {
  id: string; question: string; kind: "answer" | "clarify" | "declined"; text: string; choices: string[] | null;
  sources: { label: string; href: string }[]; links: { label: string; href: string }[]; thumb: 1 | -1 | null;
};
export type Drawn = { key: string; title: string; recipe: Recipe; blocks: ResolvedBlock[] };
type Pin = { id: string; title: string };
export type Places = { memory: Place; journal: Place; canvases: Place };

const viewOf = (turn: ConversationTurn): TurnView => ({
  id: turn.id, question: turn.question, kind: turn.kind, text: turn.reply, choices: turn.choices, sources: turn.sources, links: [], thumb: turn.thumb,
});
const wordsOf = (error: unknown) => (error instanceof Error ? error.message : "Couldn’t use this device’s storage.");
/** Draws a recipe through the engine; the route reads the household's records and keeps nothing. */
async function drawOnServer(recipe: Recipe): Promise<ResolvedBlock[] | string> {
  try {
    const response = await fetch("/api/canvas/resolve", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ recipe }) });
    return response.ok ? (await response.json() as { blocks: ResolvedBlock[] }).blocks : await response.text();
  } catch { return "Couldn’t reach your household. Try again."; }
}

const EXAMPLES = ["Am I OK until the end of the month?", "What if a client pays two weeks late?", "Where did last month go?"];

/**
 * Ask (D60): the conversation beside the canvas. The question box, the microphone and Enter-to-ask are here; the top bar only links to this
 * page. A reply is chosen by the server (answer, a clarifying question with buttons, or a fixed decline); a canvas comes with it when it helps.
 */
export function AskPage({ householdId, places, pinId, conversationId: initialConversation, turns: initialTurns, starters, shown, pin, firstUse, unavailable }: {
  householdId: string; places: Places; pinId: string | null;
  conversationId: string; turns: TurnView[]; starters: Drawn[]; shown: Drawn | null; pin: Pin | null; firstUse: string | null; unavailable: string | null;
}) {
  // D59: a kind kept on this device is read from and written to this browser; the question carries what the server needs for it and the server keeps none of it.
  const onDevice = { memory: places.memory === "device", journal: places.journal === "device", canvases: places.canvases === "device" };
  const router = useRouter();
  const field = useRef<HTMLTextAreaElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const recognizer = useRef<Recognition | null>(null);
  const requestId = useRef("");
  const [conversationId, setConversationId] = useState(initialConversation);
  const [turns, setTurns] = useState(initialTurns);
  const [canvas, setCanvas] = useState<Drawn | null>(shown);
  const [starter, setStarter] = useState(0);
  const [text, setText] = useState("");
  const [source, setSource] = useState<"manual" | "voice">("manual");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [problem, setProblem] = useState(unavailable ?? "");
  const [intro, setIntro] = useState(firstUse);
  const [devicePin, setDevicePin] = useState<Pin | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Conversations and pins kept on this device are read here, once: the newest conversation (under ten minutes old) and the canvas it or the pin shows.
  useEffect(() => {
    if (!onDevice.journal && !(onDevice.canvases && pinId)) return;
    let cancelled = false;
    (async () => {
      try {
        const pinned = onDevice.canvases && pinId ? (await devicePins(householdId)).find(item => item.id === pinId) : undefined;
        const latest = onDevice.journal ? await deviceLatest(householdId) : null;
        const answered = onDevice.journal ? (await listDevice(householdId, "journal")).some(turn => turn.kind === "answer") : false;
        if (cancelled) return;
        if (latest) { setConversationId(latest.conversationId); setTurns(latest.turns.map(viewOf)); }
        if (answered) setIntro(null);
        if (pinned) setDevicePin({ id: pinned.id, title: pinned.title });
        const last = latest?.turns.findLast(turn => turn.recipe !== null);
        const recipe = pinned?.recipe ?? last?.recipe ?? null;
        const key = pinned ? `pin-${pinned.id}` : last?.id;
        if (recipe && key) {
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
      try {
        const draft = window.sessionStorage.getItem(DRAFT_KEY);
        if (draft === null) return;
        window.sessionStorage.removeItem(DRAFT_KEY);
        setText(draft); setSource("manual"); requestId.current = "";
        field.current?.focus();
        requestAnimationFrame(() => field.current?.setSelectionRange(draft.length, draft.length));
      } catch { /* storage can be blocked */ }
    }
    takeDraft();
    if (window.location.hash === "#ask") field.current?.focus();
    window.addEventListener(DRAFT_EVENT, takeDraft);
    return () => { window.removeEventListener(DRAFT_EVENT, takeDraft); recognizer.current?.abort(); };
  }, []);

  function speak() {
    const browser = window as SpeechWindow;
    const Speech = browser.SpeechRecognition ?? browser.webkitSpeechRecognition;
    if (!Speech) { setProblem("This browser doesn’t offer speech recognition. Type your question below."); return; }
    const recognition = new Speech();
    recognizer.current = recognition;
    // Listen in the browser's own language, so a Japanese browser hears Japanese.
    recognition.lang = navigator.language;
    recognition.interimResults = false;
    recognition.onresult = event => {
      const transcript = event.results[0]?.[0]?.transcript;
      if (transcript) { setText(transcript); setSource("voice"); requestId.current = ""; }
    };
    recognition.onerror = () => setProblem("Speech wasn’t captured. Try again or type below.");
    recognition.onend = () => { recognizer.current = null; setListening(false); };
    try { recognition.start(); setListening(true); setProblem(""); }
    catch { setProblem("Couldn’t start the microphone. Type below."); }
  }

  async function ask(question: string, how: "manual" | "voice") {
    const trimmed = question.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setProblem("");
    requestId.current ||= crypto.randomUUID();
    const id = requestId.current;
    try {
      // The memory and the last turns kept on this device travel with the question and nowhere else.
      let memory: MemoryItem[] | undefined, recent: ConversationTurn[] | undefined;
      try {
        if (onDevice.memory) memory = await deviceMemory(householdId);
        if (onDevice.journal) recent = await deviceRecent(householdId, conversationId);
      } catch (error) { setProblem(wordsOf(error)); return; }
      const response = await fetch("/api/ask", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, conversationId, text: trimmed, source: how, canvas: canvas?.recipe ?? null, ...(memory && { memory }), ...(recent && { recent }) }) });
      // A 503 carries a fixed message written for this box, such as a missing key or a spent daily allowance.
      if (!response.ok) { setProblem(response.status === 429 ? "Ask again in a minute." : response.status === 503 || response.status === 400 ? await response.text() : "Couldn’t check your household. Try again."); return; }
      const reply = await response.json() as AskReply;
      requestId.current = "";
      setText(""); setSource("manual");
      setTurns(current => [...current.filter(turn => turn.id !== reply.id), { id: reply.id, question: trimmed, kind: reply.kind, text: reply.text, choices: reply.choices, sources: reply.sources, links: reply.links, thumb: null }]);
      setIntro(current => (onDevice.journal ? (reply.kind === "answer" ? null : current) : reply.firstUse));
      if (onDevice.journal && !reply.wait) {
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
        setCanvas({ key: reply.id, title: reply.canvas.recipe.title, recipe: reply.canvas.recipe, blocks: reply.canvas.blocks });
        // On a phone the canvas sits below the conversation: bring it into view.
        requestAnimationFrame(() => { if (window.matchMedia("(max-width: 899px)").matches) canvasRef.current?.scrollIntoView({ block: "start", behavior: "smooth" }); });
      }
      if (reply.pending) router.refresh();
    } catch { setProblem("Couldn’t reach your household. Try again."); }
    finally { setBusy(false); }
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
    recognizer.current?.abort();
    setConversationId(crypto.randomUUID());
    setTurns([]); setCanvas(null); setText(""); setProblem(unavailable ?? ""); requestId.current = "";
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
      {busy && <p role="status" className="ui-hint">Checking your numbers…</p>}
      {problem && <p role="alert" className="ui-problem">{problem}</p>}
      {intro && <p className="ask-intro ui-hint">{intro}</p>}
      <form id="ask" className="ask-form" onSubmit={submit}>
        <label className="ui-field">Your question
          <textarea ref={field} maxLength={320} rows={3} value={text} required placeholder="What’s due this week? Can I spend ¥4,000?"
            onKeyDown={enterAsks}
            onChange={event => { setText(event.target.value); setSource("manual"); requestId.current = ""; }} />
        </label>
        <div className="ask-buttons">
          <button type="button" className="ui-button" disabled={busy} onClick={listening ? () => recognizer.current?.abort() : speak}>{listening ? "Stop listening" : "Use microphone"}</button>
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
