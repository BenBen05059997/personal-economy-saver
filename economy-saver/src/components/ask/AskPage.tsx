"use client";

import { useCallback, useEffect, useEffectEvent, useRef, useState, type FormEvent, type MouseEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Canvas } from "@/components/canvas/Canvas";
import { DeviceMemoryView } from "@/components/memory/DeviceMemoryView";
import { MemoryView } from "@/components/memory/MemoryView";
import { ApiForm } from "@/components/ui/ApiForm";
import { ConfirmRemove } from "@/components/ui/ConfirmRemove";
import { AskComposer } from "./AskComposer";
import { AskHeader } from "./AskHeader";
import { AskThread } from "./AskThread";
import { SpaceDrawer } from "./SpaceDrawer";
import { readAskStream } from "./read-stream";
import { SpaceBrief } from "./SpaceBrief";
import { contextTail, historyTail } from "@/lib/agent/context";
import { type AskScreen } from "@/lib/agent/screen";
import type { Brief, BriefRecord } from "@/lib/agent/brief";
import type { AskView } from "@/db/ask-view";
import { SESSION_ENDED } from "@/lib/session-ended";
import { NEEDS_KEY_OWNER, NEEDS_KEY_MEMBER } from "@/lib/agent/availability";
import { KEY_TEXT_WORDS, looksLikeApiKey } from "@/lib/ai/key-text";
import { drawCanvas } from "@/lib/canvas/draw";
import { type DocumentCard as Card } from "@/lib/reader/document-card";
import type { ResolvedBlock } from "@/lib/canvas/resolve";
import type { Drawn, TurnView } from "@/lib/agent/view";
import type { Recipe } from "@/lib/canvas/schema";
import type { MemoryItem } from "@/lib/schema/memory";
import { DEVICE_MEMORY_SOURCE_LABEL, memorySourceLabel, splitSources, storeSources, type ConversationTurn, type TurnSource } from "@/lib/schema/turn";
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
  id: turn.id, question: turn.question, kind: turn.kind, text: turn.reply, choices: turn.choices, ...splitSources(turn.sources), thumb: turn.thumb, documentId: turn.documentId ?? null,
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

/** Ask’s thread, composer and canvas for both the full page and the docked panel (D60). */
export function AskPage({
  householdId, places, clock, space, spaces, earlier, legacyId, pinId, pins, turns: initialTurns, starters, shown, pin,
  firstUse, questionsLeft, documentsLeft, unavailable, form, cloudBrief, cloudMemory, memoryMoment, variant = "full", screen = "canvas", focusRequest = 0, chooseSpace, onPanelChange, handoff, onHandoffHandled, onClose,
}: AskView & {
  variant?: "full" | "panel"; screen?: AskScreen; focusRequest?: number; chooseSpace?: (id: string) => void; onPanelChange?: () => void;
  handoff?: { id: string; question: string } | null; onHandoffHandled?: (id: string) => void; onClose?: () => void;
}) {
  const panel = variant === "panel";
  const anchorPrefix = panel ? "ask-panel-" : "";
  // D59: a kind kept on this device is read from and written to this browser; the question carries what the server needs for it and the server keeps none of it.
  const onDevice = { memory: places.memory === "device", journal: places.journal === "device", canvases: places.canvases === "device" };
  const router = useRouter();
  const field = useRef<HTMLTextAreaElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
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
  const [questions, setQuestions] = useState(questionsLeft);
  const [documents, setDocuments] = useState(documentsLeft);
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
    // The canvas is drawn in the thread: scroll the thread’s own middle, never the page behind it.
    requestAnimationFrame(() => {
      const target = canvasRef.current;
      const box = scrollRef.current;
      if (target && box) box.scrollTo({ top: target.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop - 12, behavior: "smooth" });
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
      if (!response.ok) { if (response.status === 429) setDocuments(0); return response.status === 401 ? SESSION_ENDED : (await response.text()) || "Upload failed."; }
      const { turn, card, left } = await response.json() as { turn: ConversationTurn; card: Card; left: number | null };
      setDocuments(left);
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
      if (!response.ok) { if (response.status === 429) setQuestions(0); setProblem(response.status === 401 ? SESSION_ENDED : response.status === 503 || response.status === 400 || response.status === 429 ? await response.text() : "Couldn’t check your household. Try again."); return; }
      const last = await readAskStream(response, setStep);
      if (!last) { setProblem("Couldn’t check your household. Try again."); return; }
      setQuestions(last.left);
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
            recipe: reply.canvas?.recipe ?? null, sources: storeSources(reply.sources, reply.links), thumb: null, createdAt: new Date().toISOString(),
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
        // The page under the panel shows what the turn drafted or saved.
        if (reply.pending || reply.links.length || reply.memoryChanged) router.refresh();
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

  function switchIncognito(enabled: boolean) {
    setIncognito(enabled);
    requestId.current = "";
    if (!enabled) setPrivateCanvas(null);
  }

  async function pinHere(update: boolean, shown: Drawn) {
    if (!canWrite) return;
    try {
      if (update && devicePin) { if (!await updateDevicePin(householdId, devicePin.id, shown.recipe)) { setProblem("That canvas is no longer pinned on this device."); return; } }
      else await pinOnDevice(householdId, { title: shown.recipe.title, recipe: shown.recipe, spaceId: space.id });
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
  /** On the full page the notes live in the sheet: a “Based on” link opens it and scrolls to the note. */
  function openNote(event: MouseEvent<HTMLAnchorElement>, href: string) {
    event.preventDefault();
    setDrawerOpen(true);
    requestAnimationFrame(() => requestAnimationFrame(() => document.getElementById(href.slice(1))?.scrollIntoView({ block: "center" })));
  }

  const noModel = unavailable === NEEDS_KEY_OWNER || unavailable === NEEDS_KEY_MEMBER;
  const canvasBlock = (drawn: Drawn) => <>
    {panel && <Link className="ui-button ask-open-canvas" href={spaceHref} prefetch={false}>Open full</Link>}
    <Canvas key={drawn.key} recipe={drawn.recipe} initial={drawn.blocks}>
      {canWrite && (onDevice.canvases ? <div className="ask-pin">
        {devicePin && canvas && <button type="button" className="ui-button primary" onClick={() => void pinHere(true, drawn)}>Save to this pin</button>}
        <button type="button" className="ui-button" onClick={() => void pinHere(false, drawn)}>{space.isGeneral ? "Pin to Home" : "Pin to this space"}</button>
        <p className="ui-hint">Pinned on this device only.</p>
      </div> : <div className="ask-pin">
        {pin && canvas && <ApiForm action="/api/canvases" className="ask-pin-form">
          <input type="hidden" name="kind" value="update" /><input type="hidden" name="id" value={pin.id} />{pinFields(canvas.recipe)}
          <button className="ui-button primary">Save to this pin</button>
        </ApiForm>}
        <ApiForm action="/api/canvases" className="ask-pin-form">
          <input type="hidden" name="kind" value="pin" /><input type="hidden" name="title" value={drawn.recipe.title} />{pinFields(drawn.recipe)}
          <button className="ui-button">{space.isGeneral ? "Pin to Home" : "Pin to this space"}</button>
        </ApiForm>
      </div>)}
    </Canvas>
  </>;
  const chooser = panel ? chooseSpace : chooseSpace ?? ((id: string) => router.push(`/canvas?space=${id}`));

  return <div className={panel ? "ask-page is-panel" : "ask-page is-full"}>
    <section className="ask-conversation" aria-label="Conversation">
      <AskHeader panel={panel} space={space} spaces={spaces} busy={busy} spaceHref={spaceHref} onChoose={chooser} onOpenSpace={() => setDrawerOpen(true)} onClose={onClose} />
      <AskThread panel={panel} screen={screen} legacyId={legacyId} space={space} spaceHref={spaceHref} householdId={householdId} clock={clock} form={form}
        onDeviceMemory={onDevice.memory} turns={turns} cards={cards} readOnly={readOnly} canWrite={canWrite} incognito={incognito} busy={busy} step={step} deviceReady={deviceReady}
        unavailable={unavailable} noModel={noModel} problem={problem} speechProblem={speech.problem} canvas={currentCanvas ? canvasBlock(currentCanvas) : null}
        canvasRef={canvasRef} scrollRef={scrollRef} onAsk={question => void ask(question, "manual")} onTakeCard={takeCard}
        onDocumentCanvas={(documentId, drawn) => showDocumentCanvas(documentId, drawn, true)} onThumb={(turn, which) => void thumb(turn, which)}
        onRemoveTurn={removeFromThread} onRemoveLocalTurn={id => void removeLocalTurn(id)} removeOnDevice={onDevice.journal}
        onKept={() => { notesChanged(); onPanelChange?.(); }} sourceDisplay={sourceDisplay} onNoteLink={panel ? undefined : openNote} />
      {!readOnly && <AskComposer panel={panel} field={field} text={text} busy={busy} deviceReady={deviceReady} listening={listening} unavailable={unavailable}
        incognito={incognito} intro={intro} questionsLeft={questions} documentsLeft={documents} onText={value => { setText(value); setSource("manual"); requestId.current = ""; }} onSubmit={submit}
        onMic={listening ? speech.stop : speak} onIncognito={switchIncognito} onAttach={attach} />}
    </section>
    {!panel && <SpaceDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} space={space} spaceHref={spaceHref} legacyId={legacyId} canWrite={canWrite}
      pinsOnDevice={onDevice.canvases} pins={spacePins} earlier={earlierThreads} onUnpin={id => void unpinHere(id)}
      brief={<SpaceBrief id={space.id} record={brief} timeZone={clock.timeZone} ready={deviceReady}
        readOnly={!canWrite} busy={busy} saveOnDevice={onDevice.journal ? saveLocalBrief : undefined} onCloudSaved={setLatestBrief} />}
      remove={<>
        {canWrite && space.isGeneral && turns.some(turn => !turn.incognito) && onDevice.journal && <details className="ui-remove" open={confirmDelete} onToggle={event => setConfirmDelete(event.currentTarget.open)}>
          <summary aria-label="Delete this conversation">Delete</summary>
          <p>Delete this conversation? Its questions and answers are removed from this device for good. What the assistant remembers, the brief and your pinned canvases stay.</p>
          <div className="ui-remove-buttons">
            <button type="button" className="ui-button" onClick={() => setConfirmDelete(false)}>Keep</button>
            <button type="button" className="ui-button" onClick={() => void (async () => {
              try { await deleteDeviceConversation(householdId, conversationId); setConfirmDelete(false); clearThread(); } catch (error) { setProblem(wordsOf(error)); }
            })()}>Delete</button>
          </div>
        </details>}
        {canWrite && space.isGeneral && turns.some(turn => !turn.incognito) && !onDevice.journal && <ConfirmRemove kind="conversation" id={conversationId} label="this conversation" note="Its questions and answers are removed for good. What the assistant remembers, the brief and your pinned canvases stay." returnTo={spaceHref} onDone={clearThread} />}
      </>}
      starters={starters} starter={starter} onStarter={setStarter} starterCanvas={starters[starter] ? canvasBlock(starters[starter]) : null}
      notes={!legacyId && (onDevice.memory
        ? <DeviceMemoryView householdId={householdId} spaceId={space.id} timeZone={clock.timeZone} momentNow={memoryMoment}
          readOnly={!canWrite} anchorPrefix={anchorPrefix} refreshKey={notesVersion} onItems={noteLinks} />
        : <MemoryView items={cloudMemory.notes} timeZone={clock.timeZone} spaceId={space.id} readOnly={!canWrite} anchorPrefix={anchorPrefix}
          totalCount={cloudMemory.totalCount} />)} />}
  </div>;
}
