import { beginMoneyChange, observeRunway } from "./runway-events";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { recordEvent, requireHousehold, type Db } from "./household";
import { fromMinor, toRateMicro } from "./money";
import { clients, invoices } from "./schema";

export class ApprovalError extends Error {
  constructor(message: string, readonly status = 409) { super(message); }
}

// Only the server's approval route supplies this transport. Tests inject their boundary here.
export type InvoiceTool = (name: string, args: Record<string, unknown>, requestId?: string) => Promise<unknown>;
export type ApprovalAction = "send" | "remind";

export async function invoiceReview(db: Db, householdId: string, invoiceId: string) {
  const hid = requireHousehold(householdId);
  const [row] = await db.select({ invoice: invoices, client: clients.name })
    .from(invoices).innerJoin(clients, and(eq(clients.householdId, hid), eq(clients.id, invoices.clientId)))
    .where(and(eq(invoices.householdId, hid), eq(invoices.id, invoiceId)));
  return row;
}

const remoteInvoice = z.object({ id: z.string(), status: z.string(), primary_recipients: z.array(z.object({
  billing_info: z.object({ email_address: z.string() }),
})) });
const searchResults = z.object({ items: z.array(z.object({
  id: z.string(), detail: z.object({ invoice_number: z.string(), reference: z.string().optional() }),
})).optional() });
const createResult = z.union([z.object({ id: z.string().min(1) }), z.object({ href: z.string().url() })]);

type ApprovalContext = {
  db: Db;
  householdId: string;
  approveKey: string;
  today: string;
  usdRate: number;
  recipient: string;
  tool: InvoiceTool;
};

async function lockedInvoice(tx: Db, ctx: ApprovalContext) {
  const [row] = await tx.select().from(invoices)
    .where(and(eq(invoices.householdId, requireHousehold(ctx.householdId)), eq(invoices.approveKey, ctx.approveKey))).for("update");
  if (!row) throw new ApprovalError("Invoice not found", 404);
  return row;
}

function invoiceWhere(ctx: ApprovalContext, id: string) {
  return and(eq(invoices.householdId, requireHousehold(ctx.householdId)), eq(invoices.id, id));
}

function requestId(key: string, action: "C" | "S" | "R") {
  return action + "-" + key; // 38 bytes, distinct for each PayPal operation.
}

async function getRemote(ctx: ApprovalContext, remoteId: string) {
  const remote = remoteInvoice.parse(await ctx.tool("get_invoice", { invoice_id: remoteId }));
  const emails = remote.primary_recipients.map(r => r.billing_info.email_address.toLowerCase());
  if (remote.id !== remoteId || emails.length !== 1 || emails[0] !== ctx.recipient.toLowerCase()) {
    throw new ApprovalError("The invoice recipient must be the PayPal sandbox test client.");
  }
  return remote;
}

async function prepareDraft(ctx: ApprovalContext) {
  await ctx.db.transaction(async tx => {
    const invoice = await lockedInvoice(tx, ctx);
    if (invoice.status === "closed") throw new ApprovalError("This sandbox invoice is closed.");
    if (invoice.paypalInvoiceId || invoice.status === "paid" || invoice.status === "sent") return;
    if (invoice.currency !== "USD" || invoice.amountMinor <= 0) throw new ApprovalError("A positive USD invoice amount is required.");
    if (invoice.dueOn && invoice.dueOn !== ctx.today) throw new ApprovalError("Sandbox drafts support payment on receipt. Review the due date before sending.");
    // Use the entire UUID in PayPal's 25-character invoice-number field. Each visitor shares one merchant.
    const number = "P-" + Buffer.from(invoice.id.replaceAll("-", ""), "hex").toString("base64url");
    const matches = searchResults.parse(await ctx.tool("search_invoicing", {
      resource_type: "invoice", invoice_filters: { invoice_number: number, recipient_email: ctx.recipient },
    })).items?.filter(item => item.detail.invoice_number === number) ?? [];
    if (matches.length > 1 || (matches.length && matches[0].detail.reference !== invoice.id)) {
      throw new ApprovalError("The sandbox invoice number is already in use.");
    }
    let remoteId: string | undefined = matches[0]?.id;
    if (!remoteId) {
      const result = createResult.parse(await ctx.tool("create_invoice", {
        currency_code: "USD", invoice_number: number, reference: invoice.id, note: invoice.note ?? undefined,
        primary_recipients: [{ billing_info: { email_address: ctx.recipient } }],
        items: [{ name: invoice.item, quantity: "1", unit_amount: { currency_code: "USD", value: fromMinor(invoice.amountMinor, "USD").toFixed(2) } }],
      }, requestId(invoice.approveKey, "C")));
      remoteId = "id" in result ? result.id : new URL(result.href).pathname.split("/").pop();
      if (!remoteId || !/^[A-Za-z0-9_-]+$/.test(remoteId)) throw new Error("Invalid sandbox invoice id");
    }
    await tx.update(invoices).set({ paypalInvoiceId: remoteId, number, status: "draft", fxRateMicro: toRateMicro(ctx.usdRate) })
      .where(invoiceWhere(ctx, invoice.id));
  });
}

async function sendInvoice(ctx: ApprovalContext) {
  // Commit the remote ID before the send. A webhook can now identify this invoice, even if the send times out.
  await prepareDraft(ctx);
  return ctx.db.transaction(async tx => {
    await beginMoneyChange(tx, ctx.householdId);
    const invoice = await lockedInvoice(tx, ctx);
    if (invoice.status === "sent" || invoice.status === "paid") return invoice.id;
    if (!invoice.paypalInvoiceId) throw new ApprovalError("No sandbox draft exists.");
    const remote = await getRemote(ctx, invoice.paypalInvoiceId);
    if (remote.status === "DRAFT") {
      await ctx.tool("send_invoice", { invoice_id: remote.id, send_to_recipient: true }, requestId(invoice.approveKey, "S"));
    } else if (!["SENT", "UNPAID", "PAID", "PARTIALLY_PAID", "PAYMENT_PENDING"].includes(remote.status)) {
      throw new ApprovalError("The sandbox invoice cannot be sent in its current state.");
    }
    const [client] = await tx.select({ name: clients.name }).from(clients)
      .where(and(eq(clients.householdId, ctx.householdId), eq(clients.id, invoice.clientId)));
    await tx.update(invoices).set({ status: "sent", sentOn: ctx.today, dueOn: invoice.dueOn ?? ctx.today })
      .where(invoiceWhere(ctx, invoice.id));
    await recordEvent(tx, ctx.householdId, { madeBy: "form", kind: "invoice_sent", title: `Invoice sent to ${client.name}`,
      amount: { value: fromMinor(invoice.amountMinor, invoice.currency), currency: invoice.currency }, ref: { type: "invoice", id: invoice.id } });
    await observeRunway(tx, ctx.householdId);
    return invoice.id;
  });
}

async function remind(ctx: ApprovalContext) {
  const claim = await ctx.db.transaction(async tx => {
    const invoice = await lockedInvoice(tx, ctx);
    if (invoice.remindedAt) return { id: invoice.id };
    if (invoice.reminderAttemptedAt) throw new ApprovalError("A reminder was requested. Check its delivery in PayPal before taking further action.");
    if (invoice.status !== "sent" || !invoice.paypalInvoiceId || !invoice.dueOn || invoice.dueOn >= ctx.today) {
      throw new ApprovalError("Only an overdue, sent sandbox invoice can be reminded.");
    }
    const remote = await getRemote(ctx, invoice.paypalInvoiceId);
    if (!["SENT", "UNPAID", "PARTIALLY_PAID"].includes(remote.status)) throw new ApprovalError("PayPal is not awaiting payment on this invoice.");
    // /remind does not document idempotent retries. Commit the claim before touching the network.
    await tx.update(invoices).set({ reminderAttemptedAt: new Date() }).where(invoiceWhere(ctx, invoice.id));
    return { id: invoice.id, remoteId: invoice.paypalInvoiceId };
  });
  if (claim.remoteId) {
    await ctx.tool("send_invoice_reminder", { invoice_id: claim.remoteId }, requestId(ctx.approveKey, "R"));
    await ctx.db.transaction(async tx => {
      await tx.update(invoices).set({ remindedAt: new Date() }).where(invoiceWhere(ctx, claim.id));
      await recordEvent(tx, ctx.householdId, { madeBy: "form", kind: "reminder_sent", title: "Invoice reminder sent", ref: { type: "invoice", id: claim.id } });
    });
  }
  return claim.id;
}

export async function approveInvoice(ctx: ApprovalContext, action: ApprovalAction) {
  requireHousehold(ctx.householdId);
  if (!ctx.recipient.trim()) throw new ApprovalError("SANDBOX_CLIENT_EMAIL is not set", 503);
  return action === "remind" ? remind(ctx) : sendInvoice(ctx);
}
