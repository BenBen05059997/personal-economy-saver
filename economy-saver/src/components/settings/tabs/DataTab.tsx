import { Suspense } from "react";
import { LoadingIndicator } from "@/components/ui/LoadingState";
import { YourData } from "../YourData";

/** Settings → Your data: what the app keeps and where, with export, import and delete. */
export function DataTab({ canManage }: { canManage: boolean }) {
  return <Suspense fallback={<section className="ui-panel" id="your-data"><h2>Your data</h2><LoadingIndicator label="Loading…" /></section>}>
    <YourData canDeleteHousehold={canManage} /></Suspense>;
}
