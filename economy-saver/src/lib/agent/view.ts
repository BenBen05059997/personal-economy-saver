import type { KeepOffer } from "./keep-offer";
import type { ResolvedBlock } from "@/lib/canvas/resolve";
import type { Recipe } from "@/lib/canvas/schema";
import type { TurnKind, TurnSource } from "@/lib/schema/turn";

export type TurnView = {
  id: string; question: string; kind: TurnKind; text: string; choices: string[] | null;
  sources: TurnSource[]; links: { label: string; href: string }[]; thumb: 1 | -1 | null; documentId: string | null; offers?: KeepOffer[];
  incognito?: boolean; openSpace?: { name: string };
};
export type Drawn = { key: string; title: string; recipe: Recipe; blocks: ResolvedBlock[] };
