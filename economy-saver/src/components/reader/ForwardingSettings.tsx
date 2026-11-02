import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { requireHousehold } from "@/db/household";
import { households } from "@/db/schema";
import { ReaderError, readerSetting } from "@/lib/reader/settings";
import "./reader.css";

export async function ForwardingSettings({ householdId }: { householdId: string }) {
  let status: string | null = null;
  let address: string | null = null;
  try {
    const domain = readerSetting("FORWARDING_DOMAIN");
    readerSetting("INBOUND_ADDRESS_KEY");
    readerSetting("INBOUND_WORKER_SECRET");
    const [row] = await db().select({ token: households.forwardingLocalpart }).from(households)
      .where(eq(households.id, requireHousehold(householdId)));
    if (row?.token) address = row.token + "@" + domain;
  } catch (error) {
    if (!(error instanceof ReaderError)) throw error;
    status = error.message;
  }
  return <section id="forwarding" className="ui-panel">
    <h2>Forwarding address</h2>
    {status ? <p className="ui-hint">{status}</p> : address ? <p className="reader-address">{address}</p> :
      <form method="post" action="/api/forwarding"><button className="ui-button">Create forwarding address</button></form>}
    <p className="ui-hint">Forward a bill or card email here, then review what was read in To check.</p>
  </section>;
}
