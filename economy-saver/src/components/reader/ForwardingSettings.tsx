import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { withHousehold } from "@/db/household";
import { households } from "@/db/schema";
import { ReaderError, readerSetting } from "@/lib/reader/settings";
import "./reader.css";

const FORWARDING_SETTINGS = ["FORWARDING_DOMAIN", "INBOUND_ADDRESS_KEY", "INBOUND_WORKER_SECRET"] as const;

/** The first setting email forwarding needs that this server lacks, or null when forwarding is set up. Home hides its Forward links on a name. */
export function missingForwardingSetting(): string | null {
  for (const name of FORWARDING_SETTINGS) {
    try { readerSetting(name); } catch (error) {
      if (error instanceof ReaderError) return name;
      throw error;
    }
  }
  return null;
}

export async function ForwardingSettings({ householdId }: { householdId: string }) {
  let status: string | null = null;
  let address: string | null = null;
  const missing = missingForwardingSetting();
  if (missing) status = `Email forwarding isn’t available on this server yet (${missing}).`;
  else try {
    const domain = readerSetting("FORWARDING_DOMAIN");
    const [row] = await withHousehold(db(), householdId, async tx => tx.select({ token: households.forwardingLocalpart }).from(households)
      .where(eq(households.id, householdId)));
    if (row?.token) address = row.token + "@" + domain;
  } catch (error) {
    if (!(error instanceof ReaderError)) throw error;
    status = error.message;
  }
  return <section id="forwarding" className="ui-panel">
    <h2>Forwarding address</h2>
    {status ? <p className="ui-hint">{status}</p> : address ? <p className="reader-address">{address}</p> :
      <form method="post" action="/api/forwarding"><button className="ui-button">Create forwarding address</button></form>}
    {!missing && <p className="ui-hint">Forward a bill or card email here, then review what was read in To check.</p>}
    {!missing && <details className="settings-dev"><summary>For developers</summary>
      <p className="ui-hint">Mail to the address reaches a Cloudflare Email Worker, which posts it to the app. It is set up with FORWARDING_DOMAIN, INBOUND_ADDRESS_KEY and INBOUND_WORKER_SECRET.</p></details>}
  </section>;
}
