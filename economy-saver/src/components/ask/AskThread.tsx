"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type MouseEvent, type ReactNode, type RefObject } from "react";
import Link from "next/link";
import { ConfirmRemove } from "@/components/ui/ConfirmRemove";
import { SessionEnded } from "@/components/ui/SessionEnded";
import { DocumentCard } from "./DocumentCard";
import { DraftCard } from "./DraftCard";
import { ReplyChip } from "./ReplyChip";
import { KeepOfferCard } from "./KeepOffer";
import { OpenSpaceProposal } from "./OpenSpaceProposal";
import { ASK_SCREEN_NAMES, type AskScreen } from "@/lib/agent/screen";
import { seeItButtons } from "@/lib/agent/see-it";
import { PROVIDERS } from "@/lib/ai/providers";
import { NEEDS_KEY_OWNER, NEEDS_KEY_MEMBER } from "@/lib/agent/availability";
import { SESSION_ENDED } from "@/lib/session-ended";
import { DOCUMENT_WORDS, type DocumentCard as Card } from "@/lib/reader/document-card";
import type { AskView } from "@/db/ask-view";
import type { DraftView, TurnView } from "@/lib/agent/view";
import type { TurnSource } from "@/lib/schema/turn";

const GREETING = "Hi. What can I help you with?";
/** Starter questions, each answerable at once without an ask-back (D60). */
const EXAMPLES = ["Am I OK until the end of the month?", "How much can I safely spend now?", "Where did last month go?", "What's coming up in the next two weeks?"];
const eyeProps = { width: 12, height: 12, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;

const SETTINGS_WORDS = "Settings → Your AI model";
/** A refusal that names Settings → Your AI model (the daily limit, a missing model) links those words to it. */
function withSettingsLink(words: string): ReactNode {
  const at = words.indexOf(SETTINGS_WORDS);
  if (at < 0) return words;
  return <>{words.slice(0, at)}<Link href="/settings/ai-model">{SETTINGS_WORDS}</Link>{words.slice(at + SETTINGS_WORDS.length)}</>;
}

/** The scrolling middle of Ask: the greeting and starter questions while empty, the turns with their cards, then the answer’s canvas drawn in the thread. */
export function AskThread({
  panel, screen, legacyId, space, spaceHref, householdId, clock, form, onDeviceMemory, turns, cards, readOnly, canWrite, incognito, busy, step, deviceReady,
  unavailable, noModel, problem, speechProblem, canvas, canvasRef, scrollRef,
  onAsk, onTakeCard, onDocumentCanvas, onThumb, onRemoveTurn, onRemoveLocalTurn, removeOnDevice, pinDevice, onKept, sourceDisplay, onNoteLink,
}: {
  panel: boolean; screen: AskScreen; legacyId: string | null; space: AskView["space"]; spaceHref: string; householdId: string; clock: AskView["clock"]; form: AskView["form"];
  onDeviceMemory: boolean; turns: TurnView[]; cards: Record<string, Card>; readOnly: boolean; canWrite: boolean; incognito: boolean; busy: boolean; step: string; deviceReady: boolean;
  unavailable: string | null; noModel: boolean; problem: string; speechProblem: string | null; canvas: ReactNode; canvasRef: RefObject<HTMLDivElement | null>; scrollRef: RefObject<HTMLDivElement | null>;
  onAsk: (question: string) => void; onTakeCard: (card: Card) => void; onDocumentCanvas: (documentId: string, drawn: NonNullable<Card["canvas"]>) => void;
  onThumb: (turn: TurnView, which: 1 | -1) => void; onRemoveTurn: (id: string) => void; onRemoveLocalTurn: (id: string) => void; removeOnDevice: boolean; pinDevice?: { householdId: string }; onKept: () => void;
  sourceDisplay: (item: TurnSource) => { href?: string; label: string }; onNoteLink?: (event: MouseEvent<HTMLAnchorElement>, href: string) => void;
}) {
  const keyProviders = PROVIDERS.filter(provider => provider.getKeyUrl);
  const { drafts, changed } = useDrafts(turns, busy);
  // A new turn scrolls the thread to its newest end; the first render keeps the top.
  const seen = useRef(turns.length);
  useEffect(() => {
    if (turns.length <= seen.current) { seen.current = turns.length; return; }
    seen.current = turns.length;
    const box = scrollRef.current;
    if (box) box.scrollTo({ top: box.scrollHeight, behavior: "smooth" });
  }, [turns.length, scrollRef]);
  return <div className="ask-scroll" ref={scrollRef}>
    {space.status === "archived" && <p className="ui-hint">Archived space</p>}
    {legacyId && <Link href={spaceHref} prefetch={false} className="ui-button">Back to General</Link>}
    {!readOnly && !deviceReady && !problem && <p className="ui-hint" role="status">Opening this space on this device…</p>}
    {panel && <p className="ask-screen-chip">
      <svg {...eyeProps}><path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" /><circle cx="8" cy="8" r="1.8" /></svg>
      Looking at {ASK_SCREEN_NAMES[screen]}
    </p>}
    {noModel && <div className="ask-key-card">
      <p className="ask-key-line">{unavailable}</p>
      {unavailable === NEEDS_KEY_OWNER && <>
        <p>fipa has no AI of its own here. Paste a key from {keyProviders.slice(0, -1).map(provider => provider.label).join(", ")} or {keyProviders[keyProviders.length - 1].label}. It is sealed when you save it and never shown in full again.</p>
        <div className="ask-key-actions">
          <Link className="ui-button primary" href="/settings/ai-model">Add your AI key</Link>
          <details><summary>Where do I get one?</summary><ul>{keyProviders.map(provider => <li key={provider.id}><a href={provider.getKeyUrl!} target="_blank" rel="noreferrer">{provider.label}</a></li>)}</ul></details>
        </div>
      </>}
    </div>}
    {!readOnly && deviceReady && turns.length === 0 && <div className="ask-empty">
      <p className="ask-reply ask-greeting">{GREETING}</p>
      <ul className="ask-examples">{EXAMPLES.map(example => <li key={example}><button type="button" className="ui-button primary" disabled={busy || unavailable !== null} onClick={() => onAsk(example)}>{example}</button></li>)}</ul>
    </div>}
    <ol className="ask-turns" aria-live="polite">
      {turns.map(turn => <li key={turn.id} className="ask-turn">
        <p className="ask-question">{turn.question}</p>
        <p className={`ask-reply is-${turn.kind}`}>{turn.text}</p>
        {(drafts[turn.id] ?? []).length > 0 && <>
          <ReplyChip drafts={drafts[turn.id]} />
          {drafts[turn.id].map(draft => <DraftCard key={draft.id} draft={draft} returnTo={spaceHref} canWrite={canWrite} device={pinDevice} onChanged={() => changed(turn.id)} />)}
        </>}
        {turn.incognito && <p className="ui-hint">Not saved</p>}
        {!readOnly && turn.openSpace && <OpenSpaceProposal name={turn.openSpace.name} hidden={incognito} />}
        {!readOnly && turn.offers?.map(offer => <KeepOfferCard key={JSON.stringify(offer)}
          offer={offer} householdId={householdId} clock={clock} currency={form.homeCurrency} deviceMemory={onDeviceMemory} returnTo={spaceHref} onDeviceMemoryKept={onKept} hidden={incognito} />)}
        {turn.kind === "document" && (turn.documentId
          ? <DocumentCard documentId={turn.documentId} initial={cards[turn.documentId] ?? null} form={form} readOnly={!canWrite} returnTo={spaceHref} onCard={onTakeCard} busy={busy}
            onCanvas={drawn => onDocumentCanvas(turn.documentId as string, drawn)} />
          : <p className="ui-hint">{DOCUMENT_WORDS.notKept}</p>)}
        {!readOnly && (!turn.incognito || incognito) && turn.kind === "clarify" && turn.choices && <div className="ask-choices">{turn.choices.map(choice =>
          <button key={choice} type="button" className="ui-button" disabled={busy} onClick={() => onAsk(choice)}>{choice}</button>)}</div>}
        {(drafts[turn.id] ?? []).length === 0 && <SeeIt links={turn.links} sources={turn.sources} sourceDisplay={sourceDisplay} onNoteLink={onNoteLink} />}
        {canWrite && !turn.incognito && turn.kind === "answer" && <div className="ask-thumbs">
          <button type="button" className="ui-button" aria-pressed={turn.thumb === 1} onClick={() => onThumb(turn, 1)}>Helpful</button>
          <button type="button" className="ui-button" aria-pressed={turn.thumb === -1} onClick={() => onThumb(turn, -1)}>Not helpful</button>
        </div>}
        {!incognito && !turn.incognito && <ConfirmRemove kind="data" what="journal" id={turn.id} label="this question and reply"
          returnTo={spaceHref} onDone={() => onRemoveTurn(turn.id)}
          onRemove={removeOnDevice ? () => onRemoveLocalTurn(turn.id) : undefined} />}
      </li>)}
    </ol>
    {busy && <p role="status" aria-live="polite" className="ui-hint">{step || "Checking your numbers…"}</p>}
    {(problem || speechProblem) && !(noModel && (problem === NEEDS_KEY_OWNER || problem === NEEDS_KEY_MEMBER)) && <p role="alert" className="ui-problem">{problem === SESSION_ENDED ? <SessionEnded /> : problem === NEEDS_KEY_OWNER
      ? <>{problem} <Link href="/settings/ai-model">Open Settings</Link></> : withSettingsLink(problem || speechProblem || "")}</p>}
    {canvas && <div className="ask-canvas" ref={canvasRef} tabIndex={-1} role="region" aria-label="Canvas">{canvas}</div>}
  </div>;
}

const POLL_MS = 5000;

/**
 * What each turn drafted, read from the rows now (D60). A turn loaded with the thread brings its drafts; a turn answered just now has none until this asks,
 * once its answer is in. While anything waits for the person's OK it asks again every few seconds, so a Confirm made in To check shows here too.
 */
function useDrafts(turns: TurnView[], busy: boolean) {
  const [fetched, setFetched] = useState<Record<string, DraftView[]>>({});
  const drafts: Record<string, DraftView[]> = {};
  for (const turn of turns) drafts[turn.id] = fetched[turn.id] ?? turn.drafts ?? [];
  const load = useCallback(async (ids: string[]) => {
    if (ids.length === 0) return;
    try {
      const response = await fetch(`/api/ask/drafts?ids=${ids.join(",")}`, { cache: "no-store" });
      if (!response.ok) return;
      const body = await response.json() as { drafts: Record<string, DraftView[]> };
      setFetched(current => ({ ...current, ...Object.fromEntries(ids.map(id => [id, body.drafts[id] ?? []])) }));
    } catch { /* the next turn or the next poll asks again */ }
  }, []);
  const unknown = turns.filter(turn => turn.drafts === undefined && !turn.incognito && fetched[turn.id] === undefined).map(turn => turn.id);
  const key = unknown.join(",");
  useEffect(() => {
    if (busy || !key) return;
    const timer = window.setTimeout(() => void load(key.split(",")), 0); // asked from a callback, never from the effect body
    return () => window.clearTimeout(timer);
  }, [busy, key, load]);
  const waiting = turns.filter(turn => drafts[turn.id].some(draft => draft.state === "waiting")).map(turn => turn.id);
  const waitingKey = waiting.join(",");
  // One timer at most: it exists only while something waits and the tab is shown, and a read still on its way is never joined by another.
  useEffect(() => {
    if (!waitingKey) return;
    let timer: number | null = null, reading = false, gone = false;
    const read = async () => {
      if (reading || gone || document.visibilityState !== "visible") return;
      reading = true;
      try { await load(waitingKey.split(",")); } finally { reading = false; }
    };
    const stop = () => { if (timer !== null) { window.clearInterval(timer); timer = null; } };
    const sync = () => {
      stop();
      if (gone || document.visibilityState !== "visible") return;
      void read();
      timer = window.setInterval(() => void read(), POLL_MS);
    };
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => { gone = true; stop(); document.removeEventListener("visibilitychange", sync); };
  }, [waitingKey, load]);
  // After Confirm or Don't add (the form refreshes the screen behind): this turn's rows again.
  const changed = useCallback((id: string) => { void load([id]); }, [load]);
  return { drafts, changed };
}

/** What ends an answer (D60): buttons to the pages where it can be seen, then any source that has no page as quiet text. */
function SeeIt({ links, sources, sourceDisplay, onNoteLink }: {
  links: TurnView["links"]; sources: TurnSource[]; sourceDisplay: (item: TurnSource) => { href?: string; label: string }; onNoteLink?: (event: MouseEvent<HTMLAnchorElement>, href: string) => void;
}) {
  const origin = useSyncExternalStore(() => () => {}, () => window.location.origin, () => "");
  const { buttons, quiet } = seeItButtons(links, sources.map(sourceDisplay), origin);
  return <>
    {buttons.length > 0 && <div className="ask-links">{buttons.map(button => <Link key={button.href} className="ui-button primary" href={button.href} prefetch={false}>{button.label}</Link>)}</div>}
    {quiet.length > 0 && <p className="ask-sources ui-hint">{buttons.length > 0 ? "Also based on" : "Based on"}: {quiet.map((item, index) => <span key={item.label + index}>
      {index > 0 && ", "}{item.href ? <a href={item.href} onClick={event => onNoteLink?.(event, item.href!)}>{item.label}</a> : item.label}
    </span>)}</p>}
  </>;
}
