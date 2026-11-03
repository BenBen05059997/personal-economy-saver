# Personal Economy Saver: plan

**Submit the evening of Nov 12, Tokyo** (closes Nov 13 05:00 Tokyo). That is the only date. Decisions: [DECISIONS.md](DECISIONS.md).

## What we are building

A daily money assistant for freelancers paid across borders, built on PayPal. It reads what arrives in the inbox (bills, card charges, receipts, client payments), shows where you stand today and over the next 30 days, reminds you what's due and whether it's covered, and gets your money in through PayPal when you approve.

It answers three questions with the user's real numbers:
1. **Where am I?** Cash, card spend and statements, bills, what's coming in.
2. **Can I proceed, or should I hold off?**
3. **If I use credit, how do I pay it back** from what's coming in?

## The daily loop

| Something happens | The app shows | The app can do |
|---|---|---|
| A bill arrives (email or photo) | What it is, when it's due, where it lands on the runway | Confirm it |
| A card charge arrives (at home or travelling) | Running total on that card, statement date, due date, covered or not | Remind before the due date |
| A client pays into PayPal | Balance updated, what's now covered, the tax share to set aside | Set it aside |
| A card statement arrives | The real total, the due date, pay in full from where | Remind; invoice first if short |
| The runway shows a shortfall | The cheapest way to cover it | Draft the invoice or reminder; you approve; PayPal sends; webhook confirms |
| A date is near | Only dates tied to his money | One action |

## Build order and checklist (agreed Nov 1)

Tick a box the moment it is true. Owner = Ben; Codex = implementation and verification.

### A. Setup, Nov 2 morning (owner, about 30 minutes)
- [ ] Join the hackathon on Devpost
- [x] Supabase project created in Tokyo (`ap-northeast-1`); both API keys accepted and the transaction pooler on port 6543 reachable using the settings in `economy-saver/.env.local`
- [ ] Create the private Storage bucket `household-documents` on the Tokyo project (the reader cannot store files without it)
- [ ] Tokyo project → Authentication → URL Configuration: Site URL and redirect URL `http://127.0.0.1:3123` (later the deployed URL)
- [ ] Pause or delete the old Frankfurt Supabase project
- [ ] `npx wrangler login` run from `economy-saver`
- [ ] Anthropic API key in `.env.local` (if not already)
- [ ] Tell Claude the domain on Cloudflare for the forwarding address (name only)

### B. Foundation live, Nov 2 (Claude; owner runs the deploy)
- [x] Schema, household-scoped data layer and fictional Ben seed tested locally (`npm run db:test`)
- [x] App builds and runs as a Worker locally, daily cron wired (`npm run cf:preview`); landing returns 200, missing DATABASE_URL on Try it returns 503, unsigned webhook returns 400
- [x] All eight migrations applied on the Tokyo project (`npm run db:migrate`), one fictional Ben household seeded (`npm run db:seed`), Vault create/read/delete verified (`npm run db:vault-check`), and the public key reads no rows from `households` (V7)
- [x] Worker bundle below 3 MiB gzip in the local dry run, with server credentials supplied by runtime bindings. The generated Worker and source map pass the credential scan
- [x] Next.js dev rendered fictional Ben’s ¥18,780 shortfall from the Tokyo household (V6)
- [x] Local Worker preview renders the Tokyo household (first Home 1.03 s)
- [x] Webhook events stored in Postgres instead of memory
- [ ] First deploy: secrets set with `wrangler secret put`, owner runs `npm run cf:deploy` (owner's OK, D22)
- [ ] PayPal webhook registered on the deployed URL; a sandbox invoice paid end to end (V1)

### C. The screen on real data, Nov 3–4 (Claude)
- [x] Try it routes, per-visitor demo cookie, household-scoped reset and origin checks (D34)
- [x] Verify two independent HTTP sessions against Supabase: resetting one invalidated its old cookie, created a fresh seeded household and preserved the other session’s runway
- [x] Verify reset in Chrome with two isolated session cookies (localhost and 127.0.0.1). The reset session showed ¥18,780 while the other retained its confirmed ¥30,000 shortfall.
- [x] Magic-link routes, secure session refresh, scoped membership and fresh-household onboarding implemented (D34); PGlite tests cover isolated upgrade and deletion
- [ ] Verify a real magic link and session refresh with the owner’s Supabase settings
- [x] Shell from the approved mockup (verified with a seeded test household at 375px and 1440px in light and dark): sidebar, top bar with ask field, bell and Add; phone layout (D25)
- [x] Home: the sentence, safe to spend, runway, To check, Cards and Coming up read the household’s rows; confirming Hikari moves the shortfall from ¥18,780 to ¥30,000 in the database test
- [x] Owner approves the phone and desktop Home design before tasks 6–7
- [x] Bell and Activity from `events`; Cards and Clients lists with the right-hand panel (D35)
- [x] Scoped PayPal refresh, verified receipt reconciliation and runway change notifications tested against a local provider boundary (D35, D37)
- [x] Invoice review, sandbox approve/send/remind route, scoped webhook balance update and retry tests with a simulated PayPal transport
- [ ] Verify a real sandbox send, signed paid webhook and resulting sentence in the live app (V1)
- [x] Old five-tab screen, persona switch and sample reducer removed; tracked `src/components/app/` files deleted and no source imports remain

#### Frontend acceptance checklist (local app with fictional household data)

1. [x] Open the landing page, leave it idle, then return focus. Check that the dev server stops compiling and the page stays in place.
2. [x] Click Try it twice quickly. Look for immediate progress feedback and verify only one request creates a demo.
3. [x] Time demo creation, Home and navigation. Verify a fresh demo does not repeatedly poll for fictional invoices.
4. [x] Confirm Hikari Denki on Home. Verify exactly one confirmation and that the shortfall moves from ¥18,780 to ¥30,000.
5. [x] Mark a notification read. Verify its badge clears and returning focus preserves the open page.
6. [x] Navigate to Cards, Clients, and Activity. Open an item and use Back.
7. [x] Check the loading state at desktop and 375px widths, including reduced motion, then use the phone navigation.
8. [x] Run TypeScript, lint and `npm run db:test` (all six suites). Close all browser windows opened for this test.
9. [x] Compare the navigation badge with the full To check list, including old and future charges, confirmed entries, pending readings and a second household. Check that Settings remains accessible without a dated FX rate while money screens still require it.
10. [x] Open Activity, Settings and Upload at desktop and 375px in Chrome. The private test window was closed afterward. Chrome timings are not re-measured on Tokyo; HTTP timings are in the tables below.
11. [x] On dev, open Upload, To check and Options, reject an empty upload, submit a fictional invoice draft twice, and verify its item, amount and single Activity event.
12. [x] Check the integration rejection paths (11 checks) on dev, including invalid email, the callback without a code, unsigned webhook and unauthenticated approval, upload, inbound, MCP, AI-key and cron requests.
13. [x] Re-run the three HTTP suites against the local Worker preview on Tokyo (`npm run cf:preview`): 22 + 12 + 11 checks passed, 0 failed. Hosted runs wait for the owner’s deployment.

#### Bugs cleared and remaining checks

- [x] **Dev server no longer recompiles an idle page.** OpenNext loads as a server dependency, which keeps its development tooling outside the Turbopack watch graph. The indicator remains enabled.
- [x] **Tab focus reloaded unchanged Home.** Focus now checks the event summary once and refreshes only on a change. Chrome kept an open Ask panel and its unsent question across a tab switch. Only sent invoices with a PayPal ID and queued or active document reads trigger polling.
- [x] **Try it gave no feedback while creating a household.** The button immediately shows progress and blocks repeated submission. Two taps in Chrome produced one creation request and its redirect. At 375px with reduced motion emulated, the disabled button appeared in 1 ms with no spinning animation. Pages use the same loading indicator while their actual data is pending.
- [x] **Settings shows its form.** Its workspace, preferences and tokens are read in one scoped transaction, with one statement per connection, so there are no competing reads. Chrome loaded Settings, rejected fractional yen, and saved a valid edit.
- [x] **Fresh demos performed redundant work.** Seed inserts now run in dependency order within one transaction. Home reuses its household row and runway lock, and checks an idle demo's PayPal state in one scoped query without claiming a refresh lease.
- [x] **Activity, Settings and Upload read only what navigation needs.** These pages read the household clock, owner, event feed and three scoped pending counts: 5 statements for the JPY demo. Warm timings on Tokyo are in the table below.
- [x] **Money and navigation regressions checked.** Hikari confirmation produced a single Activity event, including on retry. Card detail and Back, Clients, notification read, typed Ask, isolated reset, and loading at desktop and phone widths were exercised. Invoice review was read-only.
- [ ] **Hosted integration.** Magic-link delivery (needs the Tokyo Authentication URL Configuration), the private `household-documents` bucket, real sandbox invoice delivery/payment/webhook, live AI extraction and email forwarding still require their owner-managed steps. Those are separate from the local frontend checks.

**Action timings (Nov 3, `next dev` → Supabase Tokyo).** All 22 core checks passed. Each figure is a warm single elapsed HTTP request through the complete response body on the same demo household, excluding browser rendering; a range is the spread over repeated runs. An action returning a redirect and its destination page are separate rows. The first Home is the first visit in a fresh session, not a cold server start. Chrome separately verified rendered Home and Settings.

| Action or page | Dev on Tokyo (seconds) |
|---|---:|
| Create fictional session (Try it) | 0.63–0.86 |
| First Home in that session | 0.87 |
| Return to Home | 0.77–0.82 |
| Cards | 1.09 |
| Clients | 1.13 |
| Activity | 0.44–0.47 |
| Review seeded invoice (read only) | 1.15 |
| Read initial events | not re-measured on Tokyo |
| Mark notification read | not re-measured on Tokyo |
| Confirm Hikari | 0.94 |
| Retry Hikari confirmation | not re-measured on Tokyo |
| Home shows ¥30,000 | not re-measured on Tokyo |
| Verify one confirmation event | not re-measured on Tokyo |
| Ask where the household stands | not re-measured on Tokyo |
| Open Settings | 0.58–0.62 |
| Reject invalid Settings input | not re-measured on Tokyo |
| Save fictional household name | not re-measured on Tokyo |
| Reload saved Settings | not re-measured on Tokyo |
| Reset demo | not re-measured on Tokyo |
| Home shows ¥18,780 after reset | not re-measured on Tokyo |
| Reject expired session | not re-measured on Tokyo |

**Additional local checks (Nov 3).** All 12 workflow steps and 11 integration guards passed on dev against Tokyo. The draft stayed local on creation and retry, and produced one event. Of the workflow steps, only To check was timed on Tokyo; the guards measure rejection paths only and are not re-measured on Tokyo.

| Additional workflow | Dev on Tokyo (seconds) |
|---|---:|
| Create test session | 0.63–0.86 |
| Open Upload | not re-measured on Tokyo |
| Reject upload with no file | not re-measured on Tokyo |
| Open To check | 0.72–0.78 |
| Open Options | not re-measured on Tokyo |
| Read new invoice form | not re-measured on Tokyo |
| Save USD 12.34 draft | not re-measured on Tokyo |
| Retry the same draft | not re-measured on Tokyo |
| Verify exactly one draft event | not re-measured on Tokyo |
| Review saved item and amount | not re-measured on Tokyo |
| Reset test session | not re-measured on Tokyo |

From the app directory, run `node scripts/frontend-check.mjs --run http://127.0.0.1:3123` against the local dev server. Use `--extra` for Upload, To check, Options and the invoice draft workflow, or `--guards` for the integration boundaries. The same commands accept a loopback Worker URL, as used for the local Worker preview below. Output includes only step names, results and timings.

**Local Worker preview on Tokyo (Nov 3, `npm run cf:preview` at http://localhost:8787).** The three HTTP suites passed (22 + 12 + 11 checks, 0 failed). Hosted timings still require the owner’s deployment.

| Action or page | Local Worker on Tokyo (seconds) |
|---|---:|
| Try it (create session) | 0.87 |
| First Home | 1.03 |
| First Home (suite run) | 1.06 |
| Warm Home | 0.96–1.08 |
| Activity | 0.57–0.59 |
| Settings | 0.72–0.75 |
| Confirm Hikari Denki | 1.04 |
| Save Settings | 1.10 |

### D. Early submission, Nov 5 (owner submits)
- [x] Private Devpost draft rewritten for the new screen (`submission/DEVPOST.md`)
- [x] Private local rehearsal video shows the seeded sentence, Hikari confirmation result, invoice review, simulated sent state and database-backed paid result (`submission/rough-rehearsal.webm`)
- [x] Code MIT licence is present; bundled Hanken Grotesk and Newsreader fonts include SIL OFL 1.1 notices
- [ ] Owner's OK to make the repository public (D22)
- [ ] Submitted for PayPal's early eligibility check

### E. The reader, Nov 6–7 (Claude; owner flips Email Routing)
- [x] Photo/PDF intake, private Storage, background Claude extraction, To check, confirmation and correction rules implemented. Tested against PGlite and local provider responses (D36)
- [ ] Verify private Supabase Storage on the Tokyo project: needs the bucket `household-documents` created as private first (V8)
- [ ] Verify a real Claude document read with the owner’s Anthropic settings
- [x] Worker email handler and authenticated inbound route implemented. The reader parses forwarded MIME messages, checks the recipient capability and uses the household’s rules
- [ ] Owner enables Email Routing on their domain and verifies delivery through the live Worker
- [x] Card-use emails become confirmed charges on the selected household card. Local tests cover currency conversion, cross-household rejection and duplicate reads

### F. Voice and MCP, Nov 8–9 (Claude)
- [x] Voice and typed ask use the runway; a spoken or typed purchase becomes a pending charge in To check (D26). Browser controls checked at 375px and 1440px with synthetic speech.
- [x] Scoped MCP token issuance and revocation in Settings, stateless HTTP server and loopback terminal demo with a fictional PGlite household (D27)
- [ ] Issue, use and revoke an MCP token against the configured app and Supabase. The local protocol and revocation tests pass with a test-only key. The configured app still needs the owner's `MCP_TOKEN_KEY`.

### G. Options and household, Nov 10 (Claude)
- [x] Japan borrowing references verified on primary sources (V5); Options ranks total extra cost, shows eligibility and timing limits, and checks a clearly labelled 30-day full-repayment comparison against projected receipts (D7). US terms remain labelled unverified assumptions (V4)
- [x] Settings edits bank balance, member names, cards and shared/personal bill ownership; composite household constraints enforce member/document isolation (D28). Settings and Options components checked at 375px/1440px in light/dark with fictional fixtures

### H. Own AI key, Nov 10–11 (Claude) — last
- [x] Settings key field and Vault create/update/delete SQL implemented; each app-side Claude call atomically reserves default-key quota using the household’s actual local date (D33). Deterministic typed questions and MCP engine reads do not call Claude or consume that quota. Isolated tests cover key ownership, replacement, cleanup, races and midnight reset
- [x] Verify Supabase Vault create/read/delete over the real connection (V7)
- [ ] Verify Claude calls with the default key and a household key. The configured app still needs the owner's Anthropic settings.

### I. Final, Nov 11–12 (both)
- [x] Independent security review of the build and its fixes (D12, D37): secrets scan, sandbox guard, household scoping, origin checks, rate limits, toolkit timeout, `APP_URL`, webhook replies, AI-key body cap and lint-enforced send split. `tsc`, lint, `npm run db:test` (all six suites) and the three HTTP suites pass
- [ ] Owner verifies hosted settings and live sandbox behavior before public submission
- [ ] Final video 2:40–2:55 recorded on a Try it household (owner records)
- [x] README and Devpost rewritten as private current-state drafts; final submission copy awaits owner review and live verification
- [ ] Submitted by the evening of Nov 12, Tokyo

If days run out, cut from the bottom: H first, then G, then MCP in F. Never cut B, C or D.

## What exists now

- Home reads the cookie-selected household, computes its 30-day sentence, runway, cards and upcoming payments, and confirms pending items in Postgres. The old five-tab screen, sample reducer and persona switch are removed.
- PayPal plumbing: sandbox guard, token and REST client, toolkit split (agent drafts, server sends), verified webhook route, smoke test.
- Backend foundation (D31–D37): All eight migrations are applied on the Supabase project in Tokyo. The 18-table schema, household-scoped data layer, Ben seed and Vault probe are in place. Cloudflare Workers build through OpenNext with the daily Cron Trigger. Try it creates a separate seeded household with a protected cookie and a demo-only reset. Verified webhook deliveries persist in Postgres.
- Reader: private document intake, MIME email routing code, asynchronous extraction, editable readings, recurring label/category/card corrections and household file cleanup. Upload and To check open at phone and desktop widths. The private Storage bucket `household-documents` does not exist yet on the Tokyo project, so uploads and forwarded mail cannot store files until the owner creates it. Live AI and Email Routing checks await the owner’s settings.
- Catalogue engine with Japan (20 moves) and US (16 moves), both checked on primary pages Nov 1; now secondary.
- Sample bills, a card-statement email, a 国保 slip and Maya's US bill.
- Private current-state Devpost and rehearsal script drafts, plus the silent 24-second local rehearsal video. The rehearsal's external PayPal transport is simulated.

## Running now

| Work | Owner | Files |
|---|---|---|
| Live owner verification, final video and submission | Ben | Devpost, PayPal Sandbox, Supabase, Worker |
| Current-state docs and local rehearsal | Codex | `submission/`, `economy-saver/README.md`, `ARCHITECTURE.md` |

## Owner's tasks

Phase A above, plus: answer the open questions in DECISIONS.md (O1, O2, O5, O8); give the OK before the first deploy and before the repo goes public; record the final video; submit.

## Rules we keep

Sandbox only. Claude never creates accounts or handles credentials. Commits only when asked. Public repo and deploy only with the owner's OK. Fictional companies; no trademarks or copyrighted music in the video; no real bills or personal data. Suggestions are information with the user's numbers, never a named product to buy; anything paid is labelled.
