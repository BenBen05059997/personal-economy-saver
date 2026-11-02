// Build fictional database-backed review states for the private local demo recording.
// PayPal transport is simulated and applyVerifiedDelivery receives a verified test event.
import { writeFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import { approveInvoice, invoiceReview, type InvoiceTool } from "@/db/approval";
import { confirmPending } from "@/db/confirm";
import { DEMO_DATE } from "@/db/demo";
import { householdOwnerName, loadMoneyState } from "@/db/household";
import { readerInbox } from "@/db/reader-inbox";
import * as schema from "@/db/schema";
import { seedBen } from "@/db/seed";
import { applyVerifiedDelivery } from "@/lib/events";
import { homeSentence } from "@/lib/money/sentence";

const out = process.argv[2];
if (!out) throw new Error("Supply a local output path");

function recordingReview(row: NonNullable<Awaited<ReturnType<typeof invoiceReview>>>) {
  const i = row.invoice;
  return { client: row.client, invoice: {
    id: i.id, number: i.number, item: i.item, amountMinor: i.amountMinor, currency: i.currency,
    status: i.status, dueOn: i.dueOn, note: i.note, fxRateMicro: i.fxRateMicro,
    paidOn: i.paidOn, remindedAt: i.remindedAt, reminderAttemptedAt: i.reminderAttemptedAt,
    paypalInvoiceId: i.paypalInvoiceId, approveKey: "LOCAL-REHEARSAL-ONLY",
  } };
}

async function main() {
  const pg = new PGlite();
  try {
    const db = drizzle(pg, { schema });
    await migrate(db, { migrationsFolder: "./drizzle" });
    const householdId = await seedBen(db, { isDemo: true });
    const name = await householdOwnerName(db, householdId);
    const inbox = await readerInbox(db, householdId);
    const home = async () => ({ state: await loadMoneyState(db, householdId, DEMO_DATE), inbox });
    const stages: Record<string, unknown> = { before: await home() };
    const beforeState = (stages.before as { state: Awaited<ReturnType<typeof loadMoneyState>> }).state;
    if (!homeSentence(beforeState).emphasis.includes("¥18,780")) throw new Error("Seeded before sentence changed");
    const hikari = (await db.select().from(schema.bills).where(eq(schema.bills.householdId, householdId))).find(row => row.biller === "Hikari Denki");
    if (!hikari || !await confirmPending(db, householdId, "bill", hikari.id)) throw new Error("Expected pending seeded Hikari bill");
    stages.confirmed = await home();
    const confirmedState = (stages.confirmed as { state: Awaited<ReturnType<typeof loadMoneyState>> }).state;
    if (!homeSentence(confirmedState).emphasis.includes("¥30,000")) throw new Error("Hikari confirmation did not change the runway as expected");
    const target = (await db.select().from(schema.invoices).where(eq(schema.invoices.householdId, householdId))).find(row => row.status === "unbilled");
    if (!target) throw new Error("Expected seeded unbilled invoice");
    const review = await invoiceReview(db, householdId, target.id);
    if (!review) throw new Error("Seeded invoice review not found");
    stages.review = { review: recordingReview(review), state: (stages.confirmed as { state: Awaited<ReturnType<typeof loadMoneyState>> }).state };
    const recipient = "buyer@example.test";
    const remoteId = "INV2-LOCAL-REHEARSAL-400";
    let remoteStatus = "DRAFT";
    const tool: InvoiceTool = async method => {
      if (method === "search_invoicing") return { items: [] };
      if (method === "create_invoice") return { href: `https://api-m.sandbox.paypal.com/v2/invoicing/invoices/${remoteId}` };
      if (method === "get_invoice") return { id: remoteId, status: remoteStatus, primary_recipients: [{ billing_info: { email_address: recipient } }] };
      if (method === "send_invoice") { remoteStatus = "SENT"; return {}; }
      throw new Error("Unexpected simulated PayPal tool");
    };
    await approveInvoice({ db, householdId, approveKey: target.approveKey, today: DEMO_DATE, usdRate: 150, recipient, tool }, "send");
    const sentReview = await invoiceReview(db, householdId, target.id);
    if (!sentReview) throw new Error("Sent invoice review missing");
    stages.sent = { review: recordingReview(sentReview), state: (stages.confirmed as { state: Awaited<ReturnType<typeof loadMoneyState>> }).state };
    await applyVerifiedDelivery(db, {
      id: "WH-LOCAL-REHEARSAL-PAID",
      event_type: "INVOICING.INVOICE.PAID",
      create_time: "2026-11-15T03:00:00Z",
      resource: { id: remoteId, status: "PAID" },
    });
    stages.paid = await home();
    const paidState = (stages.paid as { state: Awaited<ReturnType<typeof loadMoneyState>> }).state;
    if (paidState.paypal - confirmedState.paypal !== 60_000) throw new Error("Expected one ¥60,000 seeded balance credit");
    await writeFile(out, JSON.stringify({ name, stages, sentences: {
      before: homeSentence(beforeState), confirmed: homeSentence(confirmedState), paid: homeSentence(paidState),
    } }), { mode: 0o600 });
  } finally {
    await pg.close();
  }
}
main().catch(() => { console.error("Rehearsal fixture generation failed"); process.exitCode = 1; });
