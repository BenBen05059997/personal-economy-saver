"use client";

import { useCallback, useEffect, useEffectEvent, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Canvas } from "@/components/canvas/Canvas";
import { DeviceMemoryView } from "@/components/memory/DeviceMemoryView";
import { MemoryView } from "@/components/memory/MemoryView";
import { ApiForm } from "@/components/ui/ApiForm";
import { ConfirmRemove } from "@/components/ui/ConfirmRemove";
import { DocumentCard } from "./DocumentCard";
import { readAskStream } from "./read-stream";
import { KeepOfferCard } from "./KeepOffer";
import { OpenSpaceProposal } from "./OpenSpaceProposal";
import { SpaceBrief } from "./SpaceBrief";
import { contextTail, historyTail } from "@/lib/agent/context";
import { ASK_SCREEN_NAMES, type AskScreen } from "@/lib/agent/screen";
import { PROVIDERS } from "@/lib/ai/providers";
import type { Brief, BriefRecord } from "@/lib/agent/brief";
import type { AskView } from "@/db/ask-view";
import { SessionEnded } from "@/components/ui/SessionEnded";
import { SESSION_ENDED } from "@/lib/session-ended";
import { NEEDS_KEY_OWNER, NEEDS_KEY_MEMBER } from "@/lib/agent/availability";
import { KEY_TEXT_WORDS, looksLikeApiKey } from "@/lib/ai/key-text";
import { drawCanvas } from "@/lib/canvas/draw";
import { DOCUMENT_WORDS, type DocumentCard as Card } from "@/lib/reader/document-card";
import type { ResolvedBlock } from "@/lib/canvas/resolve";
import type { Drawn, TurnView } from "@/lib/agent/view";
import type { Recipe } from "@/lib/canvas/schema";
import type { MemoryItem } from "@/lib/schema/memory";
import { DEVICE_MEMORY_SOURCE_LABEL, memorySourceLabel, type ConversationTurn, type TurnSource } from "@/lib/schema/turn";
import {
  applyDeviceMemoryChanges, deleteDeviceConversation, deleteDeviceTurn, deviceMemory, devicePins, listDevice, pinOnDevice, readDeviceBrief, saveDeviceTurn, setDeviceThumb, unpinOnDevice, updateDevicePin, writeDeviceBrief,
} from "@/lib/store/device";
import { legacyOf, removeTurn, threadOf } from "@/lib/store/journal-ops";
import { DRAFT_EVENT, takeStoredDraft } from "./draft";
import { useSpeech } from "../voice/use-speech";
import "./ask.css";

type Pin = { id: string; title: string };
type Earlier = { id: string; question: string };
type MemoryLinks = { notes: ReadonlyMap<string, string>; profile: ReadonlyMap<string, string> };

const viewOf = (turn: ConversationTurn): TurnView => ({
  id: turn.id, question: turn.question, kind: turn.kind, text: turn.reply, choices: turn.choices, sources: turn.sources, links: [], thumb: turn.thumb, documentId: turn.documentId ?? null,
});
const wordsOf = (error: unknown) => (error instanceof Error ? error.message : "Couldn’t use this device’s storage.");
/** Draws a recipe through the engine; the route reads the household's records and keeps nothing. */
async function drawOnServer(recipe: Recipe): Promise<ResolvedBlock[] | string> {
  try {
    return await drawCanvas(recipe);
  } catch { return "Couldn’t reach your household. Try again."; }
}

const MAX_FILE_BYTES = 6 * 1024 * 1024;
const FILE_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"];

const EXAMPLES = ["Am I OK until the end of the month?", "What if a client pays two weeks late?", "Where did last month go?"];

/** Ask’s thread, composer and canvas for both the full page and the docked panel (D60). */
export function AskPage({
  householdId, places, clock, space, spaces, earlier, legacyId, pinId, pins, turns: initialTurns, starters, shown, pin,
  firstUse, unavailable, form, cloudBrief, cloudMemory, memoryMoment, variant = "full", screen = "canvas", focusRequest = 0, chooseSpace, onPanelChange, handoff, onHandoffHandled, onClose,
}: AskView & {
  variant?: "full" | "panel"; screen?: AskScreen; focusRequest?: number; chooseSpace?: (id: string) => void; onPanelChange?: () => void;
  handoff?: { id: string; question: string } | null; onHandoffHandled?: (id: string) => void; onClose?: () => void;
}) {
  const panel = variant === "panel";
  const anchorPrefix = panel ? "ask-panel-" : "";
  const Heading = panel ? "h2" : "h1";
  // D59: a kind kept on this device is read from and written to this browser; the question carries what the server needs for it and the server keeps none of it.
  const onDevice = { memory: places.memory === "device", journal: places.journal === "device", canvases: places.canvases === "device" };
  const router = useRouter();
  const field = useRef<HTMLTextAreaElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const requestId = useRef("");
  // The text the id was first sent with: a retry reuses the id only for the same question.
  const requestText = useRef("");
  const conversationId = legacyId ?? space.id;
  const spaceHref = `/canvas?space=${space.id}`;
  const readOnly = space.status === "archived" || legacyId !== null;
  const pinsReturnTo = space.isGeneral ? "/" : spaceHref;
  const [deviceReady, setDeviceReady] = useState(!onDevice.journal);
  const [deviceEarlier, setDeviceEarlier] = useState<Earlier[]>([]);
  const [latestBrief, setLatestBrief] = useState<BriefRecord | null>(null);
  const [localMemoryLinks, setLocalMemoryLinks] = useState<MemoryLinks | null>(null);
  const [notesVersion, setNotesVersion] = useState(0);
  const notesChanged = () => setNotesVersion(version => version + 1);
  const noteLinks = useCallback((items: MemoryItem[]) => {
    setLocalMemoryLinks({
      notes: new Map(items.filter(item => item.spaceId === space.id).map(item => [item.id, memorySourceLabel(item.text)])),
      profile: new Map(items.filter(item => !item.spaceId).map(item => [item.id, memorySourceLabel(item.text)])),
    });
  }, [space.id]);
  const replyIsNewer = latestBrief !== null && (cloudBrief === null || latestBrief.updatedAt > cloudBrief.updatedAt);
  const brief = onDevice.journal || replyIsNewer ? latestBrief : cloudBrief;
  const [localPins, setLocalPins] = useState<Pin[]>([]);
  const earlierThreads = onDevice.journal ? deviceEarlier : earlier;
  const spacePins = onDevice.canvases ? localPins : pins;
  const [turns, setTurns] = useState(initialTurns);
  const [canvas, setCanvas] = useState<Drawn | null>(shown);
  const [incognito, setIncognito] = useState(false);
  const [privateCanvas, setPrivateCanvas] = useState<Drawn | null>(null);
  const canWrite = !readOnly && !incognito;
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
  const [fullHandoff, setFullHandoff] = useState<{ id: string; question: string } | null>(null);
  useEffect(() => {
    if (panel) return;
    const frame = requestAnimationFrame(() => {
      try {
        const value = window.sessionStorage.getItem("pes-ask-submit");
        if (!value) return;
        window.sessionStorage.removeItem("pes-ask-submit");
        const item: unknown = JSON.parse(value);
        if (item && typeof item === "object" && "id" in item && typeof item.id === "string" && "question" in item && typeof item.question === "string") setFullHandoff({ id: item.id, question: item.question });
      } catch { /* The page still opens if storage is unavailable. */ }
    });
    return () => cancelAnimationFrame(frame);
  }, [panel]);
  const nextHandoff = handoff ?? fullHandoff;
  const handledHandoff = useRef<string | null>(null);
  const attached = useRef<{ key: string; id: string } | null>(null);
  const docCanvases = useRef(0);
  const canvasChosen = useRef(false);
  const deviceLoaded = useRef(false);
  const lastFocus = useRef(0);

  // This page is keyed by space, thread and pin. Device history loads only this thread; older threads are listed under General.
  useEffect(() => {
    if (deviceLoaded.current || (!onDevice.journal && !onDevice.canvases)) return;
    let cancelled = false;
    (async () => {
      try {
        const [allPins, all, storedBrief] = await Promise.all([
          onDevice.canvases ? devicePins(householdId) : [],
          onDevice.journal ? listDevice(householdId, "journal") : [],
          onDevice.journal && !legacyId ? readDeviceBrief(householdId, space.id) : null,
        ]);
        const currentPins = allPins.filter(item => item.spaceId === space.id || (space.isGeneral && item.spaceId == null));
        const pinned = pinId ? currentPins.find(item => item.id === pinId) : undefined;
        const history = space.isGeneral ? legacyOf(all, new Set(spaces.map(item => item.id))) : [];
        const thread = legacyId && !history.some(item => item.id === legacyId) ? [] : threadOf(all, conversationId);
        if (cancelled) return;
        if (onDevice.journal) {
          setTurns(thread.map(viewOf));
          setDeviceEarlier(history);
          setLatestBrief(storedBrief);
          setDeviceReady(true);
          if (all.some(turn => turn.kind === "answer")) setIntro(null);
          if (legacyId && thread.length === 0) setProblem("That conversation is not on this device.");
        }
        setLocalPins(currentPins);
        if (pinned) setDevicePin({ id: pinned.id, title: pinned.title });
        const last = thread.findLast(turn => turn.recipe !== null);
        const recipe = pinned?.recipe ?? last?.recipe ?? null;
        const key = pinned ? `pin-${pinned.id}` : last?.id;
        if (recipe && key) {
          if (pinned) canvasChosen.current = true;
          const blocks = await drawOnServer(recipe);
          if (cancelled) return;
          if (typeof blocks === "string") setProblem(blocks);
          else if (pinned || !canvasChosen.current) setCanvas({ key, title: recipe.title, recipe, blocks });
        }
        if (!cancelled) deviceLoaded.current = true;
      } catch (error) { if (!cancelled) setProblem(wordsOf(error)); }
    })();
    return () => { cancelled = true; };
  // The keyed page gets a new mount on selection, but a refresh on the same page keeps its unsent draft.
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
    if (!panel && window.location.hash === "#ask") field.current?.focus();
    window.addEventListener(DRAFT_EVENT, takeDraft);
    return () => { window.removeEventListener(DRAFT_EVENT, takeDraft); };
  }, [panel]);
  useEffect(() => {
    if (focusRequest <= lastFocus.current) return;
    lastFocus.current = focusRequest;
    field.current?.focus();
  }, [focusRequest]);

  const speech = useSpeech(words => { setText(words); setSource("voice"); requestId.current = ""; });
  const listening = speech.listening;
  function speak() { setProblem(""); speech.start(); }

  function scrollToCanvas() {
    // The panel and the phone stack the canvas below the conversation.
    requestAnimationFrame(() => {
      const target = canvasRef.current;
      if (!target) return;
      if (panel) {
        // Scroll the panel's own middle, never the page behind it.
        const box = target.closest<HTMLElement>(".ask-scroll");
        if (box) box.scrollTo({ top: target.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop - 12, behavior: "smooth" });
      } else if (window.matchMedia("(max-width: 899px)").matches) target.scrollIntoView({ block: "start", behavior: "smooth" });
    });
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
      body.set("document", file); body.set("id", attached.current.id); body.set("conversationId", conversationId); body.set("spaceId", space.id); body.set("text", note);
      const response = await fetch("/api/ask/document", { method: "POST", body });
      if (!response.ok) return response.status === 401 ? SESSION_ENDED : (await response.text()) || "Upload failed.";
      const { turn, card } = await response.json() as { turn: ConversationTurn; card: Card };
      attached.current = null;
      onPanelChange?.();
      setCards(current => ({ ...current, [card.documentId]: card }));
      setTurns(current => [...current.filter(item => item.id !== turn.id), viewOf(turn)]);
      if (onDevice.journal) {
        try { await saveDeviceTurn(householdId, { ...turn, spaceId: space.id }); } catch (error) { return wordsOf(error); }
      }
      return null;
    } catch { return "Couldn’t reach your household. Try again."; }
  }

  /** Several files go one after another, each its own turn and card; the typed note goes with the first, and a refused file does not stop the others. */
  async function attach(files: File[]) {
    if (files.length === 0 || busy || !canWrite || !deviceReady) return;
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

  const currentCanvas = incognito ? privateCanvas ?? canvas : canvas;

  async function ask(question: string, how: "manual" | "voice") {
    const trimmed = question.trim();
    if (!trimmed || busy || readOnly || !deviceReady) return;
    // A pasted key never leaves the page: it is not sent, kept in the journal or shown back.
    if (looksLikeApiKey(trimmed)) { setText(""); setProblem(KEY_TEXT_WORDS); return; }
    setBusy(true);
    setStep("");
    setProblem("");
    if (requestText.current !== trimmed) requestId.current = "";
    requestText.current = trimmed;
    requestId.current ||= crypto.randomUUID();
    const id = requestId.current;
    try {
      // Device context travels only with this question, in the same character budget as cloud context.
      const local = await Promise.all([
        onDevice.memory ? deviceMemory(householdId) : undefined,
        onDevice.journal ? listDevice(householdId, "journal") : undefined,
        onDevice.journal ? readDeviceBrief(householdId, space.id) : undefined,
      ]).catch(error => { setProblem(wordsOf(error)); return null; });
      if (!local) return;
      const [memory, journal, storedBrief] = local;
      const tail = journal ? contextTail(threadOf(journal, conversationId)) : null;
      const spaceIds = new Set(spaces.map(item => item.id));
      const history = journal ? historyTail(journal.filter(turn => !turn.spaceId || spaceIds.has(turn.spaceId))) : undefined;
      const visibleMemory = memory?.filter(item => !item.spaceId || spaceIds.has(item.spaceId));
      const response = await fetch("/api/ask", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id, conversationId, spaceId: space.id, text: trimmed, source: how, screen, canvas: currentCanvas?.recipe ?? null,
          ...(incognito && { incognito: true }),
          ...(visibleMemory && { memory: visibleMemory }),
          ...(tail && { recent: tail.turns, earlierCount: tail.omitted, deviceBrief: storedBrief?.brief ?? {}, history }),
        }) });
      // A 503 carries a fixed message written for this box, such as a missing key.
      if (!response.ok) { setProblem(response.status === 401 ? SESSION_ENDED : response.status === 429 ? "Ask again in a minute." : response.status === 503 || response.status === 400 ? await response.text() : "Couldn’t check your household. Try again."); return; }
      const last = await readAskStream(response, setStep);
      if (!last) { setProblem("Couldn’t check your household. Try again."); return; }
      // An error line reads like the 503 it replaced; the same question keeps its id for a retry.
      if ("error" in last) { setProblem(last.error); return; }
      const reply = last.reply;
      requestId.current = "";
      setText(""); setSource("manual");
      const privateReply = incognito || reply.incognito === true;
      setTurns(current => [...current.filter(turn => turn.id !== reply.id), {
        id: reply.id, question: trimmed, kind: reply.kind, text: reply.text, choices: reply.choices, sources: reply.sources,
        links: privateReply ? [] : reply.links, thumb: null, documentId: null,
        ...(privateReply ? { incognito: true } : { offers: reply.offers, openSpace: reply.openSpace }),
      }]);
      const drawn = reply.canvas
        ? { key: reply.id, title: reply.canvas.recipe.title, recipe: reply.canvas.recipe, blocks: reply.canvas.blocks } : null;
      // A private reply lives only in this view. Its canvas is never sent with a later question or put on a pin.
      if (privateReply) {
        setPrivateCanvas(drawn);
        if (drawn) scrollToCanvas();
        return;
      }
      setIntro(current => (onDevice.journal ? (reply.kind === "answer" ? null : current) : reply.firstUse));
      if (onDevice.journal) {
        try {
          await saveDeviceTurn(householdId, {
            version: 1, id: reply.id, conversationId, spaceId: space.id, question: trimmed, kind: reply.kind, reply: reply.text, choices: reply.choices,
            recipe: reply.canvas?.recipe ?? null, sources: reply.sources, thumb: null, createdAt: new Date().toISOString(),
          }, reply.brief ? { id: space.id, ...reply.brief } : undefined);
          if (reply.brief) setLatestBrief(reply.brief);
        } catch (error) { setProblem(wordsOf(error)); }
      } else if (reply.brief) setLatestBrief(reply.brief);
      if (onDevice.memory && reply.memoryChanges.length > 0) {
        try { await applyDeviceMemoryChanges(householdId, reply.memoryChanges); notesChanged(); }
        catch (error) { setProblem(wordsOf(error)); }
      }
      if (drawn) {
        canvasChosen.current = true;
        setCanvas(drawn);
        scrollToCanvas();
      }
      if (onPanelChange) {
        if (reply.kind === "answer" || reply.pending || reply.links.length || reply.memoryChanged || reply.memoryChanges.length || reply.brief) onPanelChange();
      } else if (reply.pending || (!onDevice.memory && reply.memoryChanged)) {
        router.refresh();
      }
    } catch { setProblem("Couldn’t reach your household. Try again."); }
    finally { setBusy(false); setStep(""); }
  }

  const handoffAction = useEffectEvent((question: string) => {
    if (unavailable || readOnly) setText(question);
    else void ask(question, "manual");
  });
  useEffect(() => {
    if (!nextHandoff || handledHandoff.current === nextHandoff.id || !deviceReady || busy) return;
    handledHandoff.current = nextHandoff.id;
    handoffAction(nextHandoff.question);
    onHandoffHandled?.(nextHandoff.id);
  }, [nextHandoff, deviceReady, busy, onHandoffHandled]);

  async function saveLocalBrief(edited: Brief) {
    const record = { brief: edited, updatedAt: new Date().toISOString(), updatedBy: "form" } as const;
    await writeDeviceBrief(householdId, { id: space.id, ...record });
    setLatestBrief(record);
  }

  async function thumb(turn: TurnView, which: 1 | -1) {
    if (!canWrite || turn.incognito) return;
    const next = turn.thumb === which ? null : which;
    // On this device the thumb is kept here; the server only writes its content-free log line.
    if (onDevice.journal) {
      try { if (!await setDeviceThumb(householdId, turn.id, next)) return; } catch (error) { setProblem(wordsOf(error)); return; }
    }
    const response = await fetch("/api/ask/thumb", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: turn.id, thumb: next === 1 ? "up" : next === -1 ? "down" : null, ...(onDevice.journal && { device: true }) }) }).catch(() => null);
    if (response?.ok || onDevice.journal) setTurns(current => current.map(item => (item.id === turn.id ? { ...item, thumb: next } : item)));
  }

  function removeFromThread(id: string) {
    setTurns(current => removeTurn(current, id));
  }

  async function removeLocalTurn(id: string) {
    try {
      await deleteDeviceTurn(householdId, id);
      removeFromThread(id);
    } catch (error) {
      setProblem(wordsOf(error));
    }
  }

  function clearThread() {
    speech.stop();
    setTurns([]); setCards({}); setCanvas(null); setPrivateCanvas(null); canvasChosen.current = false; attached.current = null; setText(""); setProblem(unavailable ?? ""); requestId.current = "";
    field.current?.focus();
  }

  const submit = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); void ask(text, source); };
  // Enter asks, Shift+Enter is a newline, and Enter that confirms an IME candidate (Japanese input) never asks.
  function enterAsks(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    if (text.trim() && !busy && !listening) event.currentTarget.form?.requestSubmit();
  }

  function switchIncognito(enabled: boolean) {
    setIncognito(enabled);
    requestId.current = "";
    if (!enabled) setPrivateCanvas(null);
  }

  const onStarters = currentCanvas === null;
  async function pinHere(update: boolean) {
    if (!canWrite || !showing) return;
    try {
      if (update && devicePin) { if (!await updateDevicePin(householdId, devicePin.id, showing.recipe)) { setProblem("That canvas is no longer pinned on this device."); return; } }
      else await pinOnDevice(householdId, { title: showing.recipe.title, recipe: showing.recipe, spaceId: space.id });
      if (space.isGeneral) {
        if (onPanelChange) onPanelChange();
        else router.push("/");
      }
      else setLocalPins((await devicePins(householdId)).filter(item => item.spaceId === space.id));
    } catch (error) { setProblem(wordsOf(error)); }
  }
  async function unpinHere(id: string) {
    try {
      if (!await unpinOnDevice(householdId, id)) { setProblem("That canvas is no longer pinned on this device."); return; }
      if (devicePin?.id === id) setDevicePin(null);
      setLocalPins(current => current.filter(item => item.id !== id));
      if (pinId === id) router.push(spaceHref);
    } catch (error) { setProblem(wordsOf(error)); }
  }
  const pinFields = (recipe: Recipe) => <>
    <input type="hidden" name="recipe" value={JSON.stringify(recipe)} />
    <input type="hidden" name="spaceId" value={space.id} />
    <input type="hidden" name="returnTo" value={pinsReturnTo} />
  </>;

  function sourceDisplay(item: TurnSource): { href?: string; label: string } {
    if ("href" in item) return item;
    const localNote = localMemoryLinks?.notes.get(item.id);
    const localProfile = localMemoryLinks?.profile.get(item.id);
    const note = onDevice.memory ? Boolean(localNote) : cloudMemory.notes.some(note => note.id === item.id);
    const profile = onDevice.memory ? Boolean(localProfile) : cloudMemory.profileIds.includes(item.id);
    const href = note ? `#${anchorPrefix}memory-${item.id}` : profile ? `/memory#memory-${item.id}` : undefined;
    const label = item.label === DEVICE_MEMORY_SOURCE_LABEL ? localNote ?? localProfile ?? item.label : item.label;
    return { href, label };
  }

  const showing = panel ? currentCanvas : currentCanvas ?? starters[starter] ?? null;
  const noModel = unavailable === NEEDS_KEY_OWNER || unavailable === NEEDS_KEY_MEMBER;
  const placeholder = "What’s due this week? Can I spend ¥4,000?";
  const iconProps = { width: 16, height: 16, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;
  const micButton = <button type="button" className="ask-mic" aria-label={listening ? "Stop listening" : "Use microphone"}
    disabled={busy || !deviceReady || (panel && unavailable !== null)} onClick={listening ? speech.stop : speak}>
    <svg {...iconProps}><path d="M8 2a2 2 0 0 0-2 2v4a2 2 0 0 0 4 0V4a2 2 0 0 0-2-2zM3.5 7.5a4.5 4.5 0 0 0 9 0M8 12v2" /></svg>
  </button>;
  const askButton = <button className="ui-button primary" disabled={busy || !deviceReady || listening || unavailable !== null}>{busy ? "Checking…" : "Ask"}</button>;
  const incognitoSwitch = <label className="ask-incognito">
    <input type="checkbox" role="switch" checked={incognito} disabled={busy} onChange={event => switchIncognito(event.target.checked)} />
    Incognito
  </label>;
  const attachLabel = !incognito && <label className={`ui-button ask-attach${busy ? " is-disabled" : ""}`}>Attach a bill
    <input type="file" multiple accept="image/jpeg,image/png,image/webp,application/pdf" disabled={busy || !deviceReady}
      onChange={event => { const input = event.currentTarget; void attach(Array.from(input.files ?? [])).finally(() => { input.value = ""; }); }} />
  </label>;
  const keyProviders = PROVIDERS.filter(provider => provider.getKeyUrl);
  const canvasBlock = <>
    {panel && showing && <Link className="ui-button ask-open-canvas" href={spaceHref} prefetch={false}>Open full</Link>}
    {showing && <Canvas key={showing.key} recipe={showing.recipe} initial={showing.blocks}>
      {canWrite && (onDevice.canvases ? <div className="ask-pin">
        {devicePin && canvas && <button type="button" className="ui-button primary" onClick={() => void pinHere(true)}>Save to this pin</button>}
        <button type="button" className="ui-button" onClick={() => void pinHere(false)}>{space.isGeneral ? "Pin to Home" : "Pin to this space"}</button>
        <p className="ui-hint">Pinned on this device only.</p>
      </div> : <div className="ask-pin">
        {pin && canvas && <ApiForm action="/api/canvases" className="ask-pin-form">
          <input type="hidden" name="kind" value="update" /><input type="hidden" name="id" value={pin.id} />{pinFields(canvas.recipe)}
          <button className="ui-button primary">Save to this pin</button>
        </ApiForm>}
        <ApiForm action="/api/canvases" className="ask-pin-form">
          <input type="hidden" name="kind" value="pin" /><input type="hidden" name="title" value={showing.recipe.title} />{pinFields(showing.recipe)}
          <button className="ui-button">{space.isGeneral ? "Pin to Home" : "Pin to this space"}</button>
        </ApiForm>
      </div>)}
    </Canvas>}
  </>;

  return <div className={panel ? "ask-page is-panel" : "ask-page"}>
    <section className="ask-conversation" aria-label="Conversation">
      {panel && <header className="ask-panel-head">
        <h2 className="ask-panel-title">Ask</h2>
        <span className="ask-space-select">
          <select aria-label="Space" value={space.id} disabled={busy || !chooseSpace} onChange={event => { if (event.target.value !== space.id) chooseSpace?.(event.target.value); }}>
            {spaces.filter(item => item.status === "open" || item.id === space.id).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
          <svg {...iconProps} width={12} height={12}><path d="M4 6l4 4 4-4" /></svg>
        </span>
        <Link className="ask-icon-button ask-open-full" href={spaceHref} prefetch={false} aria-label="Open full">
          <svg {...iconProps}><path d="M9.5 2.5h4v4M13.5 2.5L8.5 7.5M6.5 13.5h-4v-4M2.5 13.5l5-5" /></svg>
        </Link>
        <button type="button" className="ask-icon-button" aria-label="Close Ask" onClick={onClose}>
          <svg {...iconProps}><path d="M4 4l8 8M12 4l-8 8" /></svg>
        </button>
      </header>}
      <div className="ask-scroll">
        {!panel && <>
          <div className="ask-head">
            <Heading className="ui-title">Ask</Heading>
            <Link href="/memory?tab=spaces" prefetch={false} className="ui-button">Spaces</Link>
          </div>
          <details className="ask-spaces">
            <summary aria-label={`Current space: ${space.name}`}>{space.name}</summary>
            <ul>{spaces.filter(item => item.status === "open").map(item =>
              <li key={item.id}><Link className="ui-button" href={`/canvas?space=${item.id}`} prefetch={false}
                onClick={event => {
                  if (!chooseSpace || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
                  event.preventDefault();
                  if (!busy && item.id !== space.id) chooseSpace(item.id);
                }}
                aria-current={item.id === space.id && !legacyId ? "page" : undefined}>{item.name}</Link></li>)}</ul>
          </details>
        </>}
        {space.status === "archived" && <p className="ui-hint">Archived space</p>}
        {legacyId && <Link href={spaceHref} prefetch={false} className="ui-button">Back to General</Link>}
        {!panel && !legacyId && <>
          <SpaceBrief id={space.id} record={brief} timeZone={clock.timeZone} ready={deviceReady}
            readOnly={!canWrite} busy={busy} saveOnDevice={onDevice.journal ? saveLocalBrief : undefined} onCloudSaved={setLatestBrief} />
          <a href={`#${anchorPrefix}space-notes`} className="ask-notes-link">Space notes ↓</a>
        </>}
        {!panel && earlierThreads.length > 0 && <details className="ask-spaces">
          <summary>Earlier conversations</summary>
          <ul>{earlierThreads.map(item => <li key={item.id}><Link className="ui-button" prefetch={false}
            href={`${spaceHref}&thread=${item.id}`} aria-current={legacyId === item.id ? "page" : undefined}>{item.question}</Link></li>)}</ul>
        </details>}
        {!panel && canWrite && space.isGeneral && turns.some(turn => !turn.incognito) && onDevice.journal && <details className="ui-remove" open={confirmDelete} onToggle={event => setConfirmDelete(event.currentTarget.open)}>
          <summary aria-label="Delete this conversation">Delete</summary>
          <p>Delete this conversation? Its questions and answers are removed from this device for good. What the assistant remembers, the brief and your pinned canvases stay.</p>
          <div className="ui-remove-buttons">
            <button type="button" className="ui-button" onClick={() => setConfirmDelete(false)}>Keep</button>
            <button type="button" className="ui-button" onClick={() => void (async () => {
              try { await deleteDeviceConversation(householdId, conversationId); setConfirmDelete(false); clearThread(); } catch (error) { setProblem(wordsOf(error)); }
            })()}>Delete</button>
          </div>
        </details>}
        {!panel && canWrite && space.isGeneral && turns.some(turn => !turn.incognito) && !onDevice.journal && <ConfirmRemove kind="conversation" id={conversationId} label="this conversation" note="Its questions and answers are removed for good. What the assistant remembers, the brief and your pinned canvases stay." returnTo={spaceHref} onDone={clearThread} />}
        {!readOnly && !deviceReady && !problem && <p className="ui-hint" role="status">Opening this space on this device…</p>}
        {panel && <p className="ask-screen-chip">
          <svg {...iconProps} width={12} height={12}><path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" /><circle cx="8" cy="8" r="1.8" /></svg>
          Looking at {ASK_SCREEN_NAMES[screen]}
        </p>}
        {noModel && <div className="ask-key-card">
          <p className="ask-key-line">{unavailable}</p>
          {unavailable === NEEDS_KEY_OWNER && <>
            <p>fipa has no AI of its own here. Paste a key from {keyProviders.slice(0, -1).map(provider => provider.label).join(", ")} or {keyProviders[keyProviders.length - 1].label}. It is sealed when you save it and never shown in full again.</p>
            <div className="ask-key-actions">
              <Link className="ui-button primary" href="/settings#ai-model">Add your AI key</Link>
              <details><summary>Where do I get one?</summary><ul>{keyProviders.map(provider => <li key={provider.id}><a href={provider.getKeyUrl!} target="_blank" rel="noreferrer">{provider.label}</a></li>)}</ul></details>
            </div>
          </>}
        </div>}
        {!readOnly && deviceReady && turns.length === 0 && <div className="ask-empty">
          {panel ? <p className="ask-try">Try asking</p> : <p className="ui-hint">Ask in your own words about your money. Every number comes from your records.</p>}
          <ul className="ask-examples">{EXAMPLES.map(example => <li key={example}><button type="button" className="ui-button" disabled={busy || unavailable !== null} onClick={() => void ask(example, "manual")}>{example}</button></li>)}</ul>
        </div>}
        <ol className="ask-turns" aria-live="polite">
          {turns.map(turn => <li key={turn.id} className="ask-turn">
            <p className="ask-question">{turn.question}</p>
            <p className={`ask-reply is-${turn.kind}`}>{turn.text}</p>
            {turn.incognito && <p className="ui-hint">Not saved</p>}
            {!readOnly && turn.openSpace && <OpenSpaceProposal name={turn.openSpace.name} hidden={incognito} />}
            {!readOnly && turn.offers?.map(offer => <KeepOfferCard key={JSON.stringify(offer)}
              offer={offer} householdId={householdId} clock={clock} currency={form.homeCurrency} deviceMemory={onDevice.memory} returnTo={spaceHref} onDeviceMemoryKept={() => { notesChanged(); onPanelChange?.(); }} hidden={incognito} />)}
            {turn.kind === "document" && (turn.documentId
              ? <DocumentCard documentId={turn.documentId} initial={cards[turn.documentId] ?? null} form={form} readOnly={!canWrite} returnTo={spaceHref} onCard={takeCard}
                onCanvas={drawn => showDocumentCanvas(turn.documentId as string, drawn, true)} />
              : <p className="ui-hint">{DOCUMENT_WORDS.notKept}</p>)}
            {!readOnly && (!turn.incognito || incognito) && turn.kind === "clarify" && turn.choices && <div className="ask-choices">{turn.choices.map(choice =>
              <button key={choice} type="button" className="ui-button" disabled={busy} onClick={() => void ask(choice, "manual")}>{choice}</button>)}</div>}
            {turn.links.length > 0 && <div className="ask-links">{turn.links.map(link => <Link key={link.href} className="ui-button primary" href={link.href} prefetch={false}>{link.label}</Link>)}</div>}
            {turn.sources.length > 0 && <p className="ask-sources ui-hint">Based on: {turn.sources.map((item, index) => {
              const { href, label } = sourceDisplay(item);
              return <span key={"href" in item ? item.href + item.label : item.id}>
                {index > 0 && ", "}{href ? href.startsWith("#") ? <a href={href}>{label}</a> : <Link href={href} prefetch={false}>{label}</Link> : label}
              </span>;
            })}</p>}
            {canWrite && !turn.incognito && turn.kind === "answer" && <div className="ask-thumbs">
              <button type="button" className="ui-button" aria-pressed={turn.thumb === 1} onClick={() => void thumb(turn, 1)}>Helpful</button>
              <button type="button" className="ui-button" aria-pressed={turn.thumb === -1} onClick={() => void thumb(turn, -1)}>Not helpful</button>
            </div>}
            {!incognito && !turn.incognito && <ConfirmRemove kind="data" what="journal" id={turn.id} label="this question and reply"
              returnTo={spaceHref} onDone={() => removeFromThread(turn.id)}
              onRemove={onDevice.journal ? () => void removeLocalTurn(turn.id) : undefined} />}
          </li>)}
        </ol>
        {busy && <p role="status" aria-live="polite" className="ui-hint">{step || "Checking your numbers…"}</p>}
        {(problem || speech.problem) && !(noModel && (problem === NEEDS_KEY_OWNER || problem === NEEDS_KEY_MEMBER)) && <p role="alert" className="ui-problem">{problem === SESSION_ENDED ? <SessionEnded /> : problem === NEEDS_KEY_OWNER
          ? <>{problem} <Link href="/settings#ai-model">Open Settings</Link></> : problem || speech.problem}</p>}
        {panel && showing && <div className="ask-canvas" ref={canvasRef} tabIndex={-1} role="region" aria-label="Canvas">{canvasBlock}</div>}
      </div>
      {!readOnly && <form id={panel ? "ask-panel-question" : "ask"} className="ask-form ask-composer" onSubmit={submit}>
        {!panel && intro && <p className="ask-intro ui-hint">{intro}</p>}
        <label className="ask-composer-label" htmlFor={panel ? "ask-panel-text" : "ask-text"}>Ask a question</label>
        <div className="ask-box">
          <textarea id={panel ? "ask-panel-text" : "ask-text"} ref={field} maxLength={320} rows={2} value={text} required disabled={panel && unavailable !== null} placeholder={placeholder}
            onKeyDown={enterAsks}
            onChange={event => { setText(event.target.value); setSource("manual"); requestId.current = ""; }} />
          {micButton}
          {askButton}
        </div>
        <div className="ask-composer-row">{incognitoSwitch}{attachLabel}</div>
        {incognito && <p className="ui-hint ask-intro">This question and reply won’t be saved.</p>}
        {panel && intro && <details className="ask-model-line"><summary><span>{intro}</span><em>More</em></summary><p>{intro}</p></details>}
      </form>}
    </section>
    {!panel && <section className="ask-canvas" ref={canvasRef} aria-label="Canvas" tabIndex={-1}>
      {!space.isGeneral && spacePins.length > 0 && <div className="ask-space-pins">
        <h2>Pinned in this space</h2>
        <ul>{spacePins.map(item => <li key={item.id}>
          <Link className="ui-button" href={`${spaceHref}&pin=${item.id}`} prefetch={false}>{item.title}</Link>
          {canWrite && (onDevice.canvases
            ? <button type="button" className="ui-button" onClick={() => void unpinHere(item.id)}>Unpin</button>
            : <ApiForm action="/api/canvases" className="ask-pin-form">
              <input type="hidden" name="kind" value="unpin" /><input type="hidden" name="id" value={item.id} />
              <input type="hidden" name="returnTo" value={spaceHref} />
              <button className="ui-button">Unpin</button>
            </ApiForm>)}
        </li>)}</ul>
      </div>}
      {onStarters && <nav className="ask-starters" aria-label="Canvases to start from">
        {starters.map((item, index) => <button key={item.key} type="button" aria-pressed={index === starter} onClick={() => setStarter(index)}>{item.title}</button>)}
      </nav>}
      {canvasBlock}
      {!legacyId && (onDevice.memory
        ? <DeviceMemoryView householdId={householdId} spaceId={space.id} timeZone={clock.timeZone} momentNow={memoryMoment}
          readOnly={!canWrite} anchorPrefix={anchorPrefix} refreshKey={notesVersion} onItems={noteLinks} />
        : <MemoryView items={cloudMemory.notes} timeZone={clock.timeZone} spaceId={space.id} readOnly={!canWrite} anchorPrefix={anchorPrefix}
          totalCount={cloudMemory.totalCount} />)}
    </section>}
  </div>;
}
