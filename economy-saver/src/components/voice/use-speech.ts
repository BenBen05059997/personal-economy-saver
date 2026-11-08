"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

// The one way the app listens: a tap starts the browser's speech recognition, the final words go to `onText`. Nothing is sent anywhere from here.
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

export type SpeechState = { listening: boolean; problem: string; supported: boolean };

function recognitionOf(): (new () => Recognition) | undefined {
  const browser = window as SpeechWindow;
  return browser.SpeechRecognition ?? browser.webkitSpeechRecognition;
}

export function useSpeech(onText: (text: string) => void): SpeechState & { start: () => void; stop: () => void } {
  const [listening, setListening] = useState(false);
  const [problem, setProblem] = useState("");
  // false on the server render, read from the browser after hydration.
  const supported = useSyncExternalStore(() => () => {}, () => recognitionOf() !== undefined, () => false);
  const recognizer = useRef<Recognition | null>(null);
  const handler = useRef(onText);
  useEffect(() => { handler.current = onText; });
  useEffect(() => () => { recognizer.current?.abort(); }, []);

  // start() must call recognition.start() inside the tap handler itself: Safari refuses it after an await.
  const start = useCallback(() => {
    const Speech = recognitionOf();
    if (!Speech) { setProblem("This browser doesn’t offer speech recognition. Type your question below."); return; }
    const recognition = new Speech();
    recognizer.current = recognition;
    // Listen in the browser's own language, so a Japanese browser hears Japanese.
    recognition.lang = navigator.language;
    recognition.interimResults = false;
    recognition.onresult = event => {
      const transcript = event.results[0]?.[0]?.transcript;
      if (transcript) handler.current(transcript);
    };
    recognition.onerror = () => setProblem("Speech wasn’t captured. Try again or type below.");
    recognition.onend = () => { if (recognizer.current === recognition) recognizer.current = null; setListening(false); };
    try { recognition.start(); setListening(true); setProblem(""); }
    catch { recognizer.current = null; setProblem("Couldn’t start the microphone. Type below."); }
  }, []);

  const stop = useCallback(() => { recognizer.current?.abort(); }, []);

  return { listening, problem, supported, start, stop };
}
