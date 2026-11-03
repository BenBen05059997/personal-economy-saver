"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

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

export function AskPanel() {
  const router = useRouter();
  const panel = useRef<HTMLElement>(null);
  const recognizer = useRef<Recognition | null>(null);
  const requestId = useRef("");
  const [text, setText] = useState("");
  const [answer, setAnswer] = useState("");
  const [links, setLinks] = useState<{ label: string; href: string }[]>([]);
  const [source, setSource] = useState<"manual" | "voice">("manual");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);

  useEffect(() => {
    const element = panel.current;
    const stop = () => { if (!element?.matches(":popover-open")) recognizer.current?.abort(); };
    element?.addEventListener("toggle", stop);
    return () => { element?.removeEventListener("toggle", stop); recognizer.current?.abort(); };
  }, []);

  function speak() {
    const browser = window as SpeechWindow;
    const Speech = browser.SpeechRecognition ?? browser.webkitSpeechRecognition;
    if (!Speech) { setAnswer("This browser doesn’t offer speech recognition. Type your question below."); return; }
    const recognition = new Speech();
    recognizer.current = recognition;
    recognition.lang = "en-US";
    recognition.interimResults = false;
    recognition.onresult = event => {
      const transcript = event.results[0]?.[0]?.transcript;
      if (transcript) { setText(transcript); setSource("voice"); requestId.current = ""; }
    };
    recognition.onerror = () => setAnswer("Speech wasn’t captured. Try again or type below.");
    recognition.onend = () => { recognizer.current = null; setListening(false); };
    try { recognition.start(); setListening(true); setAnswer(""); }
    catch { setAnswer("Couldn’t start the microphone. Type below."); }
  }

  async function ask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!text.trim() || busy) return;
    setBusy(true);
    setAnswer("");
    setLinks([]);
    requestId.current ||= crypto.randomUUID();
    try {
      const response = await fetch("/api/ask", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: requestId.current, text, source }) });
      // A 503 carries a fixed message written for this box, such as a missing key or a spent daily allowance.
      if (!response.ok) { setAnswer(response.status === 429 ? "Ask again in a minute." : response.status === 503 ? await response.text() : "Couldn’t check your household. Try again."); return; }
      const result = await response.json() as { answer: string; pending: boolean; links: { label: string; href: string }[] };
      setAnswer(result.answer);
      setLinks(result.links);
      if (result.pending) router.refresh();
    } catch { setAnswer("Couldn’t reach your household. Try again."); }
    finally { setBusy(false); }
  }

  return <section id="shell-questions" ref={panel} popover="auto" className="shell-popover shell-ask-menu">
    <h2>Ask about your money</h2>
    <form onSubmit={ask}>
      <label className="ui-field">Your question
        <textarea maxLength={320} rows={3} value={text} required placeholder="What’s due this week? Can I afford ¥4,000 tonight?"
          onChange={event => { setText(event.target.value); setSource("manual"); requestId.current = ""; }} />
      </label>
      <button type="button" className="ui-button" disabled={busy} onClick={listening ? () => recognizer.current?.abort() : speak}>{listening ? "Stop listening" : "Use microphone"}</button>{" "}
      <button className="ui-button primary" disabled={busy || listening}>{busy ? "Checking…" : "Ask"}</button>
    </form>
    <p role="status">{busy ? "Checking your numbers…" : answer || "Ask in your own words: what’s due, whether you can afford something, or to draft an invoice."}</p>
    {links.map(link => <a key={link.href} className="ui-button primary" href={link.href}>{link.label}</a>)}
  </section>;
}
