import { ApiForm } from "@/components/ui/ApiForm";
import { listCanvases, type PinnedCanvas } from "@/db/canvases";
import { db } from "@/db/client";
import { readPlaces } from "@/db/place";
import { DevicePins } from "./DevicePins";
import { PinCard } from "./PinCard";
import { loadSpending } from "@/db/spending";
import { CanvasError, resolveRecipe, type CanvasContext, type ResolvedBlock } from "@/lib/canvas/resolve";
import { HISTORY_MONTHS, monthBounds, monthsBack } from "@/lib/money/spending";
import type { MoneyState } from "@/lib/money/types";
import { currentHouseholdId } from "@/lib/session";

function PinForm({ pin, kind, direction, label, disabled }: { pin: PinnedCanvas; kind: "move" | "unpin"; direction?: "up" | "down"; label: string; disabled?: boolean }) {
  return <ApiForm action="/api/canvases" className="home-pin-form">
    <input type="hidden" name="kind" value={kind} /><input type="hidden" name="id" value={pin.id} />
    {direction && <input type="hidden" name="direction" value={direction} />}
    <input type="hidden" name="returnTo" value="/" />
    <button className="home-pin-button" disabled={disabled}>{label}</button>
  </ApiForm>;
}

/**
 * The canvases pinned to Home (D57), in order, drawn here by the engine from the saved recipe: no model call. A pin that cannot be drawn
 * (a client or bill it names is gone, so the whole recipe is refused) says why and offers Unpin. With no pins this renders nothing.
 */
export async function Pinned({ state }: { state: MoneyState }) {
  const hid = await currentHouseholdId();
  if (!hid) return null;
  // Pins kept on this device only (D59) are read in the browser and drawn through the resolve route; the server holds none of them.
  if ((await readPlaces(db(), hid)).canvases === "device") return <DevicePins householdId={hid} />;
  const pins = await listCanvases(db(), hid);
  if (pins.length === 0) return null;
  const current = state.today.slice(0, 7);
  const spending = await loadSpending(db(), hid, { from: monthBounds(monthsBack(current, HISTORY_MONTHS)).first, to: monthBounds(current).last });
  const context: CanvasContext = { state, spending };
  return <section id="pins" className="home-pins" aria-label="Pinned canvases">
    {pins.map((pin, index) => {
      let blocks: ResolvedBlock[] | null = null;
      let words = "";
      try { blocks = resolveRecipe(pin.recipe, context); }
      catch (error) { if (error instanceof CanvasError) words = error.message; else throw error; }
      return <PinCard key={pin.id} id={pin.id} title={pin.title} recipe={pin.recipe} blocks={blocks} words={words} actions={<>
        <PinForm pin={pin} kind="move" direction="up" label="Move up" disabled={index === 0} />
        <PinForm pin={pin} kind="move" direction="down" label="Move down" disabled={index === pins.length - 1} />
        <PinForm pin={pin} kind="unpin" label="Unpin" />
      </>} />;
    })}
  </section>;
}
