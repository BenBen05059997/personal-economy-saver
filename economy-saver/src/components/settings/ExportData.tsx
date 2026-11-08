"use client";

import { useState, type FormEvent } from "react";
import { z } from "zod";
import { MemoryItem } from "@/lib/schema/memory";
import { ConversationTurn } from "@/lib/schema/turn";
import { listDevice, readDeviceJournal, type DeviceKind } from "@/lib/store/device";

const Parts = z.object({ memory: z.array(MemoryItem), journal: z.array(ConversationTurn) });

/**
 * Export my data (D44, D59). With nothing kept on this device it is the plain form post (it works without JavaScript). When memory, canvases or
 * conversations are kept on this device, the server's file does not hold them: the browser fetches the file, puts this device's items into it
 * and saves it, so the one file is whole.
 */
export function ExportData({ householdId, device }: { householdId: string; device: DeviceKind[] }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    if (device.length === 0) return; // the browser posts the form itself
    event.preventDefault();
    if (busy) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/export", { method: "POST" });
      if (!response.ok) throw new Error(await response.text());
      const file = await response.json() as Record<string, unknown> & { household: { today: string } };
      const spaces = Array.isArray(file.spaces) ? file.spaces as { id: string }[] : [];
      const spaceIds = new Set(spaces.map(space => space.id));
      const inKnownSpace = (item: { spaceId?: string | null }) => !item.spaceId || spaceIds.has(item.spaceId);
      if (device.includes("memory") || device.includes("journal")) {
        const [memory, journal] = await Promise.all([
          device.includes("memory") ? listDevice(householdId, "memory") : file.memory ?? [],
          device.includes("journal") ? readDeviceJournal(householdId) : null,
        ]);
        const parts = Parts.parse({
          memory,
          journal: journal?.turns ?? file.journal ?? [],
        });
        if (device.includes("memory")) file.memory = parts.memory.filter(inKnownSpace);
        if (journal) {
          file.journal = parts.journal.filter(inKnownSpace).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
          const briefs = new Map(journal.briefs.map(item => [item.id, item]));
          file.spaces = spaces.map(space => {
            const item = briefs.get(space.id);
            return item ? { ...space, brief: item.brief, briefUpdatedAt: item.updatedAt, briefUpdatedBy: item.updatedBy } : space;
          });
        }
      }
      if (device.includes("canvases")) {
        file.canvases = (await listDevice(householdId, "canvases")).filter(inKnownSpace).map(({ id, title, position, recipe, createdAt, spaceId }) => ({ id, title, position, recipe, createdAt, ...(spaceId && { spaceId }) }));
      }
      const url = URL.createObjectURL(new Blob([JSON.stringify(file, null, 2) + "\n"], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url; link.download = `personal-economy-saver-${file.household.today}.json`;
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setMessage("Saved, with what you keep on this device added.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Couldn’t export. Try again."); }
    finally { setBusy(false); }
  }
  return <form method="post" action="/api/export" onSubmit={event => void submit(event)}>
    <button className="ui-button" disabled={busy}>{busy ? "Exporting…" : device.length > 0 ? "Export from this device" : "Export my data"}</button>
    <p role="status" className="ui-hint">{message}</p>
  </form>;
}
