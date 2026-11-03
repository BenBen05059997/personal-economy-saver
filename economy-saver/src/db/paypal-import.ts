import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { env } from "@/lib/env";
import { readMerchantInvoices, type MerchantInvoice } from "@/lib/paypal/invoices";
import { closedInvoiceStates } from "@/lib/paypal/status";
import { clientInput, insertClient } from "./clients";
import { type Db, recordEvent, requireHousehold } from "./household";
import { InputError } from "./input-error";
import { parseAmountMinor } from "./money";
import { sandboxRead, type ReadRemote } from "./paypal-refresh";
import { beginMoneyChange, observeRunway } from "./runway-events";
import { clients, households, invoices } from "./schema";

/** The household is not the one bound to the sandbox merchant. The message is written for the user. */
export class ImportRefused extends Error {}
/** A server setting is missing or wrong. The message names the setting, never a value. */
export class ImportSetupError extends Error {}
/** The merchant invoice belongs to another household, so this insert is rolled back. */
class NotOurs extends Error {}

type Status = "draft" | "sent" | "paid" | "closed";
const sentStates = ["SENT", "SCHEDULED", "UNPAID", "PARTIALLY_PAID", "PAYMENT_PENDING"];
const REFUSAL = "Only the household connected to the PayPal sandbox merchant can import from it.";

function mapStatus(paypal: string | null): Status | null {
  if (!paypal) return null;
  if (paypal === "DRAFT") return "draft";
  if (sentStates.includes(paypal)) return "sent";
  if (paypal === "PAID" || paypal === "MARKED_AS_PAID") return "paid";
  return closedInvoiceStates.includes(paypal) ? "closed" : null;
}

async function requireDesignated(db: Db, hid: string, lock = false) {
  const bound = process.env.PAYPAL_BALANCE_HOUSEHOLD_ID?.trim().toLowerCase();
  if (!bound) throw new ImportSetupError("PAYPAL_BALANCE_HOUSEHOLD_ID is not set.");
  if (!z.string().uuid().safeParse(bound).success) throw new ImportSetupError("PAYPAL_BALANCE_HOUSEHOLD_ID must be a household UUID.");
  const query = db.select({ demo: households.isDemo }).from(households).where(eq(households.id, hid));
  const [household] = await (lock ? query.for("update") : query);
  if (!household) throw new Error("Household not found");
  if (household.demo || bound !== hid.toLowerCase()) throw new ImportRefused(REFUSAL);
}

/** True when this household may import from the sandbox merchant. Never reveals the setting itself. */
export async function canImportPayPal(db: Db, householdId: string): Promise<boolean> {
  try { await requireDesignated(db, requireHousehold(householdId)); return true; } catch { return false; }
}

const dayCount = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * Seeds clients and invoice history from the sandbox merchant, read-only (D39). Only the designated non-demo household
 * may import (D37). Imported paid invoices are history: they credit no balance, since PayPal's own balance refresh
 * supplies the cash. Safe to run again: an invoice already imported is left alone.
 */
export async function importPayPalHistory(db: Db, householdId: string, read: ReadRemote = sandboxRead) {
  const hid = requireHousehold(householdId);
  await requireDesignated(db, hid);
  if (read === sandboxRead) {
    try { env(); } catch (error) { throw new ImportSetupError((error as Error).message); }
  }
  const remote = await readMerchantInvoices(read);

  return db.transaction(async tx => {
    await requireDesignated(tx, hid, true);
    await beginMoneyChange(tx, hid);
    const known = new Set((await tx.select({ id: invoices.paypalInvoiceId }).from(invoices)
      .where(and(eq(invoices.householdId, hid), inArray(invoices.paypalInvoiceId, remote.map(r => r.paypalInvoiceId))))).map(r => r.id));
    const byEmail = new Map((await tx.select({ id: clients.id, email: clients.email }).from(clients).where(eq(clients.householdId, hid)))
      .map(c => [c.email.toLowerCase(), c.id]));
    let newClients = 0, newInvoices = 0, skipped = 0;
    const seen = new Set<string>();
    for (const record of remote) {
      if (known.has(record.paypalInvoiceId) || seen.has(record.paypalInvoiceId)) continue;
      seen.add(record.paypalInvoiceId);
      const status = mapStatus(record.status);
      const email = record.recipientEmail?.toLowerCase();
      let amountMinor: number;
      try { amountMinor = parseAmountMinor(record.amountValue ?? "", "USD"); } catch (error) {
        if (error instanceof InputError) { skipped++; continue; }
        throw error;
      }
      if (!status || !email || record.currency !== "USD" || !clientInput.shape.email.safeParse(email).success) { skipped++; continue; }
      try {
        const created = await tx.transaction(async sp => {
          let clientId = byEmail.get(email);
          const isNew = clientId === undefined;
          if (isNew) clientId = await insertClient(sp, hid, newClient(record, email));
          const row = await sp.insert(invoices).values({
            householdId: hid, clientId: clientId!, status, number: record.number, item: record.number ?? "PayPal invoice",
            amountMinor, currency: "USD", sentOn: status === "draft" ? null : record.invoiceDate, dueOn: record.dueDate,
            paidOn: status === "paid" ? record.paidDate : null, paypalInvoiceId: record.paypalInvoiceId, paypalStatus: record.status,
          }).onConflictDoNothing({ target: invoices.paypalInvoiceId }).returning({ id: invoices.id });
          if (!row.length) throw new NotOurs();
          return isNew ? clientId! : null;
        });
        if (created) { byEmail.set(email, created); newClients++; }
        newInvoices++;
      } catch (error) {
        if (!(error instanceof NotOurs)) throw error;
        skipped++;
      }
    }
    if (newInvoices) {
      await recordEvent(tx, hid, {
        kind: "paypal_imported", title: `Imported ${plural(newInvoices, "invoice")} and ${plural(newClients, "client")} from PayPal`, notify: false,
      });
    }
    await observeRunway(tx, hid);
    return { clients: newClients, invoices: newInvoices, skipped };
  });
}

function newClient(record: MerchantInvoice, email: string) {
  const terms = record.invoiceDate && record.dueDate ? dayCount(record.invoiceDate, record.dueDate) : 0;
  return {
    id: crypto.randomUUID(),
    name: record.recipientName ?? email.split("@")[0],
    email,
    termsDays: Math.min(120, Math.max(0, terms)),
  };
}
