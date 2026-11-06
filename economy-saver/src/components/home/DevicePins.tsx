"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Canvas } from "@/components/canvas/Canvas";
import type { ResolvedBlock } from "@/lib/canvas/resolve";
import { devicePins, moveDevicePin, unpinOnDevice } from "@/lib/store/device";
import type { DevicePin } from "@/lib/store/journal-ops";

type Drawn = { pin: DevicePin; blocks: ResolvedBlock[] | null; words: string };

/** Asks the engine to draw one recipe. The route reads the household's records and keeps nothing (D57, D59). */
async function draw(pin: DevicePin): Promise<Drawn> {
  try {
    const response = await fetch("/api/canvas/resolve", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ recipe: pin.recipe }) });
    if (!response.ok) return { pin, blocks: null, words: await response.text() };
    return { pin, blocks: (await response.json() as { blocks: ResolvedBlock[] }).blocks, words: "" };
  } catch { return { pin, blocks: null, words: "Couldn’t reach your household. Reload to try again." }; }
}

/**
 * The canvases pinned on this device only (D59), in order: read from this browser, drawn by asking the engine through POST /api/canvas/resolve
 * (which keeps nothing), so they show today's numbers like any pin. Same look as Pinned.
 */
export function DevicePins({ householdId }: { householdId: string }) {
  const [drawn, setDrawn] = useState<Drawn[] | null>(null);
  const [problem, setProblem] = useState("");
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let cancelled = false;
    devicePins(householdId).then(pins => Promise.all(pins.map(draw))).then(
      result => { if (!cancelled) { setDrawn(result); setProblem(""); } },
      error => { if (!cancelled) { setProblem(error instanceof Error ? error.message : "Couldn’t read the canvases on this device."); setDrawn([]); } },
    );
    return () => { cancelled = true; };
  }, [householdId, version]);

  async function change(work: () => Promise<boolean>) {
    try { if (!await work()) setProblem("That canvas is no longer pinned on this device."); setVersion(v => v + 1); }
    catch (error) { setProblem(error instanceof Error ? error.message : "Couldn’t change that."); }
  }
  if (!drawn) return null;
  if (drawn.length === 0 && !problem) return null;
  return <section id="pins" className="home-pins" aria-label="Pinned canvases">
    {problem && <p role="alert" className="home-pin-problem">{problem}</p>}
    {drawn.map(({ pin, blocks, words }, index) => <article key={pin.id} className="home-panel home-pin">
      <h2>{pin.title} <Link prefetch={false} href={`/canvas?pin=${pin.id}`}>Open ›</Link></h2>
      <p className="ui-hint">On this device only.</p>
      <div className="home-pin-actions">
        <button type="button" className="home-pin-button" disabled={index === 0} onClick={() => void change(() => moveDevicePin(householdId, pin.id, "up"))}>Move up</button>
        <button type="button" className="home-pin-button" disabled={index === drawn.length - 1} onClick={() => void change(() => moveDevicePin(householdId, pin.id, "down"))}>Move down</button>
        <button type="button" className="home-pin-button" onClick={() => void change(() => unpinOnDevice(householdId, pin.id))}>Unpin</button>
      </div>
      {blocks ? <Canvas recipe={pin.recipe} initial={blocks} /> : <p role="alert" className="home-pin-problem">This canvas can&apos;t be drawn: {words}</p>}
    </article>)}
  </section>;
}
