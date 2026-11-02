import type { ReactNode } from "react";
import { db } from "@/db/client";
import { toCheck } from "@/lib/money/to-check";
import { householdClock } from "@/db/account";
import { readerInbox } from "@/db/reader-inbox";
import { refreshPayPal } from "@/db/paypal-refresh";
import { observeRunway, lockRunway } from "@/db/runway-events";
import { eventFeed } from "@/db/event-feed";
import { householdOwnerName, loadMoneyState } from "@/db/household";
import { Shell, type Section } from "./Shell";

export async function loadWorkspace(hid: string, home = false) {
  const freshness = home ? await refreshPayPal(db(), hid) : null;
  return db().transaction(async tx => {
    if (home) await lockRunway(tx, hid);
    const { today, timeZone } = await householdClock(tx, hid);
    const [state, name, inbox] = await Promise.all([
      loadMoneyState(tx, hid, today), householdOwnerName(tx, hid), readerInbox(tx, hid),
    ]);
    if (home) await observeRunway(tx, hid, state);
    const feed = await eventFeed(tx, hid);
    return { state, name, feed, timeZone, inbox, freshness };
  }, home ? {} : { isolationLevel: "repeatable read", accessMode: "read only" });
}

export function WorkspaceFrame({ workspace, section, children }: {
  workspace: Awaited<ReturnType<typeof loadWorkspace>>;
  section: Section;
  children: ReactNode;
}) {
  const { state, feed, name } = workspace;
  const pending = toCheck(state).length + workspace.inbox.readings.length;
  return <Shell name={name} pending={pending} feed={feed} section={section}>{children}</Shell>;
}
