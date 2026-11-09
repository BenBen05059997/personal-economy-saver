"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAskPanel } from "@/components/shell/AskWorkspace";
import type { Movable, Place } from "@/db/place";
import { clearDevice, clearMovedDeviceJournal, countDevice, listDevice, readDeviceJournal, replaceDevice, replaceDeviceJournal, type DeviceJournal } from "@/lib/store/device";

type Props = {
  householdId: string; kind: Movable; place: Place; cloudCount: number; name: string; unit: [string, string]; what: string; all: string;
  journalSpaceCount?: number;
  href?: { to: string; label: string };
  /** The delete for the cloud copy (a server-rendered form), shown only while the kind is in our cloud. */
  children?: ReactNode;
};

class MoveResponseError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
const wordsOf = (error: unknown) => (error instanceof Error ? error.message : "Something went wrong. Nothing was changed.");
async function post(body: unknown): Promise<unknown> {
  const response = await fetch("/api/data/move", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!response.ok) throw new MoveResponseError(await response.text(), response.status);
  return response.json();
}

/**
 * One movable row of Your data (D59): where this kind is kept, how much, what the choice costs in words, the switch between our cloud and this
 * device only, and the delete. Moving to the device: fetch the items, store them, read the count back, then confirm (the server deletes its
 * copies and sets the place in one transaction). Back to the cloud: post the items; once the server has them the browser clears its copy.
 */
export function DataPlace({ householdId, kind, place, cloudCount, name, unit, what, all, href, journalSpaceCount, children }: Props) {
  const router = useRouter();
  const askPanel = useAskPanel();
  const [deviceCount, setDeviceCount] = useState<number | null>(null);
  const [panel, setPanel] = useState<"move" | "delete" | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const onDevice = place === "device";

  useEffect(() => {
    if (!onDevice) return;
    let cancelled = false;
    countDevice(householdId, kind).then(n => { if (!cancelled) setDeviceCount(n); }, error => { if (!cancelled) setMessage(wordsOf(error)); });
    return () => { cancelled = true; };
  }, [householdId, kind, onDevice]);

  async function move() {
    setBusy(true); setMessage("");
    try {
      if (kind === "journal") {
        if (!onDevice) {
          const { items, briefs, briefRevision } = await post({ step: "read", what: "journal" }) as
            { items: DeviceJournal["turns"]; briefs: DeviceJournal["briefs"]; briefRevision?: string };
          await replaceDeviceJournal(householdId, { turns: items, briefs });
          const stored = await readDeviceJournal(householdId);
          if (stored.turns.length !== items.length || stored.briefs.length !== briefs.length) {
            throw new Error("This browser did not keep the whole journal, so nothing was moved.");
          }
          try { await post({ step: "to_device", what: "journal", ids: items.map(turn => turn.id), briefRevision }); }
          catch (error) {
            // A lost response or another tab's confirmation may have followed a commit. Discard only a proven stale copy.
            if (error instanceof MoveResponseError && error.status === 409) await clearMovedDeviceJournal(householdId, stored).catch(() => false);
            else { askPanel?.invalidate(); router.refresh(); }
            throw error;
          }
        } else {
          const stored = await readDeviceJournal(householdId);
          await post({ step: "to_cloud", what: "journal", items: stored.turns, briefs: stored.briefs });
          try {
            if (!await clearMovedDeviceJournal(householdId, stored)) setMessage("Moved the journal to our cloud. This browser kept a copy because it changed during the move.");
          } catch { setMessage("Moved to our cloud, but this browser could not clear its own copy."); }
        }
      } else if (!onDevice) {
        const { items } = await post({ step: "read", what: kind }) as { items: { id: string }[] };
        await replaceDevice(householdId, kind, items as never);
        if ((await listDevice(householdId, kind)).length !== items.length) throw new Error("This browser did not keep everything, so nothing was moved.");
        try { await post({ step: "to_device", what: kind, ids: items.map(item => item.id) }); }
        catch (error) { await clearDevice(householdId, kind).catch(() => 0); throw error; }
      } else {
        const items = await listDevice(householdId, kind);
        await post({ step: "to_cloud", what: kind, items });
        try { await clearDevice(householdId, kind); } catch { setMessage("Moved to our cloud, but this browser could not clear its own copy."); }
      }
      setPanel(null);
      askPanel?.invalidate();
      router.refresh();
    } catch (error) { setMessage(wordsOf(error)); }
    finally { setBusy(false); }
  }

  async function remove() {
    setBusy(true); setMessage("");
    try {
      await clearDevice(householdId, kind);
      setDeviceCount(0);
      setPanel(null);
      askPanel?.invalidate();
    } catch (error) { setMessage(wordsOf(error)); }
    finally { setBusy(false); }
  }

  const n = onDevice ? deviceCount : cloudCount;
  const deleteLabel = onDevice && kind === "journal" ? "all conversations and briefs" : all;
  const description = onDevice && kind === "journal" ? "Your conversation turns and briefs." : what;
  return <div className="settings-bill" data-kind={kind} data-place={place}>
    <p>{name} · {n === null ? "…" : `${n} ${unit[n === 1 ? 0 : 1]}`}</p>
    <p className="ui-hint">{onDevice ? "On this device only." : "In our cloud, Tokyo."} {description}</p>
    {kind === "journal" && !onDevice && <p className="ui-hint">Deleting Ask conversations removes each named space with its notes and pins kept in our cloud.</p>}
    {onDevice && journalSpaceCount !== undefined && <p className="ui-hint">{journalSpaceCount} named {journalSpaceCount === 1 ? "space" : "spaces"} in our cloud. Delete spaces one at a time in <Link href="/memory?tab=spaces">Memory → Spaces</Link>.</p>}
    {onDevice
      ? <p className="ui-hint">Other devices and connected assistants (MCP) see none of it. Clearing this browser’s data deletes it. The export file holds only what our cloud has, so Export from this device adds this to the file.</p>
      : <p className="ui-hint">You can keep this on this device only instead.</p>}
    {href && <Link className="account-link" href={href.to}>{href.label} ›</Link>}
    {onDevice && n !== null && n > 0 && <details className="ui-remove" open={panel === "delete"} onToggle={event => setPanel(event.currentTarget.open ? "delete" : null)}>
      <summary aria-label={`Delete ${deleteLabel}`}>Delete</summary>
      <p>Delete {deleteLabel} from this device? This can’t be undone.</p>
      <div className="ui-remove-buttons"><button type="button" className="ui-button" onClick={() => setPanel(null)}>Keep</button>
        <button type="button" className="ui-button" disabled={busy} onClick={() => void remove()}>Delete</button></div>
    </details>}
    {!onDevice && children}
    <details className="ui-remove" open={panel === "move"} onToggle={event => setPanel(event.currentTarget.open ? "move" : null)}>
      <summary>{onDevice ? "Move back to our cloud" : "Keep on this device only"}</summary>
      <p>{onDevice
        ? "Our cloud will keep this again, so your other devices and connected assistants can use it. This browser’s copy is cleared."
        : "It moves to this browser and our cloud’s copy is deleted. Your other devices and connected assistants (MCP) will see none of it, clearing this browser’s data deletes it, and each question you ask carries it to the AI model for that question only, so nothing is kept on our side."}</p>
      <div className="ui-remove-buttons"><button type="button" className="ui-button" onClick={() => setPanel(null)}>Cancel</button>
        <button type="button" className="ui-button primary" disabled={busy} onClick={() => void move()}>{busy ? "Moving…" : onDevice ? "Move to our cloud" : "Move to this device"}</button></div>
    </details>
    <p role="status" className="ui-hint">{message}</p>
  </div>;
}
