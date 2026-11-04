// What the Type column in Activity says for each kind of event the app records, in words. Every kind written anywhere
// in src/db or src/lib/events.ts has a line here; the doors test reads those files and fails on one that is missing.

export const EVENT_KIND_LABELS = {
  bank_balance: "Bank balance changed",
  bill_added: "Bill added",
  bill_confirmed: "Bill confirmed",
  bill_removed: "Bill removed",
  charge_added: "Card charge added",
  charge_confirmed: "Card charge confirmed",
  charge_removed: "Card charge removed",
  client_added: "Client added",
  daily_reminder: "Daily reminder",
  document_failed: "Document needs attention",
  document_queued: "Document waiting to be read",
  document_read: "Document read",
  invoice_drafted: "Invoice drafted",
  invoice_paid: "Invoice paid",
  invoice_paid_outside: "Invoice paid outside PayPal",
  invoice_sent: "Invoice sent",
  member_added: "Person added",
  member_renamed: "Person renamed",
  paypal_imported: "Imported from PayPal",
  nudge_suggested: "Nudge suggested",
  pot_added: "Pot added",
  pot_filled: "Set aside for a pot",
  pot_removed: "Pot removed",
  pot_updated: "Pot changed",
  reading_rejected: "Reading dismissed",
  reminder_sent: "Invoice reminder sent",
  runway_clear: "Clear for 30 days",
  runway_short: "Short",
  settings_updated: "Settings changed",
  settled: "Shared costs settled",
  shares_updated: "Shares changed",
  to_check: "Waiting in To check",
} as const;

export type EventKind = keyof typeof EVENT_KIND_LABELS;

/** The words for an event kind. A kind recorded by an older version and no longer written shows as its own name in words. */
export function eventKindLabel(kind: string): string {
  return Object.hasOwn(EVENT_KIND_LABELS, kind) ? EVENT_KIND_LABELS[kind as EventKind] : kind.replaceAll("_", " ");
}
