# Personal Economy Saver: plan

**Submit the evening of Nov 12, Tokyo** (closes Nov 13 05:00 Tokyo). The one other date is the early Devpost version by Nov 5 (D30). What the product is and why: [DECISIONS.md](DECISIONS.md) (D2, D3). The hard rules: [HANDOFF.md](HANDOFF.md). Tick a box the moment it is true. Owner = Ben; Codex = implementation and verification.

## What exists now

- **Foundation (D31–D37).** The Supabase project in Tokyo has all eleven migrations applied (20 tables), one fictional Ben household seeded, Vault create/read/delete passing, the private Storage bucket `household-documents` verified (a test object was refused to the publishable key and its public URL), and no readable rows in `households` for the publishable key. The app builds as a Cloudflare Worker through OpenNext (2,652 KiB gzip, limit 3 MiB) with the daily Cron Trigger; the local Worker preview renders the Tokyo household.
- **Screens (D25).** Shell with sidebar, top bar (Ask, bell, Add) and phone layout; Home (sentence, safe to spend, runway, To check, Cards, Coming up); To check; Activity; Cards and Clients with a right-hand panel; invoice review; Upload; Options; Settings. Checked at 375px and 1440px, light and dark. The five-tab screen, persona switch and sample reducer are gone.
- **Sessions (D34).** Try it makes an anonymous fictional household with a protected cookie and a demo-only reset, anchored at Nov 14, 2026. Magic-link routes, session refresh, scoped membership and onboarding are implemented and tested on PGlite; a real magic link is not verified yet.
- **PayPal (D12–D15, D37).** Sandbox guard, REST client, toolkit split (the agent drafts, the approve route sends), invoice review and approve/send/remind, verified webhook persisted in Postgres, scoped refresh with a five-minute cooldown, `npm run smoke`. A real sandbox send and paid webhook have not run on a deployed URL.
- **Typed-in doors (FN1, D39).** Add a client, add a bill, log a card charge and mark an invoice paid outside PayPal work end to end in the browser at 375px and desktop. `npm run db:doors-test` has 20 checks. PayPal history import (`/api/paypal/import`, `npm run db:import-test`, 6 checks) is built and tested, not run live.
- **In-app agent and MCP (FN2, D40, D27).** `src/lib/agent/tools.ts` is the one catalogue: read tools `where_am_i`, `whats_due`, `can_i_spend`, `list_clients_and_cards`, `timeline`, `options_when_short`, `list_invoices`; read tools `where_am_i`, `whats_due`, `can_i_spend`, `list_clients_and_cards`, `timeline`, `options_when_short`, `list_invoices`, `plan_for`; draft tools `draft_invoice`, `add_bill`, `log_charge`, `update_bank_balance`, `add_pot` (all but the first make a pending row in To check). `/api/ask` and the MCP server use it. `scripts/agent-test.ts` has 15 checks with a fake transport; no live Claude call has run. Without the Anthropic settings the Ask panel shows "ANTHROPIC_TEXT_MODEL is not set".
- **Pots and planning (D43).** `/plan` lists pots (name, saved, target and date, fill percentage, and for a goal the monthly amount needed with whether the next 30 days leave room) and adds, edits and removes them; Home shows one line per pot under the bank balance. Money in confirmed pots is taken off the cash the runway starts from (`availableCash` in `runway.ts`), so safe to spend, the low point, card room, the sentence and the options agree; Ben has no pots, so every demo number is unchanged. A client payment (verified webhook, or marked paid outside PayPal) adds each pot's percentage to it and records an event. `plan.ts` holds the maths (`monthlyRoom`, `planFor`); the agent's `plan_for` quotes a summary built in code and `add_pot` makes a pending pot in To check. `npm run db:pots-test` has 20 checks.
- **Reader (D10, D36).** Photo/PDF upload and forwarded mail go to private Storage; Claude reads in the background; To check shows the reading; confirmation creates a bill or charge; corrections become rules; file cleanup on reset, upgrade and deletion. The Worker email handler and `/api/inbound` are implemented. Live Claude and Email Routing are not verified.
- **Options (D7) and household (D28).** Options ranks total extra cost with the Japan references in DECISIONS; Settings edits bank balance, member names, cards and bill ownership.
- **Own AI key (D33).** Settings key field, Vault create/update/delete, and atomic daily default-key quota reservation by the household's local date are implemented and tested; no live call yet.
- **Catalogue (D6).** Japan 20 moves and US 16 in `src/lib/catalogue/` and `src/data/catalogue/`; nothing calls it until households have a profile.
- **Checks.** `tsc` and lint are clean; `npm run db:test` runs ten PGlite suites and passes; the three HTTP suites pass on dev and on the local Worker preview against Tokyo (`--run` 22, `--extra` 12, `--guards` 11; the Ask check in `--run` accepts the 503 missing-setting error). An independent security review of the build and its fixes (D12, D37) passed.
- **Submission files.** `submission/DEVPOST.md` and `submission/VIDEO-SCRIPT.md` are private current-state drafts. The code is MIT-licensed; the bundled Hanken Grotesk and Newsreader fonts carry SIL OFL 1.1 notices. Fictional samples (bills, a card-statement email, a 国保 slip, a US power bill) are in `economy-saver/samples/bills/`.

### Timings (Nov 3)

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
- [ ] Other settings the app reads and `.env.local` lacks: `MCP_TOKEN_KEY`, `CRON_SECRET` and `CRON_HOUSEHOLD_IDS` (the cron route refuses to run without both; `CRON_SECRET` is not yet in `.env.example`), and `PAYPAL_BALANCE_HOUSEHOLD_ID` (a non-demo household, so sign in first; a live PayPal import and merchant balance wait on it)
- [ ] Sign in once at `/login` to verify a real magic link and session refresh (V9)

### B. First deploy and the live PayPal loop (owner runs the deploy)
- [ ] Secrets set with `wrangler secret put`; the owner runs `npm run cf:deploy` (owner's OK, D22); the deployed URL is set as `APP_URL` and added to the Tokyo project's Authentication redirect URLs
- [ ] PayPal webhook registered on the deployed URL and `PAYPAL_WEBHOOK_ID` set; a sandbox invoice sent, paid and the sentence flipped end to end (V1)
- [ ] The three HTTP suites and the user journeys below re-run on the Worker

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

### Build stages (D41–D43)
Built one stage at a time by a Sonnet subagent and reviewed by the lead; each stage ends with `tsc`, lint, `db:test` and a browser check at 375px and desktop, and its docs updated in the same turn. Owner verification (phases A, B, E) runs alongside and is not blocked by these.

**Stage 1. Card clarity on Home (D4, D25)**
- [x] Each card row on Home shows what is owed (unbilled plus the unpaid statement), limit left, the next statement amount and date, and Covered ✓ or the shortfall
- [x] Numbers come from `cycle`, `statementItems`, `roomOnCard` and `paybackFor` (assembled in `components/home/card-summary.ts`); no engine change

**Stage 2. Monthly recurring bills (D41)**
- [x] Migration: optional `repeat_day` on `bills` (`drizzle/0008_dry_wiccan.sql`, check 1–31)
- [x] `loadMoneyState` expands occurrences across the plan window (`src/lib/money/repeat.ts`); `runway.ts` unchanged
- [x] The bill form ("Every month" checkbox) and the `add_bill` tool (`monthly`) store the repeat day; To check and Coming up show "every month"; a pending repeating bill expands only once confirmed
- [x] Seed: Ben's rent, phone and CloudBox subscription repeat; the numbers quoted in `submission/` are unchanged (only each card's room moves, ¥180,550 to ¥173,770, and no document quotes it)
- [x] PGlite tests: expansion inside and past 30 days, the month-end clamp, a passed occurrence drops out and the next remains, pending versus confirmed, form and agent paths, household scope, card room and safe to spend count a repeating subscription (`doors-test` 20 checks, `db-test` sample check)
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

**After the stages:** household split and settle-up, income other than invoices (D28), the catalogue as an agent tool once households have a profile (D6), moving money between pots.

### Functionality stage (D38: after foundation, before UI/UX)
One database function per job, called by both the form and the agent tool (D39). The doors and the agent are built (see "What exists now"); what is left:
- [ ] FN1: run one live PayPal import (waits on `PAYPAL_BALANCE_HOUSEHOLD_ID`)
- [ ] FN2: verify one real ask (waits on the Anthropic settings in phase A), on dev and then on the Worker

### User journeys (D38)
Each is run on a fresh Try it household at phone (375px) and desktop width, on dev first and again on the Worker after the first deploy. Measured times go in the timings table above.
- [ ] U1 Try it → Home sentence with a date and a client name, ≤ 1.5 s
- [ ] U2 Upload `kokuho-2026-nouhusho.png` → "Document ready to read" at once → To check row ≤ 30 s → confirm → safe to spend changes
- [ ] U3 Forward a mail with `kokuho-2026-nouhusho.pdf` attached → same as U2 (needs Email Routing)
- [ ] U4 Say or type "I paid ¥3,800 at the noodle place on Card B" → pending charge in To check → confirm → Card B's room changes (the typed charge form is verified; the Ask path waits on the Anthropic settings)
- [x] U5 Add a bill by hand → appears in Coming up and in the runway (a ¥5,000 bill moved the shortfall from ¥18,780 to ¥23,780; 375px and desktop)
- [ ] U6 New invoice → review → Approve → "Sent" in Activity ≤ 2 s → (live) webhook → "Paid" and the sentence flips
- [ ] U7 (waits on the Anthropic settings) Ask "can I afford ¥4,000 tonight", "what's due", "where am I", and one free-form question → one or two sentences each, numbers equal to Home's, ≤ 8 s
- [ ] U8 (waits on `MCP_TOKEN_KEY`) Settings → make an MCP token → `where_am_i` and `draft_invoice` from an MCP client → the draft opens in the app
- [ ] U9 Sign in by magic link → onboarding (name, timezone, bank balance, one card) → own sentence; a Try it household is upgraded, not lost
- [ ] U10 Delete my data → everything gone, including the Vault key and Storage objects; Reset on a Try it household restores Ben

### UI/UX stage (D38: after functionality)
Findings from browser checks of the doors and the agent; the design review and screens join this list.
- [ ] Dev only: the Next dev "N" badge overlaps the microphone button

### J. Foundation and security hardening (last stage, D38)
- [ ] Tenant-isolation test in `db:test`: two seeded households, every read function in `src/db`, zero rows cross over
- [ ] Demo sweeper in the daily job: delete demo households older than N days and their Storage objects through `document-cleanup`
- [ ] App-wide daily AI budget (one global `request_buckets` row) in addition to the per-household cap
- [ ] Per-IP limits on `/api/try` and `/api/auth/link` (Cloudflare rate-limiting rule or an IP-keyed bucket)
- [ ] Count Storage bytes per household and cap them (each upload is already capped at 6 MiB)
- [ ] Operator log: one structured line per request (`cf-ray`, route, household UUID, outcome code, duration), no content; `cf-ray` shown on error pages
- [ ] Retention for raw documents in the bucket (N days after confirmation, plus per-document delete) and `webhook_deliveries.payload` trimmed to what the app uses
- [ ] Migration-order rule in HANDOFF (expand before use, contract after; the running Worker must keep working)
- [ ] Manual encrypted database dump before demo day (owner)
- [ ] Privacy page: what is stored, where (Tokyo), who processes it (Supabase, Cloudflare, Anthropic in the US, PayPal), how long, how to delete; one line on clients' data and on Try it data living behind a cookie
- [ ] Export my data as JSON
- [ ] After Nov 12: app database role with RLS policies on `app.household_id`; separate production Supabase project; hourly cron by local time; secret rotation procedure; Pro-plan backups

## Owner's tasks

Phase A, the OK before the first deploy and before the repo goes public, answers to the open questions in DECISIONS.md (O2, O5), recording the final video, and submitting.
