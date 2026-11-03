# Personal Economy Saver: plan

**Submit the evening of Nov 12, Tokyo** (closes Nov 13 05:00 Tokyo). The one other date is the early Devpost version by Nov 5 (D30). What the product is and why: [DECISIONS.md](DECISIONS.md) (D2, D3). The hard rules: [HANDOFF.md](HANDOFF.md). Tick a box the moment it is true. Owner = Ben; Codex = implementation and verification.

## What exists now

- **Foundation (D31–D37).** The Supabase project in Tokyo has all eight migrations applied (18 tables), one fictional Ben household seeded, Vault create/read/delete passing, the private Storage bucket `household-documents` verified (a test object was refused to the publishable key and its public URL), and no readable rows in `households` for the publishable key. The app builds as a Cloudflare Worker through OpenNext (2,652 KiB gzip, limit 3 MiB) with the daily Cron Trigger; the local Worker preview renders the Tokyo household.
- **Screens (D25).** Shell with sidebar, top bar (Ask, bell, Add) and phone layout; Home (sentence, safe to spend, runway, To check, Cards, Coming up); To check; Activity; Cards and Clients with a right-hand panel; invoice review; Upload; Options; Settings. Checked at 375px and 1440px, light and dark. The five-tab screen, persona switch and sample reducer are gone.
- **Sessions (D34).** Try it makes an anonymous fictional household with a protected cookie and a demo-only reset, anchored at Nov 14, 2026. Magic-link routes, session refresh, scoped membership and onboarding are implemented and tested on PGlite; a real magic link is not verified yet.
- **PayPal (D12–D15, D37).** Sandbox guard, REST client, toolkit split (the agent drafts, the approve route sends), invoice review and approve/send/remind, verified webhook persisted in Postgres, scoped refresh with a five-minute cooldown, `npm run smoke`. A real sandbox send and paid webhook have not run on a deployed URL.
- **Typed-in doors (FN1, D39).** Add a client, add a bill, log a card charge and mark an invoice paid outside PayPal work end to end in the browser at 375px and desktop. `npm run db:doors-test` has 13 checks. PayPal history import (`/api/paypal/import`, `npm run db:import-test`, 6 checks) is built and tested, not run live.
- **In-app agent and MCP (FN2, D40, D27).** `src/lib/agent/tools.ts` is the one catalogue: read tools `where_am_i`, `whats_due`, `can_i_spend`, `list_clients_and_cards`, `timeline`, `options_when_short`, `list_invoices`; draft tools `draft_invoice`, `add_bill`, `log_charge` (the last two make a pending row in To check). `/api/ask` and the MCP server use it. `scripts/agent-test.ts` has 13 checks with a fake transport; no live Claude call has run. Without the Anthropic settings the Ask panel shows "ANTHROPIC_TEXT_MODEL is not set".
- **Reader (D10, D36).** Photo/PDF upload and forwarded mail go to private Storage; Claude reads in the background; To check shows the reading; confirmation creates a bill or charge; corrections become rules; file cleanup on reset, upgrade and deletion. The Worker email handler and `/api/inbound` are implemented. Live Claude and Email Routing are not verified.
- **Options (D7) and household (D28).** Options ranks total extra cost with the Japan references in DECISIONS; Settings edits bank balance, member names, cards and bill ownership.
- **Own AI key (D33).** Settings key field, Vault create/update/delete, and atomic daily default-key quota reservation by the household's local date are implemented and tested; no live call yet.
- **Catalogue (D6).** Japan 20 moves and US 16 in `src/lib/catalogue/` and `src/data/catalogue/`; no screen, agent tool or MCP tool uses it yet.
- **Checks.** `tsc` and lint are clean; `npm run db:test` runs nine PGlite suites and passes; the three HTTP suites pass on dev and on the local Worker preview against Tokyo (`--run` 22, `--extra` 12, `--guards` 11; the Ask check in `--run` accepts the 503 missing-setting error). An independent security review of the build and its fixes (D12, D37) passed.
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
- [ ] Activity's date column wraps mid-word ("No v 3") at 375px (`.household-table` cells use `overflow-wrap: anywhere`)
- [ ] The demo household's clock is Nov 14 but new events are stamped with the real date (`events.occurred_at` defaults to `now()`), so fresh Activity rows sort below seeded ones and show a different date than "Paid Nov 14" on the invoice
- [ ] Return in the Ask textarea adds a newline rather than asking: decide whether Enter should submit
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

Phase A, the OK before the first deploy and before the repo goes public, answers to the open questions in DECISIONS.md (O1, O2, O5, O8), recording the final video, and submitting.
