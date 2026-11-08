"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ApiForm } from "@/components/ui/ApiForm";
import type { Places } from "@/db/place";
import type { Space } from "@/db/spaces";
import { readDeviceBriefs } from "@/lib/store/device";
import { DeleteSpace } from "./DeleteSpace";
import "./memory.css";

function SpaceName({ value }: { value?: string }) {
  return <label className="ui-field">Space name<input name="name" defaultValue={value} maxLength={60} required /></label>;
}

export type SpaceOverview = Pick<Space, "id" | "name" | "status" | "isGeneral"> & { about: string | null };

export function SpacesView({ spaces, householdId, places }: { spaces: SpaceOverview[]; householdId: string; places: Places }) {
  const [localAbout, setLocalAbout] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState("");
  const deviceJournal = places.journal === "device";
  useEffect(() => {
    if (!deviceJournal) return;
    let cancelled = false;
    readDeviceBriefs(householdId).then(briefs => {
      if (cancelled) return;
      setLocalAbout(Object.fromEntries(briefs.map(item => [item.id, item.brief.about])));
      setProblem("");
    }, error => {
      if (!cancelled) setProblem(error instanceof Error ? error.message : "Couldn’t read this device’s briefs.");
    });
    return () => { cancelled = true; };
  }, [deviceJournal, householdId]);
  const open = spaces.filter(space => space.status === "open");
  const archived = spaces.filter(space => space.status === "archived");
  function row(space: SpaceOverview) {
    const about = (deviceJournal ? localAbout[space.id] : space.about)?.split(/\r?\n/, 1)[0];
    return <li key={space.id} className="memory-item">
      <Link href={`/canvas?space=${space.id}`} prefetch={false} className="ui-button">{space.name}</Link>
      {about && <p className="ui-hint">{about}</p>}
      {!space.isGeneral && <div className="memory-actions">
        {space.status === "open" && <>
          <details className="memory-edit">
            <summary aria-label={`Rename ${space.name}`}>Rename</summary>
            <ApiForm action="/api/spaces">
              <input type="hidden" name="kind" value="rename" /><input type="hidden" name="id" value={space.id} />
              <SpaceName value={space.name} />
              <button className="ui-button primary">Save name</button>
            </ApiForm>
          </details>
          <ApiForm action="/api/spaces">
            <input type="hidden" name="kind" value="archive" /><input type="hidden" name="id" value={space.id} />
            <button className="ui-button" aria-label={`Archive ${space.name}`}>Archive</button>
          </ApiForm>
        </>}
        <DeleteSpace householdId={householdId} places={places} id={space.id} name={space.name} />
      </div>}
    </li>;
  }
  return <div className="memory-page">
    <header><h1 className="ui-title">Spaces</h1><p className="ui-hint">Keep a separate Ask thread for each task.</p></header>
    <details className="memory-edit">
      <summary>New space</summary>
      <ApiForm action="/api/spaces">
        <input type="hidden" name="kind" value="create" />
        <SpaceName />
        <button className="ui-button primary">Create space</button>
      </ApiForm>
    </details>
    {deviceJournal && problem && <p role="alert" className="ui-problem">{problem}</p>}
    <ul>{open.map(row)}</ul>
    {archived.length > 0 && <details className="memory-edit">
      <summary>Archived spaces</summary>
      <ul>{archived.map(row)}</ul>
    </details>}
  </div>;
}
