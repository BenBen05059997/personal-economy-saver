"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { ApiForm } from "@/components/ui/ApiForm";
import { pinOnDevice } from "@/lib/store/device";
import { titleOf } from "@/lib/canvas/schema";
import type { ViewId } from "@/lib/views/types";

/** Pin to Home for a one-block recipe: the same cloud post as Ask's Pin to Home, or this device's store when the household keeps its canvases here (`device` carries the household id). */
export function PinView({ view, args, title, device }: { view: ViewId; args: Record<string, unknown>; title: string; device?: { householdId: string } }) {
  const pathname = usePathname() ?? "/";
  const [state, setState] = useState<"idle" | "pinned" | "problem">("idle");
  const recipe = { version: 1, title: titleOf(title), blocks: [{ type: "view", view, args }] };
  if (device) {
    async function pin() {
      try { await pinOnDevice(device!.householdId, { title: recipe.title, recipe }); setState("pinned"); } catch { setState("problem"); }
    }
    return <div className="view-pin">
      <button type="button" className="ui-button" onClick={() => void pin()}>Pin to Home</button>
      {state === "pinned" && <p className="ui-hint" role="status">Pinned on this device.</p>}
      {state === "problem" && <p className="ui-hint" role="alert">This could not be pinned on this device.</p>}
    </div>;
  }
  return <ApiForm action="/api/canvases" className="view-pin">
    <input type="hidden" name="kind" value="pin" /><input type="hidden" name="title" value={recipe.title} />
    <input type="hidden" name="recipe" value={JSON.stringify(recipe)} /><input type="hidden" name="returnTo" value={pathname} />
    <button className="ui-button">Pin to Home</button>
  </ApiForm>;
}
