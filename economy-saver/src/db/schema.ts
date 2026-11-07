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
  smallint,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { CATEGORY_KEYS } from "../lib/money/categories";

const categoryList = sql.raw(CATEGORY_KEYS.map(key => `'${key}'`).join(", "));
const minor = (name: string) => bigint(name, { mode: "number" });
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const id = () => uuid("id").primaryKey().defaultRandom();
const householdId = () =>
  uuid("household_id")
    .notNull()
    .references(() => households.id, { onDelete: "cascade" });

// Every pgEnum is exported: drizzle-kit only sees exported enums and would drop the type in the next migration.
export const memberRole = pgEnum("member_role", ["owner", "member"]);
export const invoiceStatus = pgEnum("invoice_status", ["unbilled", "draft", "sent", "paid", "closed"]);
export const confirmStatus = pgEnum("confirm_status", ["confirmed", "pending"]);
export const chargeSource = pgEnum("charge_source", ["card_email", "receipt", "voice", "manual"]);
export const documentKind = pgEnum("document_kind", ["upload", "email"]);
export const documentStatus = pgEnum("document_status", ["queued", "reading", "read", "failed"]);
export const readingStatus = pgEnum("reading_status", ["to_check", "confirmed", "rejected"]);
export const readingTarget = pgEnum("reading_target", ["bill", "charge"]);
// D50: who made a row or event. `ask_id` ties an Ask-made row to its question.
export const madeBy = pgEnum("made_by", ["form", "ask", "mcp", "reader", "cron", "paypal", "import"]);
const madeByColumn = () => madeBy("made_by").notNull().default("form");
const askIdColumn = () => uuid("ask_id");
export const memoryKind = pgEnum("memory_kind", ["fact", "preference", "goal", "instruction", "correction"]);

export const households = pgTable("households", {
  id: id(),
  name: text("name").notNull(),
  timeZone: text("time_zone").notNull().default("Asia/Tokyo"),
  homeCurrency: char("home_currency", { length: 3 }).notNull(),
  bankBalanceMinor: minor("bank_balance_minor").notNull().default(0), // typed in by the user
  isDemo: boolean("is_demo").notNull().default(false),
  fixedToday: date("fixed_today", { mode: "string" }), // D51: set only on Try it (the day Ben's numbers need); null = the real date in the time zone
  forwardingLocalpart: text("forwarding_localpart"),
  runwayShort: boolean("runway_short"),
  nudgeAfterDays: integer("nudge_after_days"), // D50: null = off; the daily job suggests a nudge this many days past due
  notificationDay: date("notification_day", { mode: "string" }),
  splitSince: date("split_since", { mode: "string" }), // D45: the day the household got its second member; null while it has one
  aiKeySecretId: uuid("ai_key_secret_id"), // the user's own key lives in Supabase Vault (D33); this is its id
  aiKeyHint: text("ai_key_hint"), // prefix…suffix only
  // D56: the household's own model. Provider, protocol and base URL are all null or all set.
  aiProvider: text("ai_provider"), // an id from PROVIDERS
  aiProtocol: text("ai_protocol"),
  aiBaseUrl: text("ai_base_url"),
  aiTextModel: text("ai_text_model"),
  aiDocumentModel: text("ai_document_model"),
  aiCheck: jsonb("ai_check"),
  aiReadsToday: integer("ai_reads_today").notNull().default(0),
  aiReadsDay: date("ai_reads_day", { mode: "string" }),
  // D59: where each movable kind is kept. `device` means the browser holds it and the server holds none of it.
  memoryPlace: text("memory_place").notNull().default("cloud"),
  journalPlace: text("journal_place").notNull().default("cloud"),
  canvasPlace: text("canvas_place").notNull().default("cloud"),
  createdAt: createdAt(),
}, (t) => [
  check("households_memory_place_valid", sql`${t.memoryPlace} in ('cloud', 'device')`),
  check("households_journal_place_valid", sql`${t.journalPlace} in ('cloud', 'device')`),
  check("households_canvas_place_valid", sql`${t.canvasPlace} in ('cloud', 'device')`),
  check("households_nudge_after_days_valid", sql`${t.nudgeAfterDays} is null or ${t.nudgeAfterDays} between 1 and 60`),
  check("households_ai_protocol_valid", sql`${t.aiProtocol} is null or ${t.aiProtocol} in ('anthropic', 'openai')`),
  check("households_ai_endpoint_together", sql`(${t.aiProvider} is null and ${t.aiProtocol} is null and ${t.aiBaseUrl} is null) or (${t.aiProvider} is not null and ${t.aiProtocol} is not null and ${t.aiBaseUrl} is not null)`),
]).enableRLS();

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
    shareBp: integer("share_bp").notNull(), // D45: share of shared costs in basis points; a household's members total 10,000 (checked in code)
    createdAt: createdAt(),
  },
  (t) => [index("members_household_idx").on(t.householdId), unique("members_household_id_uq").on(t.householdId, t.id),
    check("members_share_valid", sql`${t.shareBp} between 0 and 10000`)],
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
    madeBy: madeByColumn(),
    askId: askIdColumn(),
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
    foreignFeeBp: integer("foreign_fee_bp"), // D62: the issuer's foreign transaction fee in basis points (220 = 2.2%), from the card's terms; null = not entered
    createdAt: createdAt(),
  },
  (t) => [
    index("cards_household_idx").on(t.householdId),
    unique("cards_household_id_uq").on(t.householdId, t.id),
    foreignKey({ columns: [t.householdId, t.memberId], foreignColumns: [members.householdId, members.id], name: "cards_member_household_fk" }),
    check("cards_days_valid", sql`${t.closingDay} between 1 and 31 and ${t.dueDay} between 1 and 31`),
    check("cards_foreign_fee_valid", sql`${t.foreignFeeBp} is null or (${t.foreignFeeBp} between 0 and 1000)`),
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
    fxEstimated: boolean("fx_estimated").notNull().default(false), // D62: true when the billed amount is the reference-rate conversion (the reader), not what the issuer billed
    shared: boolean("shared").notNull().default(false), // D45: split between the members; the card's owner paid it
    category: text("category").notNull().default("other"), // D46: a key from lib/money/categories.ts
    businessBp: integer("business_bp").notNull().default(0), // D46: business share in basis points; 0 = personal, 10000 = business
    date: date("date", { mode: "string" }).notNull(),
    source: chargeSource("source").notNull(),
    status: confirmStatus("status").notNull().default("confirmed"),
    place: text("place"),
    documentId: uuid("document_id").references(() => documents.id, { onDelete: "set null" }),
    madeBy: madeByColumn(),
    askId: askIdColumn(),
    createdAt: createdAt(),
  },
  (t) => [
    index("charges_household_idx").on(t.householdId),
    index("charges_card_date_idx").on(t.cardId, t.date),
    foreignKey({ columns: [t.householdId, t.cardId], foreignColumns: [cards.householdId, cards.id], name: "charges_card_fk" }).onDelete("cascade"),
    foreignKey({ columns: [t.householdId, t.documentId], foreignColumns: [documents.householdId, documents.id], name: "charges_document_household_fk" }),
    check("charges_original_pair", sql`(${t.originalAmountMinor} is null) = (${t.originalCurrency} is null)`),
    check("charges_category_valid", sql`${t.category} in (${categoryList})`),
    check("charges_business_valid", sql`${t.businessBp} between 0 and 10000`),
  ],
).enableRLS();

export const bills = pgTable(
  "bills",
  {
    id: id(),
    householdId: householdId(),
    memberId: uuid("member_id").references(() => members.id, { onDelete: "set null" }), // null = shared
    paidByMemberId: uuid("paid_by_member_id"), // D45: who pays a shared bill (every occurrence); only with member_id null
    biller: text("biller").notNull(),
    amountMinor: minor("amount_minor"), // D55: null = not known yet (a one-off, or a monthly bill whose amount varies)
    currency: char("currency", { length: 3 }).notNull(),
    due: date("due", { mode: "string" }), // D55: null = not known yet (a one-off bill only)
    category: text("category").notNull(), // D46: a key from lib/money/categories.ts
    businessBp: integer("business_bp").notNull().default(0), // D46: business share in basis points; 0 = personal, 10000 = business
    status: confirmStatus("status").notNull().default("confirmed"),
    previousAmountMinor: minor("previous_amount_minor"),
    fxRateMicro: bigint("fx_rate_micro", { mode: "number" }),
    documentId: uuid("document_id").references(() => documents.id, { onDelete: "set null" }),
    repeatDay: integer("repeat_day"), // D41: day of the month a monthly bill repeats on; only with repeat_unit = 'month'
    repeatUnit: text("repeat_unit"), // D48: 'month' or 'year'; null = one-off. A yearly bill repeats on its due date's month and day
    nextAmountMinor: minor("next_amount_minor"), // D48: the amount from next_amount_from on (occurrences on or after it)
    nextAmountFrom: date("next_amount_from", { mode: "string" }),
    cancelBy: date("cancel_by", { mode: "string" }), // D48: information only: the date to act by before the next occurrence charges
    repeatUntil: date("repeat_until", { mode: "string" }), // D41: the last day an occurrence may fall on (the last payment); only on a bill that repeats
    amountVaries: boolean("amount_varies").notNull().default(false), // D54: a monthly bill forecast from its own past; only with repeat_unit = 'month', never with a next amount
    seriesBillId: uuid("series_bill_id"), // D54: the amount-varies series this one-off real bill belongs to (same household); it replaces that month's estimate
    madeBy: madeByColumn(),
    askId: askIdColumn(),
    createdAt: createdAt(),
  },
  (t) => [index("bills_household_idx").on(t.householdId), index("bills_due_idx").on(t.householdId, t.due),
    check("bills_repeat_day_valid", sql`${t.repeatDay} is null or ${t.repeatDay} between 1 and 31`),
    check("bills_repeat_unit_valid", sql`${t.repeatUnit} is null or ${t.repeatUnit} in ('month', 'year')`),
    check("bills_repeat_day_monthly", sql`(${t.repeatUnit} is not distinct from 'month') = (${t.repeatDay} is not null)`),
    check("bills_next_amount_pair", sql`(${t.nextAmountMinor} is null) = (${t.nextAmountFrom} is null)`),
    check("bills_amount_varies_monthly", sql`not ${t.amountVaries} or (${t.repeatUnit} is not distinct from 'month' and ${t.nextAmountMinor} is null)`),
    check("bills_repeat_until_valid", sql`${t.repeatUntil} is null or (${t.repeatUnit} is not null and ${t.due} is not null and ${t.repeatUntil} >= ${t.due})`),
    check("bills_series_one_off", sql`${t.seriesBillId} is null or ${t.repeatUnit} is null`),
    check("bills_amount_unknown_shape", sql`${t.amountMinor} is not null or ((${t.repeatUnit} is null or ${t.amountVaries}) and ${t.nextAmountMinor} is null and ${t.previousAmountMinor} is null)`),
    check("bills_due_unknown_one_off", sql`${t.due} is not null or (${t.repeatUnit} is null and ${t.seriesBillId} is null and ${t.cancelBy} is null)`),
    unique("bills_household_id_uq").on(t.householdId, t.id),
    index("bills_series_idx").on(t.householdId, t.seriesBillId),
    // D54: the series is a bill of the same household; removing it leaves its real bills as plain one-offs (only series_bill_id is cleared, see migration 0018).
    foreignKey({ columns: [t.householdId, t.seriesBillId], foreignColumns: [t.householdId, t.id], name: "bills_series_household_fk" }).onDelete("set null"),
    check("bills_category_valid", sql`${t.category} in (${categoryList})`),
    check("bills_business_valid", sql`${t.businessBp} between 0 and 10000`),
    foreignKey({ columns: [t.householdId, t.memberId], foreignColumns: [members.householdId, members.id], name: "bills_member_household_fk" }),
    foreignKey({ columns: [t.householdId, t.paidByMemberId], foreignColumns: [members.householdId, members.id], name: "bills_paid_by_household_fk" }),
    check("bills_paid_by_shared_only", sql`${t.paidByMemberId} is null or ${t.memberId} is null`),
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
    madeBy: madeByColumn(),
    askId: askIdColumn(),
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
    madeBy: madeByColumn(),
    askId: askIdColumn(),
    createdAt: createdAt(),
  },
  (t) => [index("pots_household_idx").on(t.householdId), unique("pots_household_id_uq").on(t.householdId, t.id),
    check("pots_name_valid", sql`char_length(${t.name}) between 1 and 60`),
    check("pots_target_positive", sql`${t.targetMinor} is null or ${t.targetMinor} > 0`),
    check("pots_saved_valid", sql`${t.savedMinor} >= 0`),
    check("pots_fill_valid", sql`${t.fillBp} is null or ${t.fillBp} between 1 and 10000`),
    foreignKey({ columns: [t.householdId, t.memberId], foreignColumns: [members.householdId, members.id], name: "pots_member_household_fk" })],
).enableRLS();

// D45: one row per transfer recorded by "Mark settled". `through` is the household's date when it was settled; the next
// balance counts only shared items dated after the latest `through`, plus items dated `through` that were created after `settled_at`.
export const settlements = pgTable(
  "settlements",
  {
    id: id(),
    householdId: householdId(),
    fromMemberId: uuid("from_member_id").notNull(), // who paid
    toMemberId: uuid("to_member_id").notNull(), // who received
    amountMinor: minor("amount_minor").notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    through: date("through", { mode: "string" }).notNull(),
    settledAt: timestamp("settled_at", { withTimezone: true }).notNull().defaultNow(), // database clock, like created_at: an item dated `through` counts again only if it was created after this
    createdAt: createdAt(),
  },
  (t) => [index("settlements_household_idx").on(t.householdId, t.through),
    check("settlements_amount_positive", sql`${t.amountMinor} > 0`),
    check("settlements_different_members", sql`${t.fromMemberId} <> ${t.toMemberId}`),
    foreignKey({ columns: [t.householdId, t.fromMemberId], foreignColumns: [members.householdId, members.id], name: "settlements_from_household_fk" }),
    foreignKey({ columns: [t.householdId, t.toMemberId], foreignColumns: [members.householdId, members.id], name: "settlements_to_household_fk" })],
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
    madeBy: madeByColumn(),
    askId: askIdColumn(),
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

// Family view links (D52): only the SHA-256 of the token is stored; the link is shown once. Like MCP tokens, not part of the
// household snapshot (D44). `expires_at` is real time (seven days), not the household's fixed demo date.
export const familyLinks = pgTable(
  "family_links",
  {
    id: id(),
    householdId: householdId(),
    tokenHash: text("token_hash").notNull().unique(),
    createdByMemberId: uuid("created_by_member_id").notNull(),
    createdAt: createdAt(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    stoppedAt: timestamp("stopped_at", { withTimezone: true }),
  },
  (t) => [index("family_links_household_idx").on(t.householdId),
    foreignKey({ columns: [t.householdId, t.createdByMemberId], foreignColumns: [members.householdId, members.id], name: "family_links_member_household_fk" }).onDelete("cascade")],
).enableRLS();

// One bounded counter per household and purpose. Each window reuses its row.
export const requestBuckets = pgTable("request_buckets", {
  householdId: householdId(),
  purpose: text("purpose").notNull(),
  window: timestamp("window", { withTimezone: true }).notNull(),
  count: integer("count").notNull(),
}, t => [primaryKey({ columns: [t.householdId, t.purpose] })]).enableRLS();

// D58: what the assistant remembers. Plain text the person can read, edit and delete; delete is real (D59).
export const memories = pgTable(
  "memories",
  {
    id: id(),
    householdId: householdId(),
    kind: memoryKind("kind").notNull(),
    text: text("text").notNull(),
    madeBy: madeByColumn(),
    askId: askIdColumn(),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("memories_household_idx").on(t.householdId), check("memories_text_valid", sql`char_length(${t.text}) between 1 and 400`)],
).enableRLS();

// D57: a canvas pinned to Home. The recipe holds queries, never numbers; `position` 0 is first.
export const canvases = pgTable(
  "canvases",
  {
    id: id(),
    householdId: householdId(),
    title: text("title").notNull(),
    recipe: jsonb("recipe").notNull(), // a RecipeSchema value; its version is inside
    position: integer("position").notNull(),
    madeBy: madeByColumn(),
    askId: askIdColumn(),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("canvases_household_position_idx").on(t.householdId, t.position), check("canvases_title_valid", sql`char_length(${t.title}) between 1 and 80`)],
).enableRLS();

// D60: one question and its reply. `id` is the question's ask_id, so a retried question is one row.
export const conversationTurns = pgTable(
  "conversation_turns",
  {
    id: uuid("id").primaryKey(),
    householdId: householdId(),
    conversationId: uuid("conversation_id").notNull(),
    question: text("question").notNull(),
    kind: text("kind").notNull(), // answer, clarify, declined or document
    documentId: uuid("document_id"), // D60: the file attached in Ask (kind document); looked up by household; a deleted document leaves it pointing nowhere
    reply: text("reply").notNull(),
    choices: jsonb("choices"), // clarify only
    recipe: jsonb("recipe"),
    sources: jsonb("sources").notNull().default(sql`'[]'::jsonb`), // { label, href }[]
    thumb: smallint("thumb"),
    createdAt: createdAt(),
  },
  (t) => [
    index("conversation_turns_household_idx").on(t.householdId, t.conversationId, t.createdAt),
    check("conversation_turns_question_valid", sql`char_length(${t.question}) between 1 and 320`),
    check("conversation_turns_kind_valid", sql`${t.kind} in ('answer', 'clarify', 'declined', 'document')`),
    check("conversation_turns_thumb_valid", sql`${t.thumb} is null or ${t.thumb} in (-1, 1)`),
  ],
).enableRLS();
