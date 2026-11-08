"use client";

import { useRef, useState } from "react";
import { FORM_FETCH_HEADER } from "@/lib/form-fetch";
import type { FieldSpec, VoiceFillResponse } from "@/lib/voice/schema";
import { useSpeech } from "./use-speech";
import "./voice-fill.css";

// One utility for every form (D26, D42): put <VoiceFill /> inside a form and it describes that form's own fields at the moment of the tap.
// It fills what the route returns and never submits; the form's own button saves.
// It always renders, so the form never moves when the page wakes up; a browser without speech recognition says so on the tap (useSpeech).

type Control = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
const NAME = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;
const SKIPPED_INPUTS = new Set(["hidden", "file", "password", "button", "submit", "reset", "image", "radio"]);

function labelOf(control: Control): string {
  const label = control.labels?.[0];
  let words = "";
  if (label) {
    const copy = label.cloneNode(true) as HTMLElement;
    copy.querySelectorAll("input, select, textarea, small, button, .amount-sign").forEach(part => part.remove());
    words = copy.textContent ?? "";
  }
  return (words.trim() || control.getAttribute("aria-label") || "").trim().slice(0, 80);
}

function describe(form: HTMLFormElement): { specs: FieldSpec[]; controls: Map<string, Control> } {
  const specs: FieldSpec[] = [];
  const controls = new Map<string, Control>();
  for (const control of Array.from(form.elements)) {
    if (!(control instanceof HTMLInputElement || control instanceof HTMLSelectElement || control instanceof HTMLTextAreaElement)) continue;
    if (control instanceof HTMLInputElement && SKIPPED_INPUTS.has(control.type)) continue;
    if (control.matches(":disabled") || !NAME.test(control.name) || controls.has(control.name)) continue;
    if (control.closest('[data-voice="off"]')) continue;
    const label = labelOf(control);
    if (!label) continue;
    const required = control.required || undefined;
    let spec: FieldSpec;
    if (control instanceof HTMLSelectElement) {
      const options = Array.from(control.options).slice(0, 50).map(o => ({ value: o.value.slice(0, 200), label: o.text.trim().slice(0, 80) }));
      if (!options.length) continue;
      spec = { kind: "select", name: control.name, label, options, required };
    } else if (control instanceof HTMLInputElement && control.type === "checkbox") {
      spec = { kind: "check", name: control.name, label, required };
    } else if (control instanceof HTMLInputElement && control.type === "date") {
      spec = { kind: "date", name: control.name, label, min: control.min || undefined, max: control.max || undefined, required };
    } else if (control instanceof HTMLInputElement && control.dataset.voiceCurrency) {
      spec = { kind: "amount", name: control.name, label, currency: control.dataset.voiceCurrency, signed: control.dataset.voiceSigned !== undefined ? true : undefined, required };
    } else {
      spec = { kind: "text", name: control.name, label, maxLength: control.maxLength > 0 ? Math.min(control.maxLength, 1000) : undefined, required };
    }
    specs.push(spec);
    controls.set(control.name, control);
  }
  return { specs: specs.slice(0, 20), controls };
}

function setNative(control: Control, value: string) {
  const proto = control instanceof HTMLSelectElement ? HTMLSelectElement.prototype : control instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(control, value);
  control.dispatchEvent(new Event("input", { bubbles: true }));
  control.dispatchEvent(new Event("change", { bubbles: true }));
}

function fill(controls: Map<string, Control>, values: Record<string, string>, specs: FieldSpec[]): Control[] {
  // The first text field first: a bill's name drives its guessed repeat and category, which the later fields may then replace.
  const firstText = specs.find(s => s.kind === "text")?.name;
  const order = Object.keys(values).sort((a, b) => Number(b === firstText) - Number(a === firstText));
  const filled: Control[] = [];
  for (const name of order) {
    const control = controls.get(name);
    if (!control) continue;
    const value = values[name];
    if (control instanceof HTMLInputElement && control.type === "checkbox") {
      if (control.checked !== (value === "on")) control.click();
    } else setNative(control, value);
    filled.push(control);
  }
  return filled;
}

export function VoiceFill() {
  const button = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const [heard, setHeard] = useState("");
  const [notes, setNotes] = useState<string[]>([]);
  const [error, setError] = useState("");

  async function send(text: string) {
    const form = button.current?.form;
    if (!form) return;
    const { specs, controls } = describe(form);
    if (!specs.length) return;
    setBusy(true); setError(""); setNotes([]); setHeard("");
    try {
      const response = await fetch("/api/voice-fill", {
        method: "POST", headers: { "Content-Type": "application/json", [FORM_FETCH_HEADER]: "1" }, body: JSON.stringify({ text, fields: specs }),
      });
      if (!response.ok) { setError((await response.text()) || "Couldn’t fill the form right now. Type the fields instead."); return; }
      const result = (await response.json()) as VoiceFillResponse;
      for (const control of fill(controls, result.values, specs)) {
        control.classList.add("voice-filled");
        const clear = (event: Event) => { if (event.isTrusted) { control.classList.remove("voice-filled"); control.removeEventListener("input", clear); control.removeEventListener("change", clear); } };
        control.addEventListener("input", clear); control.addEventListener("change", clear);
      }
      setHeard(result.heard || text); setNotes(result.notes);
    } catch { setError("Couldn’t fill the form right now. Type the fields instead."); }
    finally { setBusy(false); }
  }

  const speech = useSpeech(words => { void send(words); });

  return <div className="voice-fill" data-voice="off">
    <button ref={button} type="button" className="ui-button voice-fill-button" aria-pressed={speech.listening} disabled={busy}
      onClick={() => { if (speech.listening) speech.stop(); else speech.start(); }}>
      <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v4" /></svg>
      {speech.listening ? "Listening… tap to stop" : busy ? "Filling…" : "Fill by voice"}
    </button>
    <div role="status" className="ui-hint voice-fill-status">
      {(error || speech.problem) && <p>{error || speech.problem}</p>}
      {heard && <p>Heard: “{heard}”</p>}
      {notes.map(note => <p key={note}>{note}</p>)}
    </div>
  </div>;
}
