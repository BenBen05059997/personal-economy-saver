"use client";

import { useId, useState } from "react";
import { ApiForm } from "@/components/ui/ApiForm";

export function OpenSpaceProposal({ name, hidden }: { name: string; hidden: boolean }) {
  const [dismissed, setDismissed] = useState(false);
  const description = useId();
  if (dismissed || hidden) return null;
  return <div className="ask-keep">
    <p id={description}>{`Open space '${name}'?`}</p>
    <ApiForm action="/api/spaces" onDone={() => setDismissed(true)}>
      <input type="hidden" name="kind" value="create" />
      <input type="hidden" name="name" value={name} />
      <div className="ask-choices">
        <button type="submit" className="ui-button primary" aria-describedby={description}>Open space</button>
        <button type="button" className="ui-button" aria-describedby={description} onClick={() => setDismissed(true)}>Not now</button>
      </div>
    </ApiForm>
  </div>;
}
