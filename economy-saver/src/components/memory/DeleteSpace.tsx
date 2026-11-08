"use client";

import { useState } from "react";
import type { Places } from "@/db/place";
import { ConfirmRemove } from "@/components/ui/ConfirmRemove";
import { deleteDeviceSpace, type DeviceKind } from "@/lib/store/device";

const DEVICE_KINDS = ["memory", "canvases", "journal"] satisfies DeviceKind[];

export function DeleteSpace({ householdId, places, id, name }: { householdId: string; places: Places; id: string; name: string }) {
  const [problem, setProblem] = useState("");
  const kinds = DEVICE_KINDS.filter(kind => places[kind] === "device");
  return <>
    <ConfirmRemove kind="space" id={id} label={name} returnTo="/memory?tab=spaces"
      note="Its thread, notes, pinned canvases and brief are removed. Attached documents stay."
      onDone={kinds.length === 0 ? undefined : async () => {
        try { await deleteDeviceSpace(householdId, id, kinds); }
        catch { setProblem("The space is deleted. This browser couldn’t clear its copies."); }
      }} />
    {problem && <p role="alert" className="ui-problem">{problem}</p>}
  </>;
}
