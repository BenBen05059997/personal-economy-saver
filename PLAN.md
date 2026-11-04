# Personal Economy Saver: plan

**Submit the evening of Nov 12, Tokyo** (closes Nov 13 05:00 Tokyo). The one other date is the early Devpost version by Nov 5 (D30). What the product is and why: [DECISIONS.md](DECISIONS.md) (D2, D3). The hard rules: [AGENTS.md](AGENTS.md). Tick a box the moment it is true. Owner = Ben; implementation by subagents, reviewed by the lead (D19).

## What exists now

- **Foundation (D31–D37).** The Supabase project in Tokyo has all thirteen migrations applied (21 tables), one fictional Ben household seeded, Vault create/read/delete passing, the private Storage bucket `household-documents` verified (a test object was refused to the publishable key and its public URL), and no readable rows in `households` for the publishable key. The app builds as a Cloudflare Worker through OpenNext (2,674 KiB gzip, limit 3 MiB) with the daily Cron Trigger; the local Worker preview renders the Tokyo household.
- **Screens (D25).** Shell with sidebar, top bar (Ask, bell, Add) and phone layout; Home (sentence, safe to spend, runway, To check, Cards, Coming up); To check; Activity; Cards and Clients with a right-hand panel; invoice review; Upload; Options; Settings. Checked at 375px and 1440px, light and dark.
- **Sessions (D34).** Try it makes an anonymous fictional household with a protected cookie and a demo-only reset, anchored at Nov 14, 2026. Magic-link routes, session refresh, scoped membership and onboarding are implemented and tested on PGlite; a real magic link is not verified yet.
- **PayPal (D12–D15, D37).** Sandbox guard, REST client, toolkit split (the agent drafts, the approve route sends), invoice review and approve/send/remind, verified webhook persisted in Postgres, scoped refresh with a five-minute cooldown, `npm run smoke`. A real sandbox send and paid webhook have not run on a deployed URL.
- **Typed-in doors (FN1, D39).** Add a client, add a bill, log a card charge and mark an invoice paid outside PayPal work end to end in the browser at 375px and desktop. `npm run db:doors-test` has 29 checks. Every form that posts to an `/api` route is the one client form `components/ui/ApiForm.tsx` (fetch; a refusal shows the route's message inline and keeps what was typed; an accepted post refreshes the page or follows the route's redirect, sent as 204 plus `x-form-redirect` to a fetch and as the 303 to a native post, `lib/form-fetch.ts`); upload keeps its own form. A bill (a monthly one as a whole series) or a card charge is removed from Settings' bills panel or the Card panel's Recent charges with an in-page confirm (`/api/remove`, `removeBill`, `removeCharge`, an Activity event); amounts take thousands separators and stop at ¥100,000,000 or $1,000,000, and a bill or charge date stops two years after today (`lib/money/amount.ts`, `lib/money/horizon.ts`). PayPal history import (`/api/paypal/import`, `npm run db:import-test`, 6 checks) is built and tested, not run live.
- **In-app agent and MCP (FN2, D40, D27).** `src/lib/agent/tools.ts` is the one catalogue: read tools `where_am_i`, `whats_due`, `can_i_spend`, `list_clients_and_cards`, `timeline`, `options_when_short`, `list_invoices`, `plan_for`, `household_snapshot`, `month_by_category`; draft tools `draft_invoice`, `add_bill`, `log_charge`, `update_bank_balance`, `add_pot` (all but the first make a pending row in To check). `/api/ask` and the MCP server use it. `scripts/agent-test.ts` has 16 checks with a fake transport; no live Claude call has run. Without the Anthropic settings the Ask panel shows "ANTHROPIC_TEXT_MODEL is not set".
- **Pots and planning (D43).** `/plan` lists pots (name, saved, target and date, fill percentage, and for a goal the monthly amount needed with whether the next 30 days leave room) and adds, edits and removes them; Home shows one line per pot under the bank balance. Money in confirmed pots is taken off the cash the runway starts from (`availableCash` in `runway.ts`), so safe to spend, the low point, card room, the sentence and the options agree; Ben has no pots, so every demo number is unchanged. A client payment (verified webhook, or marked paid outside PayPal) adds each pot's percentage to it and records an event. `plan.ts` holds the maths (`monthlyRoom`, `planFor`); the agent's `plan_for` quotes a summary built in code and `add_pot` makes a pending pot in To check. `npm run db:pots-test` has 20 checks.
- **One household schema (D44).** `HouseholdSnapshot` (version 1, strict zod) in `src/lib/schema/household.ts`; `loadHouseholdSnapshot` in `src/db/snapshot.ts` reads one household in a read transaction from named columns and parses before returning. Settings has "Export my data", a POST form to `/api/export` (same-origin, 6 a minute, `no-store`, attachment `personal-economy-saver-<date>.json`, events included); on dev a Try it household's export came back with those headers, the GET and a cross-origin POST were refused, and the file held no keys outside the schema. The read tool `household_snapshot` (agent and MCP) returns the same without events, at most the 100 most recent rows of each long list with a `truncated` flag per list. `npm run schema` writes `schema/household.v1.json` from the zod definition (`zod-to-json-schema`, the library the tool schemas use). The household block also carries `paypalBalanceMinor` (connection balances summed in the home currency with `paypalTotalMinor`, the function `loadMoneyState` uses) and `usdRateMicro` / `usdRateDate` (from `usdRate`, which `usdRateMicro` wraps); no merchant id is read. `npm run db:snapshot-test` (13 checks) covers parsing, integer money, repeating bills once, pots and a pending balance update, household scope, forbidden keys and planted secret values, events only in the export, the window and drift of the JSON Schema.
- **Reader (D10, D36).** Photo/PDF upload and forwarded mail go to private Storage; Claude reads in the background; To check shows the reading; confirmation creates a bill or charge; corrections become rules; file cleanup on reset, upgrade and deletion. The Worker email handler and `/api/inbound` are implemented. Live Claude and Email Routing are not verified.
- **Categories and the business share (D46).** Thirteen fixed category keys with labels (`src/lib/money/categories.ts`) on `bills.category` and `charges.category` under check constraints, and `business_bp` (0–10000) on both (`drizzle/0012_small_ben_parker.sql`). The pure keyword table `lib/money/categorise.ts` proposes a category from a biller or merchant name; every form that takes a bill or charge (Add, the reader's review in To check) shows a Category select, pre-selected only when the table is sure, and a Personal / Business / Mixed share control; To check rows show the category and share. `lib/money/month.ts` `monthByCategory` builds the current month by category (confirmed bills once at their occurrence, confirmed charges, home currency, business and personal parts that add up) for Plan's "Where the month goes" and the read tool `month_by_category`; a monthly bill's occurrences carry `startsOn` so an occurrence earlier in the month than today still counts. `add_bill` and `log_charge` take `category` and `business_bp`, guess from the name when none is given and say so. The snapshot carries both fields. `npm run db:category-test` (17 checks). Categories and shares move no money: the runway, safe to spend and the sentence do not read them.
- **Options (D7) and household (D28).** Options ranks total extra cost with the Japan references in DECISIONS; Settings edits bank balance, member names, cards and bill ownership.
- **Own AI key (D33).** Settings key field, Vault create/update/delete, and atomic daily default-key quota reservation by the household's local date are implemented and tested; no live call yet.
- **Catalogue (D6).** Japan 20 moves and US 16 in `src/lib/catalogue/` and `src/data/catalogue/`; nothing calls it until households have a profile.
- **A normal user's first week (D47).** "Start with my numbers" on the landing and "Start over with my numbers" in Settings: the setup form creates a blank demo household under the demo cookie through `createHousehold` (the same function onboarding calls), replacing and deleting the demo it supersedes; Reset means Ben's numbers. A household with nothing to forecast reads "Add your rent, your bills and the clients who pay you to see your next 30 days. Bank balance ¥120,000."; with bills but no expected client payment the sentence drops "even if clients pay late". Home shows First steps (a bill, a client who pays you, a card charge) until all three exist, every demo household says it is fictional with a link to start blank, empty panels say what to do next, and the + Add menu starts with Add a bill and Add a card charge. A Haiku newcomer run's findings (Stage 12) are fixed.
- **Yearly bills, amount changes and cancel-by dates (D48).** A bill is one-off, every month or every year (`bills.repeat_unit`, migration 0013); it can change to a new amount from a date (`next_amount_minor`, `next_amount_from`) and carry a `cancel_by` date. `repeat.ts` expands occurrences with the amount that applies to each, so `runway.ts` is unchanged; the split, the month view and To check read the occurrence amount. Coming up shows "Yearly" rows and a reminder-only row ("Cancel Fictional Cloud by Nov 20 or it renews at ¥12,000 on Dec 1"); the app never cancels or pays anything. The bill form's `ScheduleFields` (Repeat select, "Changes to … from …" and "Cancel by" behind More), the reader's review card and `add_bill` take the same fields; the snapshot carries them as optional fields at version 1.
- **Checks.** `tsc` and lint are clean; `npm run db:test` runs fifteen PGlite suites and passes, the last being the tenant-isolation suite (`npm run db:isolation-test`, 34 checks: two households, every exported function in `src/db` called across the boundary in both directions, a coverage guard that fails when a new export is neither tested nor listed as not applicable with a reason; removing one `household_id` filter from a write or a read makes it fail); the three HTTP suites (`scripts/frontend-check.mjs`) pass on dev against Tokyo with the export step and guard: `--run` 55 checks (the blank start, the empty sentence, First steps, the demo line, the yearly bill and the Privacy links included), `--extra` 13, `--guards` 17 (the cookie-less privacy page included) (people, settle and remove guards included; every suite run creates demo households, so they share Try it's 60-an-hour creation limit and `--extra` answers 429 at `create-fictional-session` once it is spent) (the Ask check accepts the 503 missing-setting error); the local Worker preview last passed before the export step was added. An independent security review of the build and its fixes (D12, D37) passed.
- **Submission files.** `submission/DEVPOST.md` and `submission/VIDEO-SCRIPT.md` are private current-state drafts. The code is MIT-licensed; the bundled Hanken Grotesk and Newsreader fonts carry SIL OFL 1.1 notices. Fictional samples (bills, a card-statement email, a 国保 slip, a US power bill) are in `economy-saver/samples/bills/`.

### Timings (latest measurement, Nov 3)

Warm single HTTP request through the complete response body on the same demo household, excluding browser rendering; a range is the spread over repeated runs. "First Home" is the first visit in a fresh session. Actions not listed were not timed on Tokyo.

| Action or page | `next dev` on Tokyo (s) | Local Worker on Tokyo (s) |
|---|---:|---:|
| Try it (create session) | 0.63–0.86 | 0.87 |
| First Home | 0.87 | 1.03–1.06 |
| Warm Home | 0.77–0.82 | 0.96–1.08 |
| Cards | 1.09 | |
| Clients | 1.13 | |
| Activity | 0.44–0.47 | 0.57–0.59 |
| Invoice review (read only) | 1.15 | |
| To check | 0.72–0.78 | |
| Confirm Hikari Denki | 0.94 | 1.04 |
| Settings (open) | 0.58–0.62 | 0.72–0.75 |
| Save Settings | | 1.10 |

## Open checklist

### A. Setup (owner)
- [ ] Join the hackathon on Devpost
- [ ] `npx wrangler login` from `economy-saver`
- [ ] Anthropic settings in `economy-saver/.env.local`: `ANTHROPIC_API_KEY`, `ANTHROPIC_TEXT_MODEL`, `ANTHROPIC_DOCUMENT_MODEL`, `ANTHROPIC_DAILY_READ_LIMIT`
- [ ] Forwarding settings in `.env.local`: `FORWARDING_DOMAIN` (the Cloudflare domain), `INBOUND_ADDRESS_KEY`, `INBOUND_WORKER_SECRET`
- [ ] Other settings the app reads and `.env.local` lacks: `MCP_TOKEN_KEY`, `CRON_SECRET` and `CRON_HOUSEHOLD_IDS` (the cron route refuses to run without both), and `PAYPAL_BALANCE_HOUSEHOLD_ID` (a non-demo household, so sign in first; a live PayPal import and merchant balance wait on it)
- [ ] Sign in once at `/login` to verify a real magic link and session refresh (V9)

### B. First deploy and the live PayPal loop (owner runs the deploy)
- [ ] Secrets set with `wrangler secret put`; the owner runs `npm run cf:deploy` (owner's OK, D22); the deployed URL is set as `APP_URL` and added to the Tokyo project's Authentication redirect URLs
- [ ] PayPal webhook registered on the deployed URL and `PAYPAL_WEBHOOK_ID` set; a sandbox invoice sent, paid and the sentence flipped end to end (V1)
- [ ] The three HTTP suites and [BROWSER-CHECKS.md](BROWSER-CHECKS.md) re-run on the Worker

### D. Early submission, Nov 5 (owner submits)
- [ ] Owner's OK to make the repository public (D22)
- [ ] Submitted for PayPal's early eligibility check

### E. The reader
- [ ] Verify a real Claude document read with the owner's Anthropic settings
- [ ] Owner enables Email Routing on their domain and verifies delivery through the live Worker

### F. MCP
- [ ] Issue, use and revoke an MCP token against the configured app and Supabase (needs `MCP_TOKEN_KEY`)

### H. Own AI key
- [ ] Verify Claude calls with the default key and with a household key

### I. Final
- [ ] Owner verifies hosted settings and live sandbox behaviour before public submission
- [ ] Final video 2:40–2:55 recorded on a Try it household (owner records)
- [ ] Submitted by the evening of Nov 12, Tokyo

If days run out, cut from the bottom: H first, then F. Never cut B or D.

### Build stages (D41–D45)
Built one stage at a time by a Sonnet subagent and reviewed by the lead; each stage ends with `tsc`, lint, `db:test` and a browser check at 375px and desktop, and its docs updated in the same turn. Owner verification (phases A, B, E) runs alongside and is not blocked by these.

**Stage 1. Card clarity on Home (D4, D25)**
- [x] Each card row on Home shows what is owed (unbilled plus the unpaid statement), limit left, the next statement amount and date, and Covered ✓ or the shortfall
- [x] Numbers come from `cycle`, `statementItems`, `roomOnCard` and `paybackFor` (assembled in `components/home/card-summary.ts`); no engine change

**Stage 2. Monthly recurring bills (D41)**
- [x] Migration: optional `repeat_day` on `bills` (`drizzle/0008_dry_wiccan.sql`, check 1–31)
- [x] `loadMoneyState` expands occurrences across the plan window (`src/lib/money/repeat.ts`); `runway.ts` unchanged
- [x] The bill form (now the Repeat select, D48) and the `add_bill` tool (now `repeat`) store the repeat day; To check and Coming up show "Every month"; a pending repeating bill expands only once confirmed
- [x] Seed: Ben's rent, phone and CloudBox subscription repeat; the numbers quoted in `submission/` still hold (card room ¥173,770 is asserted in `db-test` and `pots-test`; no document quotes it)
- [x] PGlite tests: expansion inside and past 30 days, the month-end clamp, a passed occurrence drops out and the next remains, pending versus confirmed, form and agent paths, household scope, card room and safe to spend count a repeating subscription (`doors-test` 24 checks, `db-test` sample check)
- [x] 0008 applied on Tokyo; a Try it household (and its reset) shows rent, phone and CloudBox as "Every month", and the bill form stores the repeat day

**Stage 3. Bank balance in one line (D42)**
- [x] Migration: `balance_updates` table (`drizzle/0009_uneven_callisto.sql`, applied on Tokyo)
- [x] One field on Home ("Bank balance ¥X · Update") writes the balance directly through `setBankBalance` with an event (old and new value); Settings' balance edit goes through the same function
- [x] Agent and MCP tool `update_bank_balance` makes a pending update in To check ("Bank balance → ¥X", "now ¥Y"); Confirm applies it through the same path
- [x] Tests for both paths and for household scope (`scripts/doors-test.ts`, `scripts/agent-test.ts`, `scripts/settings-test.ts`, `scripts/mcp-test.ts`)
- [x] Browser check at 375px and desktop: the Home line saved ¥100,000, the sentence flipped to fine, and Activity shows "Bank balance set to ¥100,000 (was ¥67,000)"; the agent's pending path is covered by tests until a live Claude call

**Stage 4. Small fixes from the browser checks**
- [x] New events on a demo household are stamped on its clock, so Activity sorts and dates match
- [x] Enter submits the Ask box (Shift+Enter for a newline)
- [x] Activity's date column does not wrap mid-word at 375px

**Stage 5. Pots and planning (D43)**
- [x] Migration: `pots` table (`drizzle/0010_ordinary_captain_flint.sql`: household, name, target, target date, saved, fill basis points, member, status; checks in SQL), all scoped by `household_id`; applied on Tokyo
- [x] Safe to spend subtracts money in pots (`availableCash` is the one starting cash in `runway.ts`)
- [x] Plan page (`/plan`) to add, edit and remove a pot; one line per pot on Home; a pending pot shows in To check as "New pot: …"
- [x] Tax pot: a client payment (webhook or marked paid) adds its percentage to the pot and records an event
- [x] Agent tool `plan_for` (read): monthly amount needed, date at the current pace, monthly room, with a summary built in code; `add_pot` (draft) puts a pot in To check
- [x] Tests for the maths, the fill rule and scope (`scripts/pots-test.ts`, `scripts/agent-test.ts`, `scripts/mcp-test.ts`)
- [x] Browser check at 375px and desktop: a Tax pot at 25% and a Car pot (¥1,200,000 by Mar 2027, "¥300,000 a month… more than what the next 30 days leave"); marking Beacon's $250 paid outside PayPal set aside ¥9,375 in Tax, Activity shows the line, and Home's safe to spend and lowest point both read ¥9,345 with the pots excluded

**Stage 6. One household schema, export and snapshot (D44)**
- [x] `HouseholdSnapshot` zod schema (version 1) in one module, with types the rest of the code can import
- [x] One function builds it from the database for one household, through the household-scoped data layer
- [x] Settings: "Export my data" downloads the JSON file (household events included), same-origin, `no-store`, never in a URL (a POST form to `/api/export`, 6 a minute; checked by hand on dev, see What exists now)
- [x] Agent and MCP read tool `household_snapshot` returns the snapshot without events
- [x] JSON Schema generated from the zod definition and committed, with a script to regenerate it and a test that fails on drift
- [x] Tests: the snapshot validates against its schema, money and dates are in the stated form, nothing secret is included, household scope

**Stage 7. Household split (D45)**
- [x] Migration: `members.share_bp`, `households.split_since`, `bills.paid_by_member_id` (same-household foreign key), `charges.shared`, and a `settlements` table (from member, to member, amount, currency, through date, settled at) in `drizzle/0011_gigantic_stone_men.sql`, applied on Tokyo; existing households with two or more members get equal shares
- [x] Settings → People: add a member, rename, set shares (must total 100%); adding the second member sets `split_since` and splits equally; each change records an event
- [x] Bill and charge forms show "Whose" (shared or a member) and "Paid by" for a shared bill, or "Shared" for a charge, only when the household has two or more members
- [x] Pure `lib/money/split.ts`: balance per member and the fewest transfers, counting past occurrences of monthly bills; `loadMoneyState` carries members, shares and the last settlement
- [x] Home line per transfer with Mark settled (`/api/settle`, same-origin, household guard, rate limit), an Activity event, and the balance back to zero
- [x] Agent and MCP: read tool `who_owes_whom`; `add_bill` takes shared and paid by, `log_charge` takes shared; pending items keep them through To check
- [x] The household snapshot (D44) carries shares, paid by, shared and settlements; `schema/household.v1.json` regenerated
- [x] Tests (`scripts/split-test.ts` in `db:test`, 27 checks): two and three members, uneven shares, a monthly bill's past occurrences, settle then a new item, a share change after settling, an item entered for the settlement day after settling, household scope; Ben alone shows nothing and every demo number is unchanged
- [x] Browser check at 375px and 1440px: Aki added at 40%, Card B made Aki's, a shared ¥30,000 bill paid by Ben and a shared ¥5,000 charge on Card B, both dated the day Aki joined → "Aki owes Ben ¥9,000"; Mark settled cleared it, Activity shows "Aki paid Ben ¥9,000", and the sentence stayed at ¥48,780 short (the new bill itself moved it from ¥18,780)

**Stage 8. UI/UX pass (D25)**
- [x] Lead review in the browser of every screen at 375px and 1440px, light and dark, on a Try it household with two members; findings below
- [x] Settings → People: adding a person or saving shares shows the new list and shares at once (today it says "Added" and needs a reload)
- [x] Settings → People: one row per person (name and share) with one Save people (`savePeople` renames and sets shares in one transaction)
- [x] Settings → Shared & personal bills: with two or more people, a shared bill with no payer reads "Household, not split" so it is clear it is left out of who owes whom
- [x] Activity wording: "settled through Nov 14" (not 2026-11-14); a card owner change says "Card B now belongs to Aki" (not "Household settings updated"); a shared charge says "Shared, paid by Aki (Card B)"
- [x] Cards page rows match Home's card summary (owed now, limit left, statement or so far with due date, Covered or short) and name the owner when there are two or more people
- [x] Clients: a client with nothing outstanding reads "Nothing outstanding", not "$0 · Outstanding"
- [x] Upload: the file picker matches the app's buttons (not the browser's plain "Choose File")
- [x] Options: the line under the heading is plain words ("The cheapest fix comes first. Payment dates are estimates."), not "the projected ¥0 financing-cost option"
- [x] Phone tap targets: Home's inline links (Other options, Update, All cards, All activity, Later in the month, card names) get a hit area of at least 44px tall without changing how they look
- [x] Settings at desktop width uses two columns of panels instead of one narrow column
- [x] Dev only: the Next dev "N" badge overlaps the microphone button and the sidebar's person (`devIndicators` moved to bottom-right; on a phone it can still cover the end of the Ask bar)
- [x] Browser check at 375px and 1440px, light and dark: adding Ren showed three rows at 33.34/33.33/33.33 at once; Cards match Home (Card A ¥86,450 owed, Card B Aki's); Beacon reads Nothing outstanding; hit areas 44–47px; a reset Ben-alone household shows no Shared costs and ¥18,780 short. The new Activity wording is covered by `split-test`, not seen on screen

**Stage 9. Fixes from the first full browser run (BROWSER-CHECKS.md)**
- [x] I6: a Reset button for Try it households (Settings → Account), posting to `/api/try/reset`; today nothing on screen calls it
- [x] F2: the card panel's "Room on this card" (what can still go on the card and be paid from cash on its due date, `roomOnCard`) reads as a second "limit left"; label it in those words next to the limit left
- [x] B5: with one person, the bill form's Whose select and the "· Shared" labels in Settings are hidden (everything is that person's)
- [x] Coming up: the row that carries the shortfall (Rent on the 27th) is never folded into "Later in the month"
- [x] L2: on a phone, buttons, inputs, selects, summary rows, back links, the top bar's Add and "Money", Upload's "To check" and the Options reference links reach 44px (real height or a `::after` hit area); desktop sizes unchanged
- [x] J1: a refused upload (wrong type or too big) stays in the app with the message, not a plain-text page at `/api/upload`
- [x] C6: amount fields say what they accept ("a whole number of yen, like 5000") in place of the browser's "Please match the requested format", and required fields are marked
- [x] Activity: renaming the household, adding a card and editing a card say what changed (today "Household settings updated")
- [x] Settings → People: Save people shows "Saved" and clears the earlier "Added…" line
- [x] Clients at 375px: "Nothing outstanding" never breaks mid-word beside a long name
- [x] Card and client rows have an accessible name (the link reads as the card or client)
- [x] Options at desktop width keeps text to a readable line length (about 70 characters)
- [x] `/api/events`: find why the feed is sometimes fetched 2–8 times at once with the same cursor, and fetch once
- [x] A pending bill (Hikari before Confirm) is marked "waiting in To check" in Settings → Shared & personal bills
- [x] F2 follow-up: the card room label also says the date it covers through (`roomOnCard`'s `through`): a later due date on any card stretches the plan window, so every card's room can drop when one card changes
- [x] With one person, Settings → Cards hides "Card belongs to" (as B5 does for bills)
- [x] Settings → Add a card clears its fields after a save
- [x] Browser check of every box above with BROWSER-CHECKS.md at 375px and 1440px (light, and dark for Settings, Upload and Cards) by two Sonnet runs: Card A reads "Limit left ¥413,550" and "Can still go on this card and leave every bill through Dec 26 covered ¥173,770"; Reset, Keep and every number match

**Stage 10. Categories and the business share (D46)**
- [x] Migration `drizzle/0012_*.sql`, hand-edited: `bills.category` mapped from the free text to keys (Housing → housing, Phone → phone_internet, Subscriptions → subscriptions, "Utilities · Electricity" → utilities, anything else → other) under a check constraint; `charges.category` (key, not null, default other, same constraint); `bills.business_bp` and `charges.business_bp` (integer, not null, default 0, 0–10000); applied on Tokyo dev (`drizzle/0012_small_ben_parker.sql`)
- [x] `src/lib/money/categories.ts` (keys, labels, order) and pure `src/lib/money/categorise.ts` (keyword table → `{ category, sure }`, covering the sample billers and merchants and common international names; unknown → other, not sure)
- [x] Pure `src/lib/money/month.ts`: `monthByCategory` for the household's current calendar month: confirmed bills (monthly ones once, at their occurrence in the month) and confirmed charges dated in the month, home currency, per category total with business and personal parts (business = round(amount × bp / 10000), personal = the rest, so they add up), the items under each; pending rows, statements and October charges excluded
- [x] Forms: every place a bill or charge is typed in (the Add form on Home and on To check, and the reader's review in To check; Cards has no form) gets a Category select pre-filled by the table when it is sure, and a Business share control (Personal / Business / Mixed with a percent through `PercentInput`); the To check row shows the proposed category and share; a wrong key is refused with a clear message
- [x] Plan → Where the month goes: one row per category with the month's total and the business and personal parts, the items under each (biller or merchant, date, amount); the business total for the month in one line at the top; Ben's demo on Nov 14 shows Housing ¥82,000 (30% business), Phone & internet ¥4,800 (50%), Subscriptions ¥1,980 (business), Business tools ¥3,850, Food ¥10,700, Other ¥48,900, and Utilities ¥11,220 (30%) after Hikari Denki is confirmed; every runway number unchanged
- [x] Sample data and seed: a category and share on every bill and charge in `src/lib/sample/ben.ts`
- [x] Agent and MCP: `add_bill` and `log_charge` take `category` (the key list in the description) and `business_bp`; read tool `month_by_category`; pending items keep both through To check
- [x] The household snapshot (D44) carries `category` on charges and `businessBp` on bills and charges; `schema/household.v1.json` regenerated
- [x] Tests (`scripts/category-test.ts` in `db:test`): the keyword table on every sample name and on unknown names, month maths with mixed shares adding up, monthly bills once, pending and last month excluded, the migration mapping of the four old values, a bad key refused, household scope; `frontend-check.mjs --run` gains a bad-category 400 (it needs a session, which `--guards` does not send)
- [x] BROWSER-CHECKS.md: section M (categories and the month view) with the numbers above; C2 and C4 updated for the new fields; AGENTS.md, ARCHITECTURE.md and README updated to thirteen migrations and thirteen suites
- [x] Browser check at 375px and 1440px, light and dark, by a Sonnet run on a fresh household: M1 to M5 and D1 pass with the numbers in BROWSER-CHECKS.md section M; every runway number unchanged until Hikari Denki is confirmed; category rows 46–83px tall at 375px, share choices and form controls 44px; nothing scrolls sideways; no console errors on Plan, To check or Home

**Stage 11. Fixes from the Chrome run and the page crawl (Nov 4)**
A Sonnet run in the owner's Chrome (sections A–M at 1280px and at 375px through an iframe, dark only because the OS is dark) passed every check except B5 and C6; a Haiku crawl of all 35 pages at four settings in the built-in pane found no sideways scroll, no tap target under 40px and no broken link, and its two console errors did not reproduce in a fresh tab. The fixes, most severe first:
- [x] Changing a card's closing day drops charges from what is owed: with Card A's closing day moved from 31 to 10, the Nov 4 and Nov 9 charges (¥22,050) count in no statement, so owed now falls from ¥86,450 to ¥64,400. Cause: `runway.ts` treats every charge on or before `closingBefore(card, today)` as already in a stored statement. Fix: charges after the latest stored statement's `closedOn` belong to the cycle they close in; a closed cycle with no stored statement becomes a computed statement due on `dueDateFor`; a test in `db:test` changes the closing day and checks owed now and the next statement
- [x] A refused form shows a bare text page (`/api/bills`, `/api/invoices/draft`, `/api/pots`): an amount of 0, a pot share above 100%, a biller or merchant name over 160 characters. Every form that posts to a route shows the route's message inline next to the form and keeps what was typed, the way upload already does; text inputs carry the `maxLength` their zod limit has
- [x] Limits: an amount above ¥100,000,000 (or $1,000,000) and a due or charge date more than two years from today are refused with a clear message; the Activity line for a bill names its due date
- [x] One "Short by …" per short day, on that day's last row (the other rows that day show neither it nor the Covered tick): after Hikari Denki is confirmed, both it and Rent on Nov 27 read "Short by ¥30,000 if clients pay late"
- [x] Remove a bill or a card charge (with an in-page "Remove …?" confirm and an Activity event); a mistyped item otherwise stays until Reset
- [x] Ben alone (B5): Settings shows no "Card belongs to" select and the bills panel heading drops "Shared &"; the "Add a partner or housemate" line stays as the way to add one
- [x] Yen and dollar inputs accept thousands separators ("1,000", "1,000.50")
- [x] Opening a panel moves focus into it: the bank balance Update field, the Ask box
- [x] Phone tap targets (L2): the client links in the sentence and in Coming up, the "Later in the month" summary, the Settings "Allow invoice drafts" checkbox reach 44px through padding or the `::after` hit area
- [x] Activity's Type column says what happened in words ("Invoice paid outside PayPal", "Clear for 30 days", "Short", "Settings changed", "Waiting in To check") instead of the internal kind
- [x] Re-run in the owner's Chrome at 1280px and 375px (an iframe; dark only, the OS is dark), Nov 4: every fix above passes, B5 and C6 now pass, and the regression pass over the expected numbers, C1–C8, D1, E1–E3, F1–F4, G1–G3, H1–H5, H7, I1, I2, I4, I6, J1, K0–K2 and M1–M4 passed with no console errors. Four follow-ups from that run are fixed and passed a second Chrome check: an earlier refusal message clears when a field is edited, Escape closes the bank balance form and returns focus to it, the Bill and Card charge tabs keep their own fields, and a refusal message scrolls into view above the phone's Ask bar. Left as it is: after a closing-day change the card panel's "Next statement" stays the earliest one (the computed ¥22,050 statement falls due Dec 26, outside the 30-day window, and owed now and limit left are right)

Looked at and left as they are: Options links to the rate references behind "Reference & assumptions" (D7: the source behind a tap; the text names no product); "FORWARDING_DOMAIN is not set" in Settings (rule 10: a missing setting is named); the bell keeps an unread notice after its bill is confirmed (read state is the user's); a refused AI key clears its field (nothing secret stays in the page); slow first loads on dev.

**Stage 12. A normal user's first week (D47, Nov 4)**
Every check so far ran on the Try it household, which arrives full. A person who starts with their own numbers sees an empty app, and nobody has looked at it. Sign-up stays deferred (owner, Nov 4), so a blank demo is how a person, a tester and the suites reach that app now. Built with Sonnet; a Haiku newcomer test follows.
- [x] Start blank: the landing offers "Start with my numbers" beside Try it, and Settings "Start over with my numbers" beside Reset: the setup form (name, time zone, currency, bank balance, one card) creates a demo household under the same cookie through the one household-creation function onboarding also calls (`createHousehold`, D39), with no Ben data; it replaces and deletes an existing demo household in the same transaction, never a non-demo one; rate-limited like Try it; sign-in upgrades it later the same way (the upgrade-demo cookie)
- [x] The empty sentence: a household with nothing to forecast (no confirmed bills, no card charges, no invoices) reads "Add your rent, your bills and the clients who pay you to see your next 30 days" with the bank balance as the emphasis, never "You're fine for the next 30 days"; `composeSentence` is unchanged, `homeSentence` decides; tested in the doors suite
- [x] First steps on Home: a panel above To check with three steps (a bill, a client who pays you, a card charge), each ticked as it becomes true and linking to where it is done; it disappears once all three are ticked, so the Try it household never shows it and every demo number is unchanged
- [x] Empty panels say what to do next ("Nothing due yet. Add your rent ›") instead of only what is missing
- [x] `--run` steps: Start blank, the empty sentence and the three open steps, add a bill, the sentence and the steps change, a second Start replaces the demo; BROWSER-CHECKS.md section N (Start blank) with the expected text
- [x] Haiku newcomer test in Chrome at 1280px and 375px: told only "you are a freelancer paid through PayPal; try this app", starting blank; every confusion recorded here, fixed or left with a reason. Run Nov 4 (Chrome had a Try it cookie, so it landed on Ben's numbers first). Stopped it: nothing on Home said the household was a demo and the way out was a link at the bottom of Settings (fixed: every demo household shows "A fictional household that lives in this browser. Start with my numbers ›" under the sentence); the Ask bar looks like a field but is a button, typing did nothing (fixed: a typed character opens the box with that character in it, and the bar ends in an "Ask" label). Slowed it, all fixed: "even if clients pay late" with no client or invoice (the sentence drops the clause and Plan says "No client payments are expected in the next 30 days, so the plan counts your bank balance only" when none is expected); the + Add menu lacked Add a bill and Add a card charge; a new client's panel offered no next step ("New invoice for this client ›", the client preselected); closing day, payment day, the repeat checkbox and the ✓ marks had no explanation (hints and titles); Plan read "Business ¥0 of ¥115,000" ("All personal this month"); the Start form's balance had no currency sign and the name was silently the household name; "Amount (USD)" on the invoice form was unexplained (invoices are always in US dollars); Reset and Start over sat side by side with no difference stated; "ANTHROPIC_TEXT_MODEL is not set" shown raw ("Ask isn't set up on this server yet (…)"). Phone: the floating Ask bar covered the bill form's Category and Add button (one `--ask-bar-clearance` token pads the page and the status scroll margin). Left: the dev-only "N" badge (Next's); the one PayPal action is invisible on an empty household until a client and an invoice exist (by design). Liked: the one-sentence answer, numbers moving correctly after rent and a card charge, Activity in plain words, the calm look

**Stage 13. Bills that repeat yearly, change amount, or must be cancelled by a date (D48)**
The research's one buildable stroke: subscriptions, insurance, domains, rent increases, rate resets and rolled-over trials are all one dated bill with a repeat unit, a next amount and a date to act by. Built with Sonnet after Stage 12.
- [x] Schema and migration 0013 (`drizzle/0013_loose_doctor_faustus.sql`, applied on Tokyo dev; existing monthly rows backfilled to `repeat_unit = 'month'`): `bills.repeat_unit` (`month` or `year`; null is one-off; `repeat_day` keeps the day for monthly), `next_amount_minor` with `next_amount_from`, and `cancel_by`; the snapshot carries them as optional nullable fields, version 1 unchanged (a v1 document written before them still validates)
- [x] Engine: `repeat.ts` expands a yearly bill on the same month and day each year (Feb 29 becomes the 28th); an occurrence on or after `next_amount_from` uses `next_amount_minor`; `runway.ts` is unchanged; `monthByCategory` counts the occurrence amount
- [x] Coming up and Activity: a yearly row says "yearly"; a cancel-by date is its own dated row ("Cancel Fictional Cloud by Nov 20 or it renews at ¥12,000 on Dec 1"), information only: the app never cancels, moves or pays anything
- [x] Forms and tools: Add bill gets a repeat select (one-off, every month, every year), "changes to … from …" and "cancel by"; the reader's review card and `add_bill` take the same fields; the split and the month view read the occurrence amount
- [x] Tests (doors 39, split 28, category 18, snapshot 14, agent 18, reader; isolation coverage 69 covered / 31 not applicable of 100 exports), four `--run` steps on a blank household (a yearly bill with a cancel-by, the Coming up rows, Activity, the month view) and the refusals as guard steps, BROWSER-CHECKS.md section O, README and ARCHITECTURE. Rules as built: a next amount needs a repeat and a date after the due date; `cancel_by` must fall before the next occurrence and does not roll forward each year; a one-off's row reads "or ¥X is charged on …". Checked in the built-in browser at desktop and 375px: "Nov 20 Cancel Fictional Cloud by Nov 20 or it renews at ¥12,000 on Dec 1 · Subscriptions · reminder only" then "Dec 1 Fictional Cloud · Yearly · ¥12,000 ✓"

**After the stages**, each with its evidence in [research/users/money-chores-worldwide.md](research/users/money-chores-worldwide.md): held PayPal money shown as expected on a date, never as cash (Balances API: available vs withheld); each client's pay run, so a reminder lands before it; one warning the day before a known debit when the forecast is short (after the deploy); the dispute clock from the Disputes API; a recurring remittance with its fee; the agent proposing categories from unknown names (needs the AI settings); renaming or merging categories in Settings; per-country calendars (pay cycles, renewal seasons, festival and government dates) as content tables, never code. Also: income other than invoices (D28), the catalogue as an agent tool once households have a profile (D6), moving money between pots.

### Functionality stage (D38: after foundation, before UI/UX)
One database function per job, called by both the form and the agent tool (D39). The doors and the agent are built (see "What exists now"); what is left:
- [ ] FN1: run one live PayPal import (waits on `PAYPAL_BALANCE_HOUSEHOLD_ID`)
- [ ] FN2: verify one real ask (waits on the Anthropic settings in phase A), on dev and then on the Worker

### Browser checks (D38)
The hand checks in a real browser are [BROWSER-CHECKS.md](BROWSER-CHECKS.md): what to do on each screen and the number it should show. Run them on dev first and again on the Worker after the first deploy; failures become boxes here.
- [x] Full run on dev at 375px and 1440px, light and dark (sections A–L, skipping the "Needs …" checks), by two Sonnet runs on fresh Try it households: every money number matched; the failures are Stage 9 below
- [x] Run in the owner's real Chrome (Claude in Chrome) and a crawl of every page at four settings, Nov 4: findings are Stage 11
- [ ] Full run on the Worker after the first deploy
- [ ] Voice (K5) by the owner in their own Chrome or Safari with a microphone, in English and Japanese (the desktop app's browser pane blocks the microphone)
- [ ] The "Needs …" checks once their settings exist: magic link (A5), agent drafts (D2, K3, K4), PayPal send and webhook (E4), MCP (I5), delete my data (I7), the reader (J2, J3)
- [ ] Measured times go in the timings table above: Try it to Home ≤ 1.5 s (A2), a To check row ≤ 30 s after upload (J2), Sent in Activity ≤ 2 s (E4), an answer ≤ 8 s (K3)

### UI/UX stage (D38: after functionality)
Findings from browser checks are in Build stage 8.

### J. Foundation and security hardening (last stage, D38)
- [x] Tenant-isolation test in `db:test`: two seeded households, every exported function in `src/db` (reads, writes and removes, both directions, plus the agent tools), zero rows cross over (`scripts/isolation-test.ts`)
- [x] Demo sweeper in the daily job (D49, `sweepDemoHouseholds` and the shared `deleteDemoHousehold` in `src/db/demo.ts`, run in `/api/cron` before the `CRON_HOUSEHOLD_IDS` check and reported as `swept` and `failed`; `npm run db:sweep-test`, 7 checks, including every household foreign key cascading): delete demo households whose creation and latest event are both over seven days old, up to 200 a run, with their AI key and Storage objects through the Reset deletion; never a non-demo household; Home's demo line says how long a demo lives
- [ ] App-wide daily AI budget (one global `request_buckets` row) in addition to the per-household cap
- [ ] Per-IP limits on `/api/try` and `/api/auth/link` (Cloudflare rate-limiting rule or an IP-keyed bucket)
- [ ] Count Storage bytes per household and cap them (each upload is already capped at 6 MiB)
- [ ] Operator log: one structured line per request (`cf-ray`, route, household UUID, outcome code, duration), no content; `cf-ray` shown on error pages
- [ ] Retention for raw documents in the bucket (N days after confirmation, plus per-document delete) and `webhook_deliveries.payload` trimmed to what the app uses
- [ ] Migration-order rule in AGENTS.md (expand before use, contract after; the running Worker must keep working)
- [ ] Manual encrypted database dump before demo day (owner)
- [x] Privacy page `/privacy` (D49; BROWSER-CHECKS section P; checked against the code: webhook deliveries keep only the event id, type, invoice id and time, MCP tokens are stored as SHA-256 hashes, the sign-in link is Supabase's): what is stored, where (Tokyo), who processes it (Supabase, Cloudflare, Anthropic in the US, PayPal), how long, how to delete; one line on clients' data and on Try it data living behind a cookie; linked from the landing, `/start`, Settings and the account page; every statement checked against the code
- [ ] Later: app database role with RLS policies on `app.household_id`; separate production Supabase project; hourly cron by local time; secret rotation procedure; Pro-plan backups

## Owner's tasks

Phase A, the OK before the first deploy and before the repo goes public, answers to the open questions in DECISIONS.md (O2, O5), recording the final video, and submitting.
