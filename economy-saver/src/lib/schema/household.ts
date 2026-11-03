// The one versioned shape of a household (D44). The database builds it (src/db/snapshot.ts), Settings exports it,
// the `household_snapshot` tool hands it to the agent and MCP, and schema/household.v1.json is generated from it
// (npm run schema). Every object is strict, so a key that is not listed here is refused.
//
// Rules for every field: money is an integer count of minor units (whole yen, cents for USD) next to a 3-letter
// currency; dates are ISO strings (YYYY-MM-DD for a day, an RFC 3339 instant for a moment); ids are UUIDs; names
// are camelCase. Nothing here is a secret or a pointer to one: no AI key or its Vault id, no auth user ids, no MCP
// token data, no webhook payloads, no storage paths or file bytes.
import { z } from "zod";

export const SNAPSHOT_VERSION = 1;

const id = z.string().uuid();
const day = z.string().date().describe("A calendar day, YYYY-MM-DD.");
const moment = z.string().datetime().describe("An instant, ISO 8601 in UTC.");
const currency = z.string().regex(/^[A-Z]{3}$/).describe("ISO 4217 code, for example JPY or USD.");
const minor = z.number().int().safe().describe("Integer minor units: whole yen for JPY, cents for USD. Negative means owed or out.");
const rateMicro = z.number().int().safe().describe("An exchange rate scaled by 1e6: units of the home currency per 1 USD, or original to billed currency.");
const status = z.enum(["confirmed", "pending"]).describe("pending = waiting in To check; it counts for nothing until the user confirms it.");

const Member = z.object({
  id,
  displayName: z.string(),
  role: z.enum(["owner", "member"]),
}).strict();

const Card = z.object({
  id,
  memberId: id.nullable().describe("Whose card; null = a household card."),
  label: z.string(),
  closingDay: z.number().int().min(1).max(31).describe("Day of the month the statement closes; 31 = month end."),
  dueDay: z.number().int().min(1).max(31).describe("Day of the following month the statement is paid from the bank."),
  limitMinor: minor.nullable(),
  currency,
  revolving: z.boolean(),
}).strict();

const Statement = z.object({
  id,
  cardId: id,
  amountMinor: minor,
  currency,
  closedOn: day,
  dueOn: day,
  paidOn: day.nullable(),
}).strict();

const Charge = z.object({
  id,
  cardId: id,
  merchant: z.string(),
  amountMinor: minor.describe("As the card issuer bills it, in `currency`."),
  currency,
  originalAmountMinor: minor.nullable().describe("When paid in another currency: the amount in `originalCurrency`."),
  originalCurrency: currency.nullable(),
  fxRateMicro: rateMicro.nullable(),
  date: day,
  source: z.enum(["card_email", "receipt", "voice", "manual"]),
  status,
  place: z.string().nullable(),
  documentId: id.nullable(),
}).strict();

const Bill = z.object({
  id,
  memberId: id.nullable().describe("Whose bill; null = shared."),
  biller: z.string(),
  amountMinor: minor,
  currency,
  due: day.describe("The stored due date. A monthly bill is one row here, not one per month."),
  category: z.string(),
  status,
  previousAmountMinor: minor.nullable(),
  fxRateMicro: rateMicro.nullable(),
  repeatDay: z.number().int().min(1).max(31).nullable().describe("Day of the month a monthly bill falls due; null = one-off."),
  documentId: id.nullable(),
}).strict();

const Client = z.object({
  id,
  name: z.string(),
  email: z.string(),
  termsDays: z.number().int().min(0).describe("Payment terms in days; 0 = due on receipt."),
}).strict();

const Invoice = z.object({
  id,
  clientId: id,
  status: z.enum(["unbilled", "draft", "sent", "paid", "closed"]),
  number: z.string().nullable(),
  item: z.string(),
  note: z.string().nullable(),
  amountMinor: minor,
  currency,
  fxRateMicro: rateMicro.nullable().describe("Set when the payout was converted to the home currency."),
  sentOn: day.nullable(),
  dueOn: day.nullable(),
  paidOn: day.nullable(),
  paypalInvoiceId: z.string().nullable().describe("null = typed in or marked paid outside PayPal."),
  paypalStatus: z.string().nullable(),
  remindedAt: moment.nullable(),
}).strict();

const Pot = z.object({
  id,
  memberId: id.nullable().describe("Whose pot; null = shared."),
  name: z.string(),
  targetMinor: minor.nullable(),
  targetDate: day.nullable(),
  savedMinor: minor.describe("Set aside and not spendable once the pot is confirmed."),
  fillBp: z.number().int().min(1).max(10_000).nullable().describe("Share of each client payment added to the pot, in basis points (2500 = 25%)."),
  currency,
  status,
}).strict();

const BalanceUpdate = z.object({
  id,
  amountMinor: minor.describe("The new bank balance this update sets."),
  currency,
  status: status.describe("confirmed = a balance the user set (history); pending = waiting in To check, the bank balance does not change until it is confirmed."),
  createdAt: moment,
}).strict();

// A reference to a document the reader has seen. No storage path, no file, no extracted text, no error text.
const Document = z.object({
  id,
  kind: z.enum(["upload", "email"]),
  status: z.enum(["queued", "reading", "read", "failed"]),
  createdAt: moment,
}).strict();

const Event = z.object({
  id,
  kind: z.string(),
  title: z.string(),
  body: z.string().nullable(),
  amountMinor: minor.nullable(),
  currency: currency.nullable(),
  refType: z.string().nullable(),
  refId: id.nullable(),
  notify: z.boolean(),
  readAt: moment.nullable(),
  occurredAt: moment,
}).strict();

const Truncated = z.object({
  bills: z.boolean(),
  charges: z.boolean(),
  statements: z.boolean(),
  invoices: z.boolean(),
  balanceUpdates: z.boolean(),
  documents: z.boolean(),
}).strict().describe("true = that list holds only its most recent rows because the reader asked for a window; the export is never truncated.");

export const HouseholdSnapshot = z.object({
  version: z.literal(SNAPSHOT_VERSION),
  generatedAt: moment,
  household: z.object({
    id,
    name: z.string(),
    homeCurrency: currency,
    timeZone: z.string().describe("IANA time zone name."),
    today: day.describe("The household's own date, including a demo household's scenario date."),
    isDemo: z.boolean(),
    bankBalanceMinor: minor.describe("The bank balance the user typed in, in `homeCurrency`."),
    paypalBalanceMinor: minor.describe("The household's PayPal connection balances added up and converted to `homeCurrency` at `usdRateMicro`; 0 with no connection. Total cash is this plus `bankBalanceMinor`, before money set aside in pots."),
    usdRateMicro: z.number().int().positive().safe().describe("Home currency per 1 USD scaled by 1e6, the rate the household's money state uses today (1000000 when `homeCurrency` is USD)."),
    usdRateDate: day.nullable().describe("The day `usdRateMicro` is from; null when `homeCurrency` is USD."),
  }).strict(),
  members: z.array(Member),
  cards: z.array(Card),
  statements: z.array(Statement),
  charges: z.array(Charge),
  bills: z.array(Bill).describe("Stored rows. A monthly bill appears once, with `repeatDay`; occurrences are not expanded."),
  clients: z.array(Client),
  invoices: z.array(Invoice),
  pots: z.array(Pot),
  balanceUpdates: z.array(BalanceUpdate).describe("Bank balances set (confirmed) and waiting in To check (pending). Pending bills, charges and pots carry `status` in their own lists."),
  documents: z.array(Document).describe("References only."),
  truncated: Truncated,
  events: z.array(Event).optional().describe("The household's audit trail, newest first. Only in the export."),
}).strict().describe("A whole household at one moment: version 1 of the Personal Economy Saver household schema.");

export type HouseholdSnapshot = z.infer<typeof HouseholdSnapshot>;
export type SnapshotMember = z.infer<typeof Member>;
export type SnapshotCard = z.infer<typeof Card>;
export type SnapshotStatement = z.infer<typeof Statement>;
export type SnapshotCharge = z.infer<typeof Charge>;
export type SnapshotBill = z.infer<typeof Bill>;
export type SnapshotClient = z.infer<typeof Client>;
export type SnapshotInvoice = z.infer<typeof Invoice>;
export type SnapshotPot = z.infer<typeof Pot>;
export type SnapshotBalanceUpdate = z.infer<typeof BalanceUpdate>;
export type SnapshotDocument = z.infer<typeof Document>;
export type SnapshotEvent = z.infer<typeof Event>;
