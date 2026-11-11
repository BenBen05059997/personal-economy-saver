import { z } from "zod";

// PayPal's Transaction Search response, read defensively. The field names are from PayPal's reporting schema and are
// not yet confirmed against a real seller's response, so every field is optional and an unreadable row is skipped.
const money = z.object({ currency_code: z.string(), value: z.string() }).passthrough();
const row = z.object({
  transaction_info: z.object({
    transaction_id: z.string().min(1),
    transaction_event_code: z.string().optional(),
    transaction_initiation_date: z.string().datetime({ offset: true }),
    transaction_amount: money,
    transaction_status: z.string().optional(),
  }).passthrough(),
  payer_info: z.object({
    email_address: z.string().optional(),
    payer_name: z.object({
      alternate_full_name: z.string().optional(), given_name: z.string().optional(), surname: z.string().optional(),
    }).passthrough().optional(),
  }).passthrough().optional(),
}).passthrough();
const page = z.object({
  transaction_details: z.array(z.unknown()).optional(), total_pages: z.number().optional(),
}).passthrough();

export type IncomingPayment = {
  transactionId: string; at: Date; currency: "USD" | "JPY"; amountMinor: number; payerEmail: string; payerName: string;
};

/**
 * The incoming completed payments in one page of Transaction Search: a positive amount, status S (success) and, when PayPal
 * gives an event code, a payment code (T00xx). Fees, withdrawals, funding and refunds are not payments from a client.
 * A row without a payer email is skipped, as it cannot name a client (the read also skips and counts one whose email the client schema refuses). `pages` is how many pages PayPal says the search has.
 */
export function incomingPayments(body: unknown): { payments: IncomingPayment[]; pages: number } {
  const parsed = page.parse(body);
  const payments: IncomingPayment[] = [];
  for (const raw of parsed.transaction_details ?? []) {
    const item = row.safeParse(raw);
    if (!item.success) continue;
    const info = item.data.transaction_info, amount = info.transaction_amount;
    const email = item.data.payer_info?.email_address?.trim().toLowerCase();
    if (info.transaction_status !== "S" || !email || !email.includes("@")) continue;
    if (info.transaction_event_code && !/^T00\d\d$/.test(info.transaction_event_code)) continue;
    if (amount.currency_code !== "USD" && amount.currency_code !== "JPY") continue;
    if (!/^\d+(\.\d{1,2})?$/.test(amount.value)) continue; // positive amounts only
    const [whole, cents = ""] = amount.value.split(".");
    const amountMinor = amount.currency_code === "JPY"
      ? (/^0*$/.test(cents) ? Number(whole) : NaN)
      : Number(whole) * 100 + Number(cents.padEnd(2, "0"));
    if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) continue;
    const name = item.data.payer_info?.payer_name;
    const full = name?.alternate_full_name?.trim() || [name?.given_name, name?.surname].filter(Boolean).join(" ").trim();
    payments.push({ transactionId: info.transaction_id, at: new Date(info.transaction_initiation_date),
      currency: amount.currency_code, amountMinor, payerEmail: email, payerName: (full || email.split("@")[0]).slice(0, 120) });
  }
  return { payments, pages: parsed.total_pages ?? 1 };
}
