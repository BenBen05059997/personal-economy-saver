"use client";

import { useEffect, useRef, type MouseEvent, type ReactNode, type RefObject } from "react";
import Link from "next/link";
import { ConfirmRemove } from "@/components/ui/ConfirmRemove";
import { SessionEnded } from "@/components/ui/SessionEnded";
import { DocumentCard } from "./DocumentCard";
import { KeepOfferCard } from "./KeepOffer";
import { OpenSpaceProposal } from "./OpenSpaceProposal";
import { ASK_SCREEN_NAMES, type AskScreen } from "@/lib/agent/screen";
import { PROVIDERS } from "@/lib/ai/providers";
import { NEEDS_KEY_OWNER, NEEDS_KEY_MEMBER } from "@/lib/agent/availability";
import { SESSION_ENDED } from "@/lib/session-ended";
import { DOCUMENT_WORDS, type DocumentCard as Card } from "@/lib/reader/document-card";
import type { AskView } from "@/db/ask-view";
import type { TurnView } from "@/lib/agent/view";
import type { TurnSource } from "@/lib/schema/turn";

const EXAMPLES = ["Am I OK until the end of the month?", "What if a client pays two weeks late?", "Where did last month go?"];
const eyeProps = { width: 12, height: 12, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;

/** The scrolling middle of Ask: the examples while empty, the turns with their cards, then the answer’s canvas drawn in the thread. */
export function AskThread({
  panel, screen, legacyId, space, spaceHref, householdId, clock, form, onDeviceMemory, turns, cards, readOnly, canWrite, incognito, busy, step, deviceReady,
  unavailable, noModel, problem, speechProblem, canvas, canvasRef, scrollRef,
  onAsk, onTakeCard, onDocumentCanvas, onThumb, onRemoveTurn, onRemoveLocalTurn, removeOnDevice, onKept, sourceDisplay, onNoteLink,
}: {
  panel: boolean; screen: AskScreen; legacyId: string | null; space: AskView["space"]; spaceHref: string; householdId: string; clock: AskView["clock"]; form: AskView["form"];
  onDeviceMemory: boolean; turns: TurnView[]; cards: Record<string, Card>; readOnly: boolean; canWrite: boolean; incognito: boolean; busy: boolean; step: string; deviceReady: boolean;
  unavailable: string | null; noModel: boolean; problem: string; speechProblem: string | null; canvas: ReactNode; canvasRef: RefObject<HTMLDivElement | null>; scrollRef: RefObject<HTMLDivElement | null>;
  onAsk: (question: string) => void; onTakeCard: (card: Card) => void; onDocumentCanvas: (documentId: string, drawn: NonNullable<Card["canvas"]>) => void;
  onThumb: (turn: TurnView, which: 1 | -1) => void; onRemoveTurn: (id: string) => void; onRemoveLocalTurn: (id: string) => void; removeOnDevice: boolean; onKept: () => void;
  sourceDisplay: (item: TurnSource) => { href?: string; label: string }; onNoteLink?: (event: MouseEvent<HTMLAnchorElement>, href: string) => void;
}) {
  const keyProviders = PROVIDERS.filter(provider => provider.getKeyUrl);
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
      <p className="ask-try">Try asking</p>
      <ul className="ask-examples">{EXAMPLES.map(example => <li key={example}><button type="button" className="ui-button" disabled={busy || unavailable !== null} onClick={() => onAsk(example)}>{example}</button></li>)}</ul>
    </div>}
    <ol className="ask-turns" aria-live="polite">
      {turns.map(turn => <li key={turn.id} className="ask-turn">
        <p className="ask-question">{turn.question}</p>
        <p className={`ask-reply is-${turn.kind}`}>{turn.text}</p>
        {turn.incognito && <p className="ui-hint">Not saved</p>}
        {!readOnly && turn.openSpace && <OpenSpaceProposal name={turn.openSpace.name} hidden={incognito} />}
        {!readOnly && turn.offers?.map(offer => <KeepOfferCard key={JSON.stringify(offer)}
          offer={offer} householdId={householdId} clock={clock} currency={form.homeCurrency} deviceMemory={onDeviceMemory} returnTo={spaceHref} onDeviceMemoryKept={onKept} hidden={incognito} />)}
        {turn.kind === "document" && (turn.documentId
          ? <DocumentCard documentId={turn.documentId} initial={cards[turn.documentId] ?? null} form={form} readOnly={!canWrite} returnTo={spaceHref} onCard={onTakeCard}
            onCanvas={drawn => onDocumentCanvas(turn.documentId as string, drawn)} />
          : <p className="ui-hint">{DOCUMENT_WORDS.notKept}</p>)}
        {!readOnly && (!turn.incognito || incognito) && turn.kind === "clarify" && turn.choices && <div className="ask-choices">{turn.choices.map(choice =>
          <button key={choice} type="button" className="ui-button" disabled={busy} onClick={() => onAsk(choice)}>{choice}</button>)}</div>}
        {turn.links.length > 0 && <div className="ask-links">{turn.links.map(link => <Link key={link.href} className="ui-button primary" href={link.href} prefetch={false}>{link.label}</Link>)}</div>}
        {turn.sources.length > 0 && <p className="ask-sources ui-hint">Based on: {turn.sources.map((item, index) => {
          const { href, label } = sourceDisplay(item);
          return <span key={"href" in item ? item.href + item.label : item.id}>
            {index > 0 && ", "}{href ? href.startsWith("#") ? <a href={href} onClick={event => onNoteLink?.(event, href)}>{label}</a> : <Link href={href} prefetch={false}>{label}</Link> : label}
          </span>;
        })}</p>}
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
      ? <>{problem} <Link href="/settings/ai-model">Open Settings</Link></> : problem || speechProblem}</p>}
    {canvas && <div className="ask-canvas" ref={canvasRef} tabIndex={-1} role="region" aria-label="Canvas">{canvas}</div>}
  </div>;
}
