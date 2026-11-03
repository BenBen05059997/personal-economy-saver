// The tables behind D31. Every row except `households` carries `household_id`
// (cascade, so deleting a household removes everything) and an index on it.
//
// Money is a bigint count of minor units (see money.ts) next to a `currency` char(3); never numeric or float.
// Wherever a USD amount meets yen, the rate used sits on the row as `fx_rate_micro`: home currency per
// 1 USD, scaled by 1e6 (150 yen per dollar = 150_000_000).
//
// Every table has Row Level Security on and no policies. Supabase exposes tables through its REST API with the
// public anon key; the app reaches data only server-side with the database URL (the owner role skips RLS),
// so the public path is closed entirely.

import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  char,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

const minor = (name: string) => bigint(name, { mode: "number" });
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const id = () => uuid("id").primaryKey().defaultRandom();
const householdId = () =>
  uuid("household_id")
    .notNull()
    .references(() => households.id, { onDelete: "cascade" });

export const memberRole = pgEnum("member_role", ["owner", "member"]);
export const invoiceStatus = pgEnum("invoice_status", ["unbilled", "draft", "sent", "paid", "closed"]);
export const confirmStatus = pgEnum("confirm_status", ["confirmed", "pending"]);
export const chargeSource = pgEnum("charge_source", ["card_email", "receipt", "voice", "manual"]);
export const documentKind = pgEnum("document_kind", ["upload", "email"]);
export const documentStatus = pgEnum("document_status", ["queued", "reading", "read", "failed"]);
export const readingStatus = pgEnum("reading_status", ["to_check", "confirmed", "rejected"]);
export const readingTarget = pgEnum("reading_target", ["bill", "charge"]);

export const households = pgTable("households", {
  id: id(),
  name: text("name").notNull(),
  timeZone: text("time_zone").notNull().default("Asia/Tokyo"),
  homeCurrency: char("home_currency", { length: 3 }).notNull(),
  bankBalanceMinor: minor("bank_balance_minor").notNull().default(0), // typed in by the user
  isDemo: boolean("is_demo").notNull().default(false),
  forwardingLocalpart: text("forwarding_localpart"),
  runwayShort: boolean("runway_short"),
  notificationDay: date("notification_day", { mode: "string" }),
  aiKeySecretId: uuid("ai_key_secret_id"), // the user's own key lives in Supabase Vault (D33); this is its id
  aiKeyHint: text("ai_key_hint"), // prefix…suffix only
  aiReadsToday: integer("ai_reads_today").notNull().default(0),
  aiReadsDay: date("ai_reads_day", { mode: "string" }),
  createdAt: createdAt(),
}).enableRLS();

// Daily reference rates for each household: how many `quote` per 1 `base`.
export const fxRates = pgTable(
  "fx_rates",
  {
    householdId: householdId(),
    date: date("date", { mode: "string" }).notNull(),
    base: char("base", { length: 3 }).notNull(),
    quote: char("quote", { length: 3 }).notNull(),
    rateMicro: bigint("rate_micro", { mode: "number" }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.householdId, t.date, t.base, t.quote] })],
).enableRLS();

export const members = pgTable(
  "members",
  {
    id: id(),
    householdId: householdId(),
    displayName: text("display_name").notNull(),
    role: memberRole("role").notNull().default("member"),
    authUserId: uuid("auth_user_id"), // Supabase auth user, once the member has logged in
    createdAt: createdAt(),
  },
  (t) => [index("members_household_idx").on(t.householdId), unique("members_household_id_uq").on(t.householdId, t.id)],
).enableRLS();

// Maps a Supabase auth user to the household and member they act as.
export const users = pgTable(
  "users",
  {
    id: id(),
    householdId: householdId(),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    authUserId: uuid("auth_user_id").notNull().unique(),
    createdAt: createdAt(),
  },
  (t) => [index("users_household_idx").on(t.householdId), foreignKey({ columns: [t.householdId, t.memberId], foreignColumns: [members.householdId, members.id], name: "users_member_household_fk" }).onDelete("cascade")],
).enableRLS();

export const paypalConnections = pgTable(
  "paypal_connections",
  {
    id: id(),
    householdId: householdId(),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    environment: text("environment").notNull().default("SANDBOX"),
    merchantId: text("merchant_id"),
    refreshAttemptedAt: timestamp("refresh_attempted_at", { withTimezone: true }),
    refreshError: text("refresh_error"),
    balanceAsOf: timestamp("balance_as_of", { withTimezone: true }),
    latestCreditAt: timestamp("latest_credit_at", { withTimezone: true }),
    balanceFxRateMicro: bigint("balance_fx_rate_micro", { mode: "number" }),
    balanceMinor: minor("balance_minor").notNull().default(0),
    balanceCurrency: char("balance_currency", { length: 3 }).notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }), // D37: pulled on open, at most every 5 minutes
    createdAt: createdAt(),
  },
  (t) => [
    index("paypal_connections_household_idx").on(t.householdId),
    unique("paypal_connections_member_uq").on(t.memberId),
    foreignKey({ columns: [t.householdId, t.memberId], foreignColumns: [members.householdId, members.id], name: "paypal_member_household_fk" }).onDelete("cascade"),
    check("paypal_connections_sandbox_only", sql`${t.environment} = 'SANDBOX'`), // D14
  ],
).enableRLS();

export const clients = pgTable(
  "clients",
  {
    id: id(),
    householdId: householdId(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    termsDays: integer("terms_days").notNull().default(0), // 0 = due on receipt
    createdAt: createdAt(),
  },
  (t) => [index("clients_household_idx").on(t.householdId), unique("clients_household_id_uq").on(t.householdId, t.id)],
).enableRLS();

// Days to pay is not stored: it is paid_on - sent_on over a client's paid invoices.
export const invoices = pgTable(
  "invoices",
  {
    id: id(),
    householdId: householdId(),
    clientId: uuid("client_id").notNull(),
    status: invoiceStatus("status").notNull(),
    number: text("number"),
    item: text("item").notNull(),
    note: text("note"),
    amountMinor: minor("amount_minor").notNull(),
    currency: char("currency", { length: 3 }).notNull().default("USD"),
    fxRateMicro: bigint("fx_rate_micro", { mode: "number" }), // set when the payout is converted to yen
    sentOn: date("sent_on", { mode: "string" }),
    dueOn: date("due_on", { mode: "string" }),
    paidOn: date("paid_on", { mode: "string" }),
    paypalInvoiceId: text("paypal_invoice_id").unique(),
    paypalStatus: text("paypal_status"),
    paypalFetchedAt: timestamp("paypal_fetched_at", { withTimezone: true }),
    approveKey: uuid("approve_key").notNull().defaultRandom().unique(), // D37: idempotency key for Approve
    reminderAttemptedAt: timestamp("reminder_attempted_at", { withTimezone: true }),
    remindedAt: timestamp("reminded_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("invoices_household_idx").on(t.householdId),
    index("invoices_client_idx").on(t.clientId),
    // Same-household guarantee: a client of another household cannot be referenced.
    foreignKey({ columns: [t.householdId, t.clientId], foreignColumns: [clients.householdId, clients.id], name: "invoices_client_fk" }).onDelete("cascade"),
  ],
).enableRLS();

export const documents = pgTable(
  "documents",
  {
    id: id(),
    householdId: householdId(),
    kind: documentKind("kind").notNull(),
    storagePath: text("storage_path").notNull(),
    mime: text("mime").notNull(),
    status: documentStatus("status").notNull().default("queued"),
    error: text("error"),
    processingAt: timestamp("processing_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("documents_household_idx").on(t.householdId), unique("documents_household_id_uq").on(t.householdId, t.id)],
).enableRLS();

export const cards = pgTable(
  "cards",
  {
    id: id(),
    householdId: householdId(),
    memberId: uuid("member_id").references(() => members.id, { onDelete: "set null" }), // D28: whose card
    label: text("label").notNull(),
    closingDay: integer("closing_day").notNull(), // 31 = month end
    dueDay: integer("due_day").notNull(), // day of the following month
    limitMinor: minor("limit_minor"),
    currency: char("currency", { length: 3 }).notNull(),
    revolving: boolean("revolving").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    index("cards_household_idx").on(t.householdId),
    unique("cards_household_id_uq").on(t.householdId, t.id),
    foreignKey({ columns: [t.householdId, t.memberId], foreignColumns: [members.householdId, members.id], name: "cards_member_household_fk" }),
    check("cards_days_valid", sql`${t.closingDay} between 1 and 31 and ${t.dueDay} between 1 and 31`),
  ],
).enableRLS();

export const cardStatements = pgTable(
  "card_statements",
  {
    id: id(),
    householdId: householdId(),
    cardId: uuid("card_id").notNull(),
    amountMinor: minor("amount_minor").notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    closedOn: date("closed_on", { mode: "string" }).notNull(),
    dueOn: date("due_on", { mode: "string" }).notNull(),
    paidOn: date("paid_on", { mode: "string" }),
    createdAt: createdAt(),
  },
  (t) => [
    index("card_statements_household_idx").on(t.householdId),
    unique("card_statements_cycle_uq").on(t.householdId, t.cardId, t.closedOn),
    foreignKey({ columns: [t.householdId, t.cardId], foreignColumns: [cards.householdId, cards.id], name: "card_statements_card_fk" }).onDelete("cascade"),
  ],
).enableRLS();

export const charges = pgTable(
  "charges",
  {
    id: id(),
    householdId: householdId(),
    cardId: uuid("card_id").notNull(),
    merchant: text("merchant").notNull(),
    amountMinor: minor("amount_minor").notNull(), // as the issuer bills it
    currency: char("currency", { length: 3 }).notNull(),
    originalAmountMinor: minor("original_amount_minor"), // when paid in another currency
    originalCurrency: char("original_currency", { length: 3 }),
    fxRateMicro: bigint("fx_rate_micro", { mode: "number" }), // original -> billed, when they differ
    date: date("date", { mode: "string" }).notNull(),
    source: chargeSource("source").notNull(),
    status: confirmStatus("status").notNull().default("confirmed"),
    place: text("place"),
    documentId: uuid("document_id").references(() => documents.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    index("charges_household_idx").on(t.householdId),
    index("charges_card_date_idx").on(t.cardId, t.date),
    foreignKey({ columns: [t.householdId, t.cardId], foreignColumns: [cards.householdId, cards.id], name: "charges_card_fk" }).onDelete("cascade"),
    foreignKey({ columns: [t.householdId, t.documentId], foreignColumns: [documents.householdId, documents.id], name: "charges_document_household_fk" }),
    check("charges_original_pair", sql`(${t.originalAmountMinor} is null) = (${t.originalCurrency} is null)`),
  ],
).enableRLS();

export const bills = pgTable(
  "bills",
  {
    id: id(),
    householdId: householdId(),
    memberId: uuid("member_id").references(() => members.id, { onDelete: "set null" }), // null = shared
    biller: text("biller").notNull(),
    amountMinor: minor("amount_minor").notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    due: date("due", { mode: "string" }).notNull(),
    category: text("category").notNull(),
    status: confirmStatus("status").notNull().default("confirmed"),
    previousAmountMinor: minor("previous_amount_minor"),
    fxRateMicro: bigint("fx_rate_micro", { mode: "number" }),
    documentId: uuid("document_id").references(() => documents.id, { onDelete: "set null" }),
    repeatDay: integer("repeat_day"), // D41: day of the month a monthly bill repeats on; null = one-off
    createdAt: createdAt(),
  },
  (t) => [index("bills_household_idx").on(t.householdId), index("bills_due_idx").on(t.householdId, t.due),
    check("bills_repeat_day_valid", sql`${t.repeatDay} is null or ${t.repeatDay} between 1 and 31`),
    foreignKey({ columns: [t.householdId, t.memberId], foreignColumns: [members.householdId, members.id], name: "bills_member_household_fk" }),
    foreignKey({ columns: [t.householdId, t.documentId], foreignColumns: [documents.householdId, documents.id], name: "bills_document_household_fk" })],
).enableRLS();

// D42: a new bank balance. "confirmed" rows are the history of balances set; a "pending" row (from the agent or MCP)
// waits in To check and changes `households.bank_balance_minor` only when confirmed.
export const balanceUpdates = pgTable(
  "balance_updates",
  {
    id: id(),
    householdId: householdId(),
    amountMinor: minor("amount_minor").notNull(), // the new balance; may be negative
    currency: char("currency", { length: 3 }).notNull(),
    status: confirmStatus("status").notNull().default("confirmed"),
    createdAt: createdAt(),
  },
  (t) => [index("balance_updates_household_idx").on(t.householdId), unique("balance_updates_household_id_uq").on(t.householdId, t.id)],
).enableRLS();

// D43: a pot is money set aside with a reason. `saved_minor` is not spendable (the engine starts the runway from
// cash less every confirmed pot). `fill_bp` is the share of each client payment added to it, in basis points
// (2500 = 25%). A "pending" pot (from the agent or MCP) waits in To check and counts for nothing until confirmed.
export const pots = pgTable(
  "pots",
  {
    id: id(),
    householdId: householdId(),
    memberId: uuid("member_id").references(() => members.id, { onDelete: "set null" }), // null = shared
    name: text("name").notNull(),
    targetMinor: minor("target_minor"),
    targetDate: date("target_date", { mode: "string" }),
    savedMinor: minor("saved_minor").notNull().default(0),
    fillBp: integer("fill_bp"),
    currency: char("currency", { length: 3 }).notNull(),
    status: confirmStatus("status").notNull().default("confirmed"),
    createdAt: createdAt(),
  },
  (t) => [index("pots_household_idx").on(t.householdId), unique("pots_household_id_uq").on(t.householdId, t.id),
    check("pots_name_valid", sql`char_length(${t.name}) between 1 and 60`),
    check("pots_target_positive", sql`${t.targetMinor} is null or ${t.targetMinor} > 0`),
    check("pots_saved_valid", sql`${t.savedMinor} >= 0`),
    check("pots_fill_valid", sql`${t.fillBp} is null or ${t.fillBp} between 1 and 10000`),
    foreignKey({ columns: [t.householdId, t.memberId], foreignColumns: [members.householdId, members.id], name: "pots_member_household_fk" })],
).enableRLS();

export const readings = pgTable(
  "readings",
  {
    id: id(),
    householdId: householdId(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    extracted: jsonb("extracted").notNull(),
    status: readingStatus("status").notNull().default("to_check"),
    target: readingTarget("target").notNull(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("readings_household_idx").on(t.householdId),
    foreignKey({ columns: [t.householdId, t.documentId], foreignColumns: [documents.householdId, documents.id], name: "readings_document_household_fk" }).onDelete("cascade")],
).enableRLS();

// A correction keyed by biller, applied before the next reading is shown (D36).
export const rules = pgTable(
  "rules",
  {
    id: id(),
    householdId: householdId(),
    matchBiller: text("match_biller").notNull(),
    patch: jsonb("patch").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("rules_household_idx").on(t.householdId), unique("rules_household_biller_uq").on(t.householdId, t.matchBiller)],
).enableRLS();

// Everything that happened. This table is the Activity page and feeds the bell (D35).
export const events = pgTable(
  "events",
  {
    id: id(),
    householdId: householdId(),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    amountMinor: minor("amount_minor"),
    currency: char("currency", { length: 3 }),
    refType: text("ref_type"),
    refId: uuid("ref_id"),
    notify: boolean("notify").notNull().default(false),
    readAt: timestamp("read_at", { withTimezone: true }),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [
    index("events_household_idx").on(t.householdId),
    index("events_household_occurred_idx").on(t.householdId, t.occurredAt.desc()),
  ],
).enableRLS();

// Unique on PayPal's own event id, across households: a replayed webhook can never apply twice.
// household_id is null when a verified event matches no household: it is still recorded, so a redelivery is
// recognised by its event id.
export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: id(),
    householdId: uuid("household_id").references(() => households.id, { onDelete: "cascade" }),
    paypalEventId: text("paypal_event_id").notNull().unique(),
    eventType: text("event_type").notNull(),
    verified: boolean("verified").notNull(),
    payload: jsonb("payload").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [index("webhook_deliveries_household_idx").on(t.householdId)],
).enableRLS();

// MCP tokens (D27, D37): only the hash is stored; the token itself is shown once.
export const apiTokens = pgTable(
  "api_tokens",
  {
    id: id(),
    householdId: householdId(),
    name: text("name").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    last4: char("last4", { length: 4 }).notNull(),
    scopes: text("scopes").array().notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("api_tokens_household_idx").on(t.householdId)],
).enableRLS();

// One bounded counter per household and purpose. Each window reuses its row.
export const requestBuckets = pgTable("request_buckets", {
  householdId: householdId(),
  purpose: text("purpose").notNull(),
  window: timestamp("window", { withTimezone: true }).notNull(),
  count: integer("count").notNull(),
}, t => [primaryKey({ columns: [t.householdId, t.purpose] })]).enableRLS();
