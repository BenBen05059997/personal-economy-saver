"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { blockWords, KIND_WORDS } from "@/lib/canvas/words";
import type { ResolvedBlock } from "@/lib/canvas/resolve";
import type { Change, Recipe, Scenario } from "@/lib/canvas/schema";
import { ActionBlock, CompareBlock, LetterBlock, NoteBlock, NumberBlock, ProgressBlock, SentenceBlock, TableBlock, TimelineBlock } from "./blocks";
import { FlowChart } from "./FlowChart";
import { SlidersBlock } from "./SlidersBlock";
import "./canvas.css";

const DEBOUNCE_MS = 250;

/** How many of the six columns a block takes at desktop width (one column at phone width): full, half or a third. */
const SPAN: Record<ResolvedBlock["type"], 2 | 3 | 6> = {
  sentence: 6, number: 2, flow_chart: 6, timeline: 6, table: 6, compare: 6, progress: 2, note: 3, letter: 6, sliders: 6, action: 2,
};

function Body({ block, values, onSlide }: { block: ResolvedBlock; values: Record<string, number>; onSlide: (clientId: string, days: number) => void }) {
  switch (block.type) {
    case "sentence": return <SentenceBlock data={block.data} />;
    case "number": return <NumberBlock data={block.data} />;
    case "flow_chart": return <FlowChart data={block.data} />;
    case "timeline": return <TimelineBlock data={block.data} />;
    case "table": return <TableBlock data={block.data} />;
    case "compare": return <CompareBlock data={block.data} />;
    case "progress": return <ProgressBlock data={block.data} />;
    case "note": return <NoteBlock data={block.data} />;
    case "letter": return <LetterBlock data={block.data} />;
    case "sliders": return <SlidersBlock data={block.data} values={values} onChange={onSlide} />;
    case "action": return <ActionBlock data={block.data} />;
  }
}

/**
 * A recipe drawn: the resolved blocks laid out on a grid, each with a line saying where it came from. "Show the recipe" lists the blocks
 * in plain words and outlines them. Sliders change the canvas scenario's client_late days; after a pause the page asks the resolve route
 * to redraw the blocks that use that scenario (nothing is saved, and the route reads only).
 */
export function Canvas({ recipe, initial, children }: { recipe: Recipe; initial: ResolvedBlock[]; children?: ReactNode }) {
  const [blocks, setBlocks] = useState(initial);
  const [showRecipe, setShowRecipe] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [drawing, setDrawing] = useState(false);
  const controls = initial.flatMap(block => (block.type === "sliders" ? block.data.controls : []));
  const [values, setValues] = useState<Record<string, number>>(() => Object.fromEntries(controls.map(control => [control.clientId, control.days])));
  const slid = useRef(false);

  useEffect(() => {
    if (!slid.current) return;
    const slidIds = new Set(controls.map(control => control.clientId));
    const own = (recipe.scenario?.changes ?? []).filter(change => !(change.kind === "client_late" && slidIds.has(change.clientId)));
    const late: Change[] = Object.entries(values).filter(([, days]) => days > 0).map(([clientId, days]) => ({ kind: "client_late", clientId, days }));
    const scenario: Scenario = { case: recipe.scenario?.case ?? "usual", changes: [...own, ...late] };
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setDrawing(true);
      try {
        const response = await fetch("/api/canvas/resolve", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ recipe, scenario }), signal: controller.signal });
        if (!response.ok) throw new Error(await response.text());
        const next = (await response.json()).blocks as ResolvedBlock[];
        setBlocks(current => current.map((block, index) => (block.live && next[index] ? next[index] : block)));
        setProblem(null);
        setDrawing(false);
      } catch (error) {
        if (controller.signal.aborted) return;
        setProblem(error instanceof Error && error.message ? error.message : "The canvas could not be redrawn. Try again.");
        setDrawing(false);
      }
    }, DEBOUNCE_MS);
    return () => { clearTimeout(timer); controller.abort(); };
    // `controls` and `recipe` are fixed for this canvas; only the slider values move it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values]);

  const slide = (clientId: string, days: number) => {
    slid.current = true;
    setValues(current => ({ ...current, [clientId]: days }));
  };

  return <div className={`canvas ${showRecipe ? "is-recipe" : ""}`}>
    <div className="canvas-tools">
      <button type="button" className="ui-button" aria-pressed={showRecipe} onClick={() => setShowRecipe(on => !on)}>{showRecipe ? "Hide the recipe" : "Show the recipe"}</button>
      <span role="status" className="canvas-status">{drawing ? "Redrawing…" : ""}</span>
    </div>
    {problem && <p role="alert" className="canvas-problem">{problem}</p>}
    {showRecipe && <div className="canvas-recipe">
      <p>This canvas is a list of blocks. A block that shows money holds a question, not a number; your records answer it each time it is drawn.</p>
      <ol>{recipe.blocks.map((block, index) => <li key={index}>{blockWords(block)}</li>)}</ol>
    </div>}
    <div className="canvas-grid">
      {blocks.map((block, index) => <section key={index} className={`canvas-block canvas-span-${SPAN[block.type]}`} aria-label={`${KIND_WORDS[block.type]}, block ${index + 1}`}>
        {showRecipe && <p className="canvas-kind">{index + 1}. {KIND_WORDS[block.type]}</p>}
        <Body block={block} values={values} onSlide={slide} />
        <p className="canvas-source">{block.source}</p>
      </section>)}
    </div>
    {children}
  </div>;
}
