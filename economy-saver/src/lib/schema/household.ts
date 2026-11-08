// The one versioned shape of a household (D44). The database builds it (src/db/snapshot.ts), Settings exports it,
// the `household_snapshot` tool hands it to the agent and MCP, and schema/household.v3.json is generated from it
// (npm run schema). Every object is strict, so a key that is not listed here is refused.
//
// Rules for every field: money is an integer count of minor units (whole yen, cents for USD) next to a 3-letter
// currency; dates are ISO strings (YYYY-MM-DD for a day, an RFC 3339 instant for a moment); ids are UUIDs; names
// are camelCase. Nothing here is a secret or a pointer to one: no AI key or its Vault id, no auth user ids, no MCP
// token data, no webhook payloads, no storage paths or file bytes.
import { z } from "zod";
import { CategoryKeySchema } from "@/lib/money/categories";
import { RecipeSchema } from "@/lib/canvas/schema";
import { MemoryItem } from "@/lib/schema/memory";
import { BriefSchema } from "@/lib/agent/brief";
import { ConversationTurn } from "@/lib/schema/turn";

/** Version 3 adds the spaces of the Ask journal (D69), in the export only. */
export const SNAPSHOT_VERSION = 3;

const id = z.string().uuid();
const day = z.string().date().describe("A calendar day, YYYY-MM-DD.");
const moment = z.string().datetime().describe("An instant, ISO 8601 in UTC.");
const currency = z.string().regex(/^[A-Z]{3}$/).describe("ISO 4217 code, for example JPY or USD.");
const minor = z.number().int().safe().describe("Integer minor units: whole yen for JPY, cents for USD. Negative means owed or out.");
const rateMicro = z.number().int().safe().describe("An exchange rate scaled by 1e6: units of the home currency per 1 USD, or original to billed currency.");
const category = CategoryKeySchema.describe("One of the fourteen fixed categories; the key, not the label.");
const businessBp = z.number().int().min(0).max(10_000).describe("The business share in basis points: 0 = personal, 10000 = business, between = mixed (3000 = 30% business). Categories and shares move no money.");
const madeBy = z.enum(["form", "ask", "mcp", "reader", "cron", "paypal", "import"]).optional().describe("Who made the row: form = typed in or confirmed in the app, ask = the in-app assistant, mcp = a connected assistant, reader = read from a document, cron = the daily job, paypal = PayPal, import = an import.");
const status = z.enum(["confirmed", "pending"]).describe("pending = waiting in To check; it counts for nothing until the user confirms it.");

const Member = z.object({
  id,
  displayName: z.string(),
  role: z.enum(["owner", "member"]),
  shareBp: z.number().int().min(0).max(10_000).describe("Share of the household's shared bills and charges, in basis points (4000 = 40%). The members' shares total 10000."),
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
  foreignFeeBp: z.number().int().min(0).max(1000).nullable().optional().describe("The issuer's foreign transaction fee in basis points (220 = 2.2%), from the card's own terms; null or absent = not entered."),
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
  fxEstimated: z.boolean().optional().describe("true = `amountMinor` is the reference-rate conversion of the original amount (a reader estimate), not what the issuer billed; absent = false."),
  date: day,
  source: z.enum(["card_email", "receipt", "voice", "manual"]),
  status,
  place: z.string().nullable(),
  shared: z.boolean().describe("true = split between the members by their shares; the owner of the card paid it."),
  category,
  businessBp,
  documentId: id.nullable(),
  madeBy,
}).strict();

const Bill = z.object({
  id,
  memberId: id.nullable().describe("Whose bill; null = shared."),
  paidByMemberId: id.nullable().describe("Who pays a shared bill, at every occurrence of a repeating one; the bill is split between the members only when this is set. Null otherwise."),
  biller: z.string(),
  amountMinor: minor.nullable().describe("The stored amount; null = not known yet (a one-off, or a monthly bill whose amount varies). A bill with no amount counts as an estimate from the household's earlier bills of the same name, or for nothing when there are none."),
  currency,
  due: day.nullable().describe("The stored due date. A repeating bill is one row here, not one per month. Null = not known yet (a one-off only); it counts as due today."),
  category,
  businessBp,
  status,
  previousAmountMinor: minor.nullable(),
  fxRateMicro: rateMicro.nullable(),
  repeatDay: z.number().int().min(1).max(31).nullable().describe("Day of the month a monthly bill falls due; null unless repeatUnit is month."),
  repeatUnit: z.enum(["month", "year"]).nullable().optional().describe("month = every month on repeatDay, year = every year on the due date's month and day (29 Feb becomes 28 Feb in a common year); null or absent = one-off."),
  nextAmountMinor: minor.nullable().optional().describe("The amount an occurrence on or after nextAmountFrom costs, in the bill's currency; null or absent = the amount never changes. Set together with nextAmountFrom."),
  nextAmountFrom: day.nullable().optional().describe("The first date nextAmountMinor applies on."),
  cancelBy: day.nullable().optional().describe("Information only: the last day to cancel or change the bill before its next occurrence charges. The app never cancels anything."),
  repeatUntil: day.nullable().optional().describe("The last day an occurrence may fall on (the last payment); null or absent = it goes on. Only on a bill that repeats."),
  amountVaries: z.boolean().optional().describe("A monthly bill whose amount changes every month (electricity, water, gas): a month without its real bill is forecast as the average of the last three real bills linked to it (amountMinor when there are none). Absent = false."),
  seriesBillId: id.nullable().optional().describe("On a one-off real bill: the id of the amount-varies monthly bill it belongs to; it replaces that series' estimate in its due month. Null or absent = not linked."),
  periodStart: day.nullable().optional().describe("The first day a one-off bill covers (\"11月分\" is Nov 1); information only: the money counts by the due date. Set together with periodEnd; null or absent = not known."),
  periodEnd: day.nullable().optional().describe("The last day the bill covers; on or after periodStart."),
  documentId: id.nullable(),
  madeBy,
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
  madeBy,
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
  madeBy,
}).strict();

const Settlement = z.object({
  id,
  fromMemberId: id.describe("Who paid."),
  toMemberId: id.describe("Who received."),
  amountMinor: minor.describe("In `currency`, always more than zero."),
  currency,
  through: day.describe("Shared items dated on or before this day were settled, except those dated this day and created after `settledAt`; the next balance counts the rest."),
  settledAt: moment.describe("When the settlement was recorded."),
  createdAt: moment,
}).strict();

const BalanceUpdate = z.object({
  id,
  amountMinor: minor.describe("The new bank balance this update sets."),
  currency,
  status: status.describe("confirmed = a balance the user set (history); pending = waiting in To check, the bank balance does not change until it is confirmed."),
  createdAt: moment,
  madeBy,
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
  madeBy,
}).strict();

// A pinned canvas as exported: the recipe holds queries, never numbers (D57), so a restored pin draws today's numbers.
const PinnedCanvasExport = z.object({
  id,
  title: z.string().min(1).max(80),
  position: z.number().int().min(0).describe("0 is first in this space."),
  spaceId: id.optional(),
  recipe: RecipeSchema,
  createdAt: moment,
}).strict();

const SpaceExport = z.object({
  id, name: z.string().trim().min(1).max(60), isGeneral: z.boolean(),
  status: z.enum(["open", "archived"]), brief: z.union([z.object({}).strict(), BriefSchema]),
  briefUpdatedAt: moment.nullable(), briefUpdatedBy: z.enum(["ask", "form"]).nullable(), createdAt: moment,
}).strict().superRefine((space, ctx) => {
  const missing = (space.briefUpdatedAt === null) || (space.briefUpdatedBy === null);
  if (missing && (Object.keys(space.brief).length !== 0 || space.briefUpdatedAt !== space.briefUpdatedBy)) {
    ctx.addIssue({ code: "custom", path: ["brief"], message: "A saved brief needs its date and author." });
  }
});

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
    splitSince: day.nullable().describe("The day the household got its second member and shared costs began to be split; null while it has one member."),
  }).strict(),
  members: z.array(Member),
  cards: z.array(Card),
  statements: z.array(Statement),
  charges: z.array(Charge),
  bills: z.array(Bill).describe("Stored rows. A repeating bill appears once, with `repeatUnit` (and `repeatDay` when monthly); occurrences are not expanded."),
  clients: z.array(Client),
  invoices: z.array(Invoice),
  pots: z.array(Pot),
  settlements: z.array(Settlement).describe("Every transfer recorded by Mark settled, oldest first."),
  balanceUpdates: z.array(BalanceUpdate).describe("Bank balances set (confirmed) and waiting in To check (pending). Pending bills, charges and pots carry `status` in their own lists."),
  documents: z.array(Document).describe("References only."),
  truncated: Truncated,
  events: z.array(Event).optional().describe("The household's audit trail, newest first. Only in the export."),
  memory: z.array(MemoryItem).optional().describe("What the assistant remembers (D58). Only in the export."),
  canvases: z.array(PinnedCanvasExport).optional().describe("The canvases pinned to Home, in order (D57). Only in the export."),
  journal: z.array(ConversationTurn).optional().describe("The conversation turns, oldest first (D60). Only in the export."),
  spaces: z.array(SpaceExport).optional().describe("The journal’s spaces, with their briefs (D69). Only in the export."),
}).strict().describe("A whole household at one moment: version 3 of the Personal Economy Saver household schema, including spaces in the export.");

export type HouseholdSnapshot = z.infer<typeof HouseholdSnapshot>;
