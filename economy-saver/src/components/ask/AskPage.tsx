"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { Canvas } from "@/components/canvas/Canvas";
import { ApiForm } from "@/components/ui/ApiForm";
import type { ResolvedBlock } from "@/lib/canvas/resolve";
import type { Recipe } from "@/lib/canvas/schema";
import type { AskReply } from "@/db/ask";
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

const EXAMPLES = ["Am I OK until the end of the month?", "What if a client pays two weeks late?", "Where did last month go?"];

/**
 * Ask (D60): the conversation beside the canvas. The question box, the microphone and Enter-to-ask are here; the top bar only links to this
 * page. A reply is chosen by the server (answer, a clarifying question with buttons, or a fixed decline); a canvas comes with it when it helps.
 */
export function AskPage({ conversationId: initialConversation, turns: initialTurns, starters, shown, pin, firstUse, unavailable }: {
  conversationId: string; turns: TurnView[]; starters: Drawn[]; shown: Drawn | null; pin: Pin | null; firstUse: string | null; unavailable: string | null;
}) {
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
      const response = await fetch("/api/ask", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, conversationId, text: trimmed, source: how, canvas: canvas?.recipe ?? null }) });
      // A 503 carries a fixed message written for this box, such as a missing key or a spent daily allowance.
      if (!response.ok) { setProblem(response.status === 429 ? "Ask again in a minute." : response.status === 503 || response.status === 400 ? await response.text() : "Couldn’t check your household. Try again."); return; }
      const reply = await response.json() as AskReply;
      requestId.current = "";
      setText(""); setSource("manual");
      setTurns(current => [...current.filter(turn => turn.id !== reply.id), { id: reply.id, question: trimmed, kind: reply.kind, text: reply.text, choices: reply.choices, sources: reply.sources, links: reply.links, thumb: null }]);
      setIntro(reply.firstUse);
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
    const response = await fetch("/api/ask/thumb", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: turn.id, thumb: next === 1 ? "up" : next === -1 ? "down" : null }) }).catch(() => null);
    if (response?.ok) setTurns(current => current.map(item => (item.id === turn.id ? { ...item, thumb: next } : item)));
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
      {problem && <p role="alert" className="ask-problem">{problem}</p>}
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
        <div className="ask-pin">
          {pin && canvas && <ApiForm action="/api/canvases" className="ask-pin-form">
            <input type="hidden" name="kind" value="update" /><input type="hidden" name="id" value={pin.id} />{pinFields(canvas.recipe)}
            <button className="ui-button primary">Save to this pin</button>
          </ApiForm>}
          <ApiForm action="/api/canvases" className="ask-pin-form">
            <input type="hidden" name="kind" value="pin" /><input type="hidden" name="title" value={showing.recipe.title} />{pinFields(showing.recipe)}
            <button className="ui-button">Pin to Home</button>
          </ApiForm>
        </div>
      </Canvas>}
    </section>
  </div>;
}
