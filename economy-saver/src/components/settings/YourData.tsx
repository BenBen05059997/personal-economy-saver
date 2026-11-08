import Link from "next/link";
import { householdClock } from "@/db/account";
import { db } from "@/db/client";
import { withHousehold } from "@/db/household";
import { listSpaces } from "@/db/spaces";
import { countKinds, listDocuments, type DataKind } from "@/db/data-kinds";
import { DEMO_STORAGE_CAP_BYTES, STORAGE_CAP_BYTES, storedBytes } from "@/db/document-cleanup";
import { isMovable, readPlaces } from "@/db/place";
import { ConfirmRemove } from "@/components/ui/ConfirmRemove";
import { currentHouseholdId } from "@/lib/session";
import { hrefForRef } from "@/lib/links";
import { DataPlace } from "./DataPlace";
import { ExportData } from "./ExportData";
import { ImportFile } from "./ImportFile";

const ROWS: { kind: DataKind; name: string; unit: [string, string]; what: string; all?: string; href?: { to: string; label: string } }[] = [
  { kind: "record", name: "Your numbers", unit: ["item", "items"], what: "Bills, charges, statements, clients, invoices, pots and settlements. The forecast is built from them." },
  { kind: "memory", name: "What the assistant remembers", unit: ["thing", "things"], what: "Facts, preferences, goals and corrections you gave it.", all: "all the assistant remembers", href: { to: "/memory", label: "See what it remembers" } },
  { kind: "canvases", name: "Canvases pinned to Home", unit: ["canvas", "canvases"], what: "Layouts only; they hold no numbers, so they always show today’s.", all: "all pinned canvases" },
  { kind: "journal", name: "Ask conversations", unit: ["item", "items"], what: "Your conversation turns, briefs and named spaces.", all: "all conversations, briefs and named spaces" },
  { kind: "reminders", name: "Reminder history", unit: ["delivery", "deliveries"], what: "Sent and failed reminders from the last 30 days.", all: "all reminder history" },
  { kind: "push_subscriptions", name: "Push subscriptions", unit: ["device", "devices"], what: "The push connection for each device that turned it on.", all: "all push subscriptions" },
  { kind: "documents", name: "Uploaded documents", unit: ["document", "documents"], what: "Files you uploaded or forwarded, and the readings waiting in To check. Bills and charges you confirmed stay.", all: "all uploaded documents" },
];

const fileNumber = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

function fileSize(bytes: number): string {
  if (bytes < 1024) return fileNumber.format(bytes) + " B";
  if (bytes < 1024 ** 2) return fileNumber.format(bytes / 1024) + " KB";
  return fileNumber.format(bytes / (1024 ** 2)) + " MB";
}

/** Settings → "Your data" (D59): each kind of stored data, where it is kept, how much, and the delete for it; then export, import and delete everything. */
export async function YourData({ canDeleteHousehold = true }: { canDeleteHousehold?: boolean }) {
  const hid = await currentHouseholdId();
  const [counts, places, documents, storageBytes, clock, spaces] = hid ? await withHousehold(db(), hid, tx => Promise.all([
    countKinds(tx, hid), readPlaces(tx, hid), listDocuments(tx, hid), storedBytes(tx, hid), householdClock(tx, hid), listSpaces(tx, hid),
  ]), { isolationLevel: "repeatable read", accessMode: "read only" }) : [null, null, [], 0, null, []];
  const device = places ? (["memory", "canvases", "journal"] as const).filter(kind => places[kind] === "device") : [];
  const dateFormat = new Intl.DateTimeFormat("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: clock?.timeZone });
  return <section className="ui-panel" id="your-data"><h2>Your data</h2>
    <p className="ui-hint">What the app keeps about you, where it is kept, and how to delete it. A question you ask goes to the household’s AI model.</p>
    {ROWS.map(row => {
      const n = counts?.[row.kind] ?? 0;
      const note = row.kind === "journal" ? "This also removes the named spaces’ notes and pins. The General space and documents stay." : "This can’t be undone.";
      const remove = row.all && n > 0 ? <ConfirmRemove kind="data" id={row.kind} label={row.all} note={note} returnTo="/settings" /> : null;
      if (hid && places && row.all && isMovable(row.kind)) {
        return <DataPlace key={row.kind} householdId={hid} kind={row.kind} place={places[row.kind]} cloudCount={n} name={row.name} unit={row.unit} what={row.what} all={row.all} journalSpaceCount={row.kind === "journal" ? spaces.filter(space => !space.isGeneral).length : undefined} href={row.href}>{remove}</DataPlace>;
      }
      return <div key={row.kind} className="settings-bill" data-kind={row.kind}>
        <p>{row.name} · {n} {row.unit[n === 1 ? 0 : 1]}</p>
        <p className="ui-hint">In our cloud, Tokyo. {row.what}</p>
        {row.kind === "documents" && clock && <>
          <p className="ui-hint">{fileSize(storageBytes)} of {fileSize(clock.isDemo ? DEMO_STORAGE_CAP_BYTES : STORAGE_CAP_BYTES)} used</p>
          {documents.length > 0 && <ul className="settings-documents" role="list">
            {documents.map(doc => {
              const readingHref = doc.waitingReadingId ? hrefForRef("reading", doc.waitingReadingId) : null;
              return <li key={doc.id}>
                <p>{doc.name}</p>
                <p className="ui-hint"><time dateTime={doc.createdAt.toISOString()}>{dateFormat.format(doc.createdAt)}</time>
                  {" · "}{doc.bytes > 0 ? fileSize(doc.bytes) : "Size unavailable"}{doc.fileRemoved && " · File removed"}
                </p>
                {readingHref && <Link className="account-link" prefetch={false} href={readingHref}>Open in To check ›</Link>}
                <ConfirmRemove kind="data" what="documents" id={doc.id} label={doc.name} note="This can’t be undone." returnTo="/settings" />
              </li>;
            })}
          </ul>}
        </>}
        {row.href && <Link className="account-link" href={row.href.to}>{row.href.label} ›</Link>}
        {row.all ? remove : <p className="ui-hint">Deleted only with everything else.</p>}
      </div>;
    })}
    <div className="settings-bill"><p>Export my data</p>
      <p className="ui-hint">Download your record, Memory, canvases, Ask conversations and Activity as one JSON file. Whatever you keep on this device only is added from this browser. It has no AI key, sign-in details or uploaded files.</p>
      {hid && <ExportData householdId={hid} device={device} />}</div>
    <div className="settings-bill"><p>Import</p>
      <p className="ui-hint">Bring a file you exported back. It works on an empty household only, so start with your numbers first and then import.</p>
      <ImportFile /></div>
    {canDeleteHousehold && <div className="settings-bill"><p>Delete everything</p>
      <p className="ui-hint">Deletes the household and all of the above for good.</p>
      <Link className="ui-button" prefetch={false} href="/account">Delete everything</Link></div>}
  </section>;
}
