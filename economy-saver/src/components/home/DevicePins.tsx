"use client";

import { useEffect, useState } from "react";
import { drawRecipe } from "@/components/ui/draw-recipe";
import { wordsOf } from "@/components/ui/words";
import { useAskPanel } from "@/components/shell/AskWorkspace";
import { PinCard } from "./PinCard";
import type { ResolvedBlock } from "@/lib/canvas/resolve";
import { devicePins, moveDevicePin, unpinOnDevice } from "@/lib/store/device";
import type { DevicePin } from "@/lib/store/journal-ops";

type Drawn = { pin: DevicePin; blocks: ResolvedBlock[] | null; words: string };

/** Draws one pin's recipe through the engine, which reads the household's records and keeps nothing (D57, D59). */
async function draw(pin: DevicePin): Promise<Drawn> {
  const drawn = await drawRecipe(pin.recipe, "Reload to try again.");
  return typeof drawn === "string" ? { pin, blocks: null, words: drawn } : { pin, blocks: drawn, words: "" };
}

/**
 * The canvases pinned on this device only (D59), in order: read from this browser, drawn by asking the engine through POST /api/canvas/resolve
 * (which keeps nothing), so they show today's numbers like any pin. Same look as Pinned.
 */
export function DevicePins({ householdId, generalId }: { householdId: string; generalId: string }) {
  const [drawn, setDrawn] = useState<Drawn[] | null>(null);
  const [problem, setProblem] = useState("");
  const [version, setVersion] = useState(0);
  const askRevision = useAskPanel()?.revision;
  useEffect(() => {
    let cancelled = false;
    devicePins(householdId).then(pins => Promise.all(pins.filter(pin => pin.spaceId == null || pin.spaceId === generalId).map(draw))).then(
      result => { if (!cancelled) { setDrawn(result); setProblem(""); } },
      error => { if (!cancelled) { setProblem(wordsOf(error, "Couldn’t read the canvases on this device.")); setDrawn([]); } },
    );
    return () => { cancelled = true; };
  }, [askRevision, generalId, householdId, version]);

  async function change(work: () => Promise<boolean>) {
    try { if (!await work()) setProblem("That canvas is no longer pinned on this device."); setVersion(v => v + 1); }
    catch (error) { setProblem(wordsOf(error, "Couldn’t change that.")); }
  }
  if (!drawn) return null;
  if (drawn.length === 0 && !problem) return null;
  return <section id="pins" className="home-pins" aria-label="Pinned canvases">
    {problem && <p role="alert" className="ui-problem">{problem}</p>}
    {drawn.map(({ pin, blocks, words }, index) => <PinCard key={pin.id} id={pin.id} title={pin.title} recipe={pin.recipe} blocks={blocks} words={words} note="On this device only." actions={<>
      <button type="button" className="home-pin-button" disabled={index === 0} onClick={() => void change(() => moveDevicePin(householdId, pin.id, "up", generalId))}>Move up</button>
      <button type="button" className="home-pin-button" disabled={index === drawn.length - 1} onClick={() => void change(() => moveDevicePin(householdId, pin.id, "down", generalId))}>Move down</button>
      <button type="button" className="home-pin-button" onClick={() => void change(() => unpinOnDevice(householdId, pin.id))}>Unpin</button>
    </>} />)}
  </section>;
}
