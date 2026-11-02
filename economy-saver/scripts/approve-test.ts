// Only this test supplies simulated PayPal tools. No external calls or settings.
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { and, eq } from "drizzle-orm";
import { approveInvoice, type InvoiceTool } from "@/db/approval";
import { loadMoneyState, listEvents } from "@/db/household";
import * as schema from "@/db/schema";
import { seedBen } from "@/db/seed";
import { saveInvoiceDraft } from "@/db/invoice-draft";
import { applyVerifiedDelivery } from "@/lib/events";
import { homeSentence } from "@/lib/money/sentence";

async function main() {
  const pg = new PGlite();
  try {
    const db = drizzle(pg, { schema });
    await migrate(db, { migrationsFolder: "./drizzle" });
    const householdId = await seedBen(db, { isDemo: true });
    const other = await seedBen(db, { isDemo: true });
    const [invoice] = await db.select().from(schema.invoices)
      .where(and(eq(schema.invoices.householdId, householdId), eq(schema.invoices.status, "unbilled")));
    const recipient = "buyer@example.test";
    const id = "INV2-FICTIONAL-400";
    const calls: string[] = [];
    const keys: string[] = [];
    let number: unknown;
    let remoteStatus = "DRAFT";
    const tool: InvoiceTool = async (name, args, requestId) => {
      calls.push(name);
      if (requestId) keys.push(requestId);
      if (name === "search_invoicing") return { items: number ? [{ id, detail: { invoice_number: number, reference: invoice.id } }] : [] };
      if (name === "create_invoice") {
        number = args.invoice_number;
        assert.equal(args.reference, invoice.id);
        throw new Error("Timeout after PayPal created draft");
      }
      if (name === "get_invoice") return { id, status: remoteStatus, primary_recipients: [{ billing_info: { email_address: recipient } }] };
      if (name === "send_invoice") {
        assert.equal(args.invoice_id, id);
        remoteStatus = "SENT";
        throw new Error("Timeout after PayPal sent");
      }
      if (name === "send_invoice_reminder") throw new Error("Timeout after reminder dispatch");
      throw new Error("Unexpected tool");
    };
    const ctx = { db, householdId, approveKey: invoice.approveKey, today: "2026-11-14", usdRate: 150, recipient, tool };
    await assert.rejects(approveInvoice({ ...ctx, householdId: other }, "send"), /not found/);
    assert.equal(calls.length, 0);
    await assert.rejects(approveInvoice(ctx, "send"), /Timeout after PayPal created/);
    await assert.rejects(approveInvoice(ctx, "send"), /Timeout after PayPal sent/);
    const target = and(eq(schema.invoices.householdId, householdId), eq(schema.invoices.id, invoice.id));
    assert.equal((await db.select().from(schema.invoices).where(target))[0].paypalInvoiceId, id);
    await Promise.all([approveInvoice(ctx, "send"), approveInvoice(ctx, "send")]);
    const [sent] = await db.select().from(schema.invoices).where(target);
    assert.equal(sent.status, "sent");
    assert.equal(sent.fxRateMicro, 150_000_000);
    assert.equal(calls.filter(c => c === "create_invoice").length, 1);
    assert.equal(calls.filter(c => c === "send_invoice").length, 1);
    assert.equal((await listEvents(db, householdId)).filter(e => e.kind === "invoice_sent" && e.refId === invoice.id).length, 1);
    await assert.rejects(approveInvoice(ctx, "remind"), /overdue/);
    const late = { ...ctx, today: "2026-11-15" };
    await assert.rejects(approveInvoice(late, "remind"), /Timeout after reminder/);
    await assert.rejects(approveInvoice(late, "remind"), /Check its delivery/);
    assert.equal(calls.filter(c => c === "send_invoice_reminder").length, 1);
    assert.ok(keys.every(k => k.length <= 38));
    assert.equal(new Set(keys).size, 3);
    const before = await loadMoneyState(db, householdId, ctx.today);
    const event = { id: "WH-FICTIONAL-400", event_type: "INVOICING.INVOICE.PAID",
      create_time: "2026-11-15T03:00:00Z", resource: { id, status: "PAID" } };
    await applyVerifiedDelivery(db, event);
    await applyVerifiedDelivery(db, { ...event, id: "WH-FICTIONAL-400-B" });
    const after = await loadMoneyState(db, householdId, ctx.today);
    assert.equal(after.paypal - before.paypal, 60_000);
    assert.match(homeSentence(after).lead, /fine/);
    assert.equal((await loadMoneyState(db, other, ctx.today)).paypal, before.paypal);
    assert.equal((await db.select().from(schema.invoices).where(target))[0].status, "paid");
    assert.equal((await listEvents(db, householdId)).filter(e => e.kind === "invoice_paid" && e.refId === invoice.id).length, 1);
    const draft = { id: crypto.randomUUID(), clientId: invoice.clientId, item: "Design sketches", amount: "15.45", note: "" };
    await saveInvoiceDraft(db, householdId, draft);
    await saveInvoiceDraft(db, householdId, draft);
    await assert.rejects(saveInvoiceDraft(db, other, draft), /Client not found/);
    const [newInvoice] = await db.select().from(schema.invoices).where(and(eq(schema.invoices.householdId, householdId), eq(schema.invoices.id, draft.id)));
    assert.equal(newInvoice.amountMinor, 1545);
    const newRemote = "INV2-FICTIONAL-15";
    const happyCalls: string[] = [];
    let remoteSent = false;
    const happyTool: InvoiceTool = async (method, args) => {
      happyCalls.push(method);
      if (method === "search_invoicing") return { items: [] };
      if (method === "create_invoice") return { href: `https://api-m.sandbox.paypal.com/v2/invoicing/invoices/${newRemote}` };
      if (method === "get_invoice") return { id: newRemote, status: remoteSent ? "SENT" : "DRAFT", primary_recipients: [{billing_info:{email_address: recipient}}] };
      assert.equal(args.invoice_id, newRemote);
      if (method === "send_invoice") remoteSent = true;
      return {};
    };
    const newCtx = { ...ctx, approveKey: newInvoice.approveKey, tool: happyTool };
    await Promise.all([approveInvoice(newCtx, "send"), approveInvoice(newCtx, "send")]);
    assert.equal(happyCalls.filter(c => c === "create_invoice").length, 1);
    assert.equal(happyCalls.filter(c => c === "send_invoice").length, 1);
    await approveInvoice({ ...newCtx, today: late.today }, "remind");
    await approveInvoice({ ...newCtx, today: late.today }, "remind");
    assert.equal(happyCalls.filter(c => c === "send_invoice_reminder").length, 1);
    console.log("Approval tests passed: household isolation, exact-cent drafts, create/send recovery, double click, reminders, one verified balance credit.");
  } finally { await pg.close(); }
}

main().catch(() => { console.error("Approval test failed"); process.exitCode = 1; });
