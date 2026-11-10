import { eq } from "drizzle-orm";
import { z } from "zod";
import { households } from "@/db/schema";
import type { Drawn, TurnView } from "@/lib/agent/view";
import { firstUseLine } from "@/db/ask";
import { connectionView } from "@/db/ai-key";
import { listCanvases } from "@/db/canvases";
import { clockForHousehold, householdMoment } from "@/db/clock";
import { loadMoneyState, requireHousehold, withHousehold, type Db } from "@/db/household";
import { legacyThreads, spaceThread } from "@/db/conversation";
import { listMemory } from "@/db/memory";
import { readPlaces } from "@/db/place";
import { listSpaceChoices, listSpaces } from "@/db/spaces";
import { loadSpending } from "@/db/spending";
import { openSuggestions } from "@/db/suggestions";
import { BriefSchema, type BriefRecord } from "@/lib/agent/brief";
import { askMissingWords, missingAskSetting } from "@/lib/agent/availability";
import { CanvasError, resolveRecipe, type CanvasContext } from "@/lib/canvas/resolve";
import type { Recipe } from "@/lib/canvas/schema";
import { starterRecipes } from "@/lib/canvas/starters";
import { HISTORY_MONTHS, monthBounds, monthsBack } from "@/lib/money/spending";

export const askSpaceId = z.string().uuid().transform(id => id.toLowerCase());

function draw(key: string, recipe: Recipe, context: CanvasContext): Drawn | null {
  try { return { key, title: recipe.title, recipe, blocks: resolveRecipe(recipe, context) }; }
  catch (error) { if (error instanceof CanvasError) return null; throw error; }
}

/** The serializable Ask view for both the page and the panel. */
/** `owner` chooses the words when no model is set: the owner adds a key, a member asks the owner. */
export async function loadAskView(db: Db, householdId: string, { spaceId, legacyId, pinId, owner = true }: {
  spaceId?: string; legacyId?: string; pinId?: string; owner?: boolean;
} = {}) {
  const hid = requireHousehold(householdId);
  return withHousehold(db, hid, async tx => {
    const [household] = await tx.select().from(households).where(eq(households.id, hid));
    if (!household) return null;
    const { isDemo, fixedToday, timeZone } = household;
    const clock = { isDemo, fixedToday, timeZone };
    const { today } = clockForHousehold(clock);
    const places = await readPlaces(tx, hid);
    const spaces = places.journal === "device"
      ? (await listSpaceChoices(tx, hid)).map(item => ({ ...item, brief: null, briefUpdatedAt: null, briefUpdatedBy: null }))
      : await listSpaces(tx, hid);
    const space = spaceId ? spaces.find(item => item.id === spaceId) : spaces.find(item => item.isGeneral);
    if (!space || (!space.isGeneral && legacyId)) return null;
    const earlier = space.isGeneral && places.journal === "cloud" ? await legacyThreads(tx, hid) : [];
    if (places.journal === "cloud" && legacyId && !earlier.some(item => item.id === legacyId)) return null;
    const [state, suggestions, thread, pins, firstUse, memory, own] = await Promise.all([
      loadMoneyState(tx, hid, today, household),
      openSuggestions(tx, hid),
      places.journal === "device" ? [] : spaceThread(tx, hid, legacyId ?? space.id),
      places.canvases === "device" ? [] : listCanvases(tx, hid, { spaceId: space.id, includeLegacy: space.isGeneral }),
      firstUseLine(tx, hid, { skipAnswered: places.journal === "device" }),
      places.memory === "device" ? [] : listMemory(tx, hid),
      connectionView(tx, hid),
    ]);
    const current = today.slice(0, 7);
    const spending = await loadSpending(tx, hid, { from: monthBounds(monthsBack(current, HISTORY_MONTHS)).first, to: monthBounds(current).last });
    const context: CanvasContext = { state, spending };
    const nudgeIds = suggestions.flatMap(row => row.action === "remind" && row.refId ? [row.refId] : []);
    const starters = starterRecipes(state, nudgeIds).flatMap(starter => draw(starter.id, starter.recipe, context) ?? []);

    const pinned = pinId ? pins.find(item => item.id === pinId) ?? null : null;
    const last = thread.findLast(turn => turn.recipe !== null);
    const shown = pinned ? draw(`pin-${pinned.id}`, pinned.recipe, context) : last?.recipe ? draw(last.id, last.recipe, context) : null;
    const turns: TurnView[] = thread.map(turn => ({
      id: turn.id, question: turn.question, kind: turn.kind, text: turn.reply, choices: turn.choices, sources: turn.sources, links: [], thumb: turn.thumb, documentId: turn.documentId ?? null,
    }));
    const missing = missingAskSetting(own !== null);
    const brief: BriefRecord | null = !legacyId && space.briefUpdatedAt && (space.briefUpdatedBy === "ask" || space.briefUpdatedBy === "form")
      ? { brief: BriefSchema.parse(space.brief), updatedAt: space.briefUpdatedAt.toISOString(), updatedBy: space.briefUpdatedBy } : null;

    const cloudMemory = {
      notes: legacyId ? [] : memory.filter(item => item.spaceId === space.id),
      profileIds: memory.filter(item => !item.spaceId).map(item => item.id),
      totalCount: memory.length,
    };
    return {
      householdId: hid, places, clock, memoryMoment: householdMoment(clock).toISOString(), cloudMemory,
      space: { id: space.id, name: space.name, isGeneral: space.isGeneral, status: space.status },
      spaces: spaces.map(({ id, name, status }) => ({ id, name, status })), earlier, legacyId: legacyId ?? null,
      pinId: pinId ?? null, pins: pins.map(({ id, title }) => ({ id, title })),
      turns, starters, shown, cloudBrief: brief,
      form: { today, homeCurrency: state.homeCurrency, cards: state.cards.map(({ id, label }) => ({ id, label })) },
      pin: pinned && shown ? { id: pinned.id, title: pinned.title } : null, firstUse, unavailable: missing ? askMissingWords(missing, owner) : null,
    };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}

export type AskView = NonNullable<Awaited<ReturnType<typeof loadAskView>>>;
