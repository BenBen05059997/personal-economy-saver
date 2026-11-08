// What the Type column in Activity says for each kind of event the app records, in words. Every kind written anywhere
// in src/db or src/lib/events.ts has a line here; the doors test reads those files and fails on one that is missing.

export const EVENT_KIND_LABELS = {
  ai_model_changed: "AI model changed",
  bank_balance: "Bank balance changed",
  bill_added: "Bill added",
  bill_changed: "Bill changed",
  bill_confirmed: "Bill confirmed",
  bill_removed: "Bill removed",
  canvas_changed: "Pinned canvas changed",
  canvas_pinned: "Pinned to Home",
  canvas_unpinned: "Unpinned from Home",
  charge_added: "Card charge added",
  charge_confirmed: "Card charge confirmed",
  charge_removed: "Card charge removed",
  charges_imported: "Imported from a statement",
  client_added: "Client added",
  data_deleted: "Stored data deleted",
  data_moved: "Stored data moved",
  document_failed: "Document needs attention",
  document_queued: "Document waiting to be read",
  document_read: "Document read",
  household_imported: "Imported from a file",
  invite_created: "Invitation created",
  invite_cancelled: "Invitation cancelled",
  invite_accepted: "Member joined",
  member_left: "Member left",
  invoice_drafted: "Invoice drafted",
  invoice_paid: "Invoice paid",
  invoice_paid_outside: "Invoice paid outside PayPal",
  invoice_sent: "Invoice sent",
  family_link_created: "Family view shared",
  family_link_stopped: "Family view stopped",
  memory_changed: "Assistant memory changed",
  member_added: "Person added",
  member_renamed: "Person renamed",
  person_removed: "Person removed",
  paypal_imported: "Imported from PayPal",
  pot_added: "Pot added",
  pot_filled: "Set aside for a pot",
  pot_removed: "Pot removed",
  pot_updated: "Pot changed",
  reading_rejected: "Reading dismissed",
  reminder_sent: "Invoice reminder sent",
  rule_changed: "Rule changed",
  rules_initialized: "Default standing rules added",
  runway_clear: "Clear for 30 days",
  runway_short: "Short",
  settings_updated: "Settings changed",
  settled: "Shared costs settled",
  shares_updated: "Shares changed",
  suggestion_made: "Suggestion made",
  suggestion_dismissed: "Suggestion dismissed",
  suggestion_approved: "Suggestion approved",
  to_check: "Waiting in To check",
} as const;

const HISTORICAL_LABELS: Record<string, string> = {
  daily_reminder: "Daily reminder",
  nudge_suggested: "Nudge suggested",
};
type EventKind = keyof typeof EVENT_KIND_LABELS;

/** The words for an event kind. A kind recorded by an older version and no longer written shows as its own name in words. */
export function eventKindLabel(kind: string): string {
  if (Object.hasOwn(EVENT_KIND_LABELS, kind)) return EVENT_KIND_LABELS[kind as EventKind];
  if (Object.hasOwn(HISTORICAL_LABELS, kind)) return HISTORICAL_LABELS[kind];
  return kind.replaceAll("_", " ");
}
