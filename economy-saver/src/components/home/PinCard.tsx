import type { ReactNode } from "react";
import Link from "next/link";
import { SessionEnded } from "@/components/ui/SessionEnded";
import { SESSION_ENDED } from "@/lib/session-ended";
import { Canvas } from "@/components/canvas/Canvas";
import type { Recipe } from "@/lib/canvas/schema";
import type { ResolvedBlock } from "@/lib/canvas/resolve";

/** One pinned canvas on Home (D57): the title, the pin's actions, then the blocks, or why they can't be drawn. Shared by the cloud pins and the device pins. */
export function PinCard({ id, title, recipe, blocks, words, note, actions }: {
  id: string; title: string; recipe: Recipe; blocks: ResolvedBlock[] | null; words: string; note?: string; actions: ReactNode;
}) {
  return <article className="home-panel home-pin">
    <h2>{title} <Link prefetch={false} href={`/canvas?pin=${id}`}>Open ›</Link></h2>
    {note && <p className="ui-hint">{note}</p>}
    <div className="home-pin-actions">{actions}</div>
    {blocks ? <Canvas recipe={recipe} initial={blocks} /> : <p role="alert" className="ui-problem">{words === SESSION_ENDED ? <SessionEnded /> : `This canvas can't be drawn: ${words}`}</p>}
  </article>;
}
