import { Suspense } from "react";
import { redirect } from "next/navigation";
import { AskPage, type Drawn, type TurnView } from "@/components/ask/AskPage";
import { loadWorkspace, WorkspaceFrame } from "@/components/shell/WorkspaceFrame";
import { LoadingState } from "@/components/ui/LoadingState";
import { firstUseLine } from "@/db/ask";
import { connectionView } from "@/db/ai-key";
import { listCanvases } from "@/db/canvases";
import { db } from "@/db/client";
import { withHousehold } from "@/db/household";
import { latestConversation } from "@/db/conversation";
import { readPlaces } from "@/db/place";
import { loadSpending } from "@/db/spending";
import { openSuggestions } from "@/db/suggestions";
import { askUnavailable, missingAskSetting } from "@/lib/agent/availability";
import { CanvasError, resolveRecipe, type CanvasContext } from "@/lib/canvas/resolve";
import type { Recipe } from "@/lib/canvas/schema";
import { starterRecipes } from "@/lib/canvas/starters";
import { HISTORY_MONTHS, monthBounds, monthsBack } from "@/lib/money/spending";
import { currentHouseholdId } from "@/lib/session";

type Search = Promise<{ pin?: string | string[] }>;

function draw(key: string, recipe: Recipe, context: CanvasContext): Drawn | null {
  try { return { key, title: recipe.title, recipe, blocks: resolveRecipe(recipe, context) }; }
  catch (error) { if (error instanceof CanvasError) return null; throw error; }
}

async function AskContent({ search }: { search: Search }) {
  const { pin: pinParam } = await search;
  const hid = await currentHouseholdId();
  if (!hid) redirect("/");
  const [workspace, suggestions] = await Promise.all([loadWorkspace(hid), withHousehold(db(), hid, tx => openSuggestions(tx, hid))]);
  const { state } = workspace;
  const current = state.today.slice(0, 7);
  const { spending, places, conversation, pins, own, firstUse } = await withHousehold(db(), hid, async tx => {
    // D59: a kind kept on this device is not read here at all; the page reads it in the browser.
    const places = await readPlaces(tx, hid);
    const spending = await loadSpending(tx, hid, { from: monthBounds(monthsBack(current, HISTORY_MONTHS)).first, to: monthBounds(current).last });
    const [conversation, pins, own, firstUse] = await Promise.all([
      places.journal === "device" ? null : latestConversation(tx, hid),
      places.canvases === "device" ? [] : listCanvases(tx, hid),
      connectionView(tx, hid),
      firstUseLine(tx, hid, { skipAnswered: places.journal === "device" }),
    ]);
    return { spending, places, conversation, pins, own, firstUse };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
  const context: CanvasContext = { state, spending };
  const nudgeIds = suggestions.flatMap(row => row.action === "remind" && row.refId ? [row.refId] : []);
  const starters = starterRecipes(state, nudgeIds).flatMap(starter => draw(starter.id, starter.recipe, context) ?? []);

  const pinned = typeof pinParam === "string" ? pins.find(item => item.id === pinParam) ?? null : null;
  const last = conversation?.turns.findLast(turn => turn.recipe !== null);
  const shown = pinned ? draw(`pin-${pinned.id}`, pinned.recipe, context) : last?.recipe ? draw(last.id, last.recipe, context) : null;
  const turns: TurnView[] = (conversation?.turns ?? []).map(turn => ({
    id: turn.id, question: turn.question, kind: turn.kind, text: turn.reply, choices: turn.choices, sources: turn.sources, links: [], thumb: turn.thumb, documentId: turn.documentId ?? null,
  }));
  const missing = missingAskSetting(own !== null);

  return <WorkspaceFrame workspace={workspace} section="canvas">
    <AskPage householdId={hid} places={places} clock={{ isDemo: workspace.demo, fixedToday: workspace.tryIt ? state.today : null, timeZone: workspace.timeZone }} pinId={typeof pinParam === "string" ? pinParam : null} conversationId={conversation?.conversationId ?? crypto.randomUUID()} turns={turns} starters={starters} shown={shown}
      form={{ today: state.today, homeCurrency: state.homeCurrency, cards: state.cards.map(c => ({ id: c.id, label: c.label })) }}
      pin={pinned && shown ? { id: pinned.id, title: pinned.title } : null} firstUse={firstUse} unavailable={missing ? askUnavailable(missing) : null} />
  </WorkspaceFrame>;
}

export default function Page({ searchParams }: { searchParams: Search }) {
  return <Suspense fallback={<LoadingState label="Opening Ask…" />}><AskContent search={searchParams} /></Suspense>;
}
