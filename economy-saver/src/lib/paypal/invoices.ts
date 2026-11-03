// Read-only view of the sandbox merchant's invoices (D39). Nothing here sends, reminds or creates.
import { z } from "zod";
import type { ReadRemote } from "@/db/paypal-refresh";

// Written from PayPal Invoicing v2 as documented: the list response is { total_items, total_pages, items[], links }
// (the reference confirms those three keys, not the item fields), and each list item is an invoice object.
// Every field except the invoice id is optional so a list item that omits parts of the invoice triggers a detail read.
const money = z.object({ currency_code: z.string().min(1), value: z.string().min(1) }).passthrough();
const recipient = z.object({
  billing_info: z.object({
    email_address: z.string().optional(),
    name: z.object({ given_name: z.string().optional(), surname: z.string().optional(), full_name: z.string().optional() }).passthrough().optional(),
    business_name: z.string().optional(),
  }).passthrough().optional(),
}).passthrough();
const invoice = z.object({
  id: z.string().min(1),
  status: z.string().min(1).optional(),
  detail: z.object({
    invoice_number: z.string().optional(),
    invoice_date: z.string().optional(),
    payment_term: z.object({ due_date: z.string().optional() }).passthrough().optional(),
  }).passthrough().optional(),
  primary_recipients: z.array(recipient).optional(),
  amount: money.optional(),
  payments: z.object({ transactions: z.array(z.object({ payment_date: z.string().optional() }).passthrough()).optional() }).passthrough().optional(),
}).passthrough();
const invoiceList = z.object({ items: z.array(invoice).optional(), total_pages: z.number().int().nonnegative().optional() }).passthrough();
type RemoteInvoice = z.infer<typeof invoice>;

export type MerchantInvoice = {
  paypalInvoiceId: string; number: string | null; status: string | null;
  recipientEmail: string | null; recipientName: string | null;
  amountValue: string | null; currency: string | null;
  invoiceDate: string | null; dueDate: string | null; paidDate: string | null;
};

const PAGE_SIZE = 100;
const DETAIL_BATCH = 3;
const paidStates = ["PAID", "PARTIALLY_PAID", "MARKED_AS_PAID"];
const day = (value: string | undefined) => {
  const text = value?.slice(0, 10);
  return text && /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
};
const clean = (value: string | undefined) => value?.trim() || null;

function normalise(data: RemoteInvoice): MerchantInvoice {
  const billing = data.primary_recipients?.[0]?.billing_info;
  const name = billing?.name;
  const person = clean(name?.full_name) ?? clean([clean(name?.given_name), clean(name?.surname)].filter(Boolean).join(" ") || undefined);
  const dates = (data.payments?.transactions ?? []).map(t => day(t.payment_date)).filter((d): d is string => d !== null).sort();
  return {
    paypalInvoiceId: data.id,
    number: clean(data.detail?.invoice_number),
    status: clean(data.status),
    recipientEmail: clean(billing?.email_address),
    recipientName: clean(billing?.business_name) ?? person,
    amountValue: data.amount?.value ?? null,
    currency: data.amount?.currency_code ?? null,
    invoiceDate: day(data.detail?.invoice_date),
    dueDate: day(data.detail?.payment_term?.due_date),
    paidDate: dates.at(-1) ?? null,
  };
}

const needsDetail = (data: RemoteInvoice) =>
  !data.status || !data.detail || !data.amount || !data.primary_recipients?.length
  || (paidStates.includes(data.status) && !data.payments?.transactions?.length);

/** Every invoice the sandbox merchant has, newest pages first as PayPal returns them, at most `maxPages` pages of 100. */
export async function readMerchantInvoices(read: ReadRemote, maxPages = 5): Promise<MerchantInvoice[]> {
  const items: RemoteInvoice[] = [];
  let pages = 1;
  for (let page = 1; page <= Math.min(pages, maxPages); page++) {
    const list = invoiceList.parse(await read(`/v2/invoicing/invoices?page=${page}&page_size=${PAGE_SIZE}&total_required=true`, AbortSignal.timeout(8000)));
    if (page === 1) pages = list.total_pages ?? 1;
    items.push(...(list.items ?? []));
  }
  const unique = [...new Map(items.map(item => [item.id, item])).values()];
  const full: RemoteInvoice[] = [];
  for (let start = 0; start < unique.length; start += DETAIL_BATCH) {
    full.push(...await Promise.all(unique.slice(start, start + DETAIL_BATCH).map(async item => {
      if (!needsDetail(item)) return item;
      const detail = invoice.parse(await read("/v2/invoicing/invoices/" + encodeURIComponent(item.id), AbortSignal.timeout(8000)));
      if (detail.id !== item.id) throw new Error("PayPal returned a different invoice");
      return detail;
    })));
  }
  return full.map(normalise);
}
