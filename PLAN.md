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
- [ ] Supabase project created; `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL` (transaction pooler, port 6543) in `economy-saver/.env.local`
- [ ] `npx wrangler login` run from `economy-saver`
- [ ] Anthropic API key in `.env.local` (if not already)
- [ ] Tell Claude the domain on Cloudflare for the forwarding address (name only)

### B. Foundation live, Nov 2 (Claude; owner runs the deploy)
- [x] Schema, household-scoped data layer and fictional Ben seed tested locally (`npm run db:test`)
- [x] App builds and runs as a Worker locally, daily cron wired (`npm run cf:preview`); landing returns 200, missing DATABASE_URL on Try it returns 503, unsigned webhook returns 400
- [ ] Migrate and seed the real Supabase; Vault works (V7)
- [x] Worker bundle below 3 MiB gzip in the local dry run, with server credentials supplied by runtime bindings. The generated Worker and source map pass the credential scan
- [ ] Scoped Supabase household read from the Worker (V6)
- [x] Webhook events stored in Postgres instead of memory
- [ ] First deploy: secrets set with `wrangler secret put`, owner runs `npm run cf:deploy` (owner's OK, D22)
- [ ] PayPal webhook registered on the deployed URL; a sandbox invoice paid end to end (V1)

### C. The screen on real data, Nov 3–4 (Claude)
- [x] Try it routes, per-visitor demo cookie, household-scoped reset and origin checks (D34)
- [ ] Verify two live browser sessions and reset against Supabase
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

### D. Early submission, Nov 5 (owner submits)
- [x] Private Devpost draft rewritten for the new screen (`submission/DEVPOST.md`)
- [x] Private local rehearsal video shows the seeded sentence, Hikari confirmation result, invoice review, simulated sent state and database-backed paid result (`submission/rough-rehearsal.webm`)
- [x] Code MIT licence is present; bundled Hanken Grotesk and Newsreader fonts include SIL OFL 1.1 notices
- [ ] Owner's OK to make the repository public (D22)
- [ ] Submitted for PayPal's early eligibility check

### E. The reader, Nov 6–7 (Claude; owner flips Email Routing)
- [x] Photo/PDF intake, private Storage, background Claude extraction, To check, confirmation and correction rules implemented. Tested against PGlite and local provider responses (D36)
- [ ] Verify private Storage and a real Claude read with the owner’s Supabase and Anthropic settings
- [x] Worker email handler and authenticated inbound route implemented. The reader parses forwarded MIME messages, checks the recipient capability and uses the household’s rules
- [ ] Owner enables Email Routing on their domain and verifies delivery through the live Worker
- [x] Card-use emails become confirmed charges on the selected household card. Local tests cover currency conversion, cross-household rejection and duplicate reads

### F. Voice and MCP, Nov 8–9 (Claude)
- [x] Voice and typed ask use the runway; a spoken or typed purchase becomes a pending charge in To check (D26). Browser controls checked at 375px and 1440px with synthetic speech.
- [x] Scoped MCP token issuance and revocation in Settings, stateless HTTP server and loopback terminal demo with a fictional PGlite household (D27)
- [ ] Verify account-backed MCP tokens with the owner-provided server settings

### G. Options and household, Nov 10 (Claude)
- [x] Japan borrowing references verified on primary sources (V5); Options ranks total extra cost, shows eligibility and timing limits, and checks a clearly labelled 30-day full-repayment comparison against projected receipts (D7). US terms remain labelled unverified assumptions (V4)
- [x] Settings edits bank balance, member names, cards and shared/personal bill ownership; composite household constraints enforce member/document isolation (D28). Settings and Options components checked at 375px/1440px in light/dark with fictional fixtures

### H. Own AI key, Nov 10–11 (Claude) — last
- [x] Settings key field and Vault create/update/delete SQL implemented; each app-side Claude call atomically reserves default-key quota using the household’s actual local date (D33). Deterministic typed questions and MCP engine reads do not call Claude or consume that quota. Isolated tests cover key ownership, replacement, cleanup, races and midnight reset
- [ ] Verify actual Vault encryption and default/own-key provider calls against the owner’s Supabase and Anthropic settings (V7)

### I. Final, Nov 11–12 (both)
- [x] Local security pass: secrets scan, sandbox guard, household scoping, origin checks and rate limits reviewed in code and local checks
- [ ] Owner verifies hosted settings and live sandbox behavior before public submission
- [ ] Final video 2:40–2:55 recorded on a Try it household (owner records)
- [x] README and Devpost rewritten as private current-state drafts; final submission copy awaits owner review and live verification
- [ ] Submitted by the evening of Nov 12, Tokyo

If days run out, cut from the bottom: H first, then G, then MCP in F. Never cut B, C or D.

## What exists now

- Home reads the cookie-selected household, computes its 30-day sentence, runway, cards and upcoming payments, and confirms pending items in Postgres. The old five-tab screen, sample reducer and persona switch are removed.
- PayPal plumbing: sandbox guard, token and REST client, toolkit split (agent drafts, server sends), verified webhook route, smoke test.
- Backend foundation (D31–D37): Drizzle schema of 18 tables with eight ordered migration files, household-scoped data layer, Ben seed, PGlite checks; Cloudflare Workers build through OpenNext with the daily Cron Trigger. Try it creates a separate seeded household with a protected cookie and a demo-only reset. Verified webhook deliveries persist in Postgres. Live Supabase and Worker verification are pending the project settings.
- Reader: private document intake, MIME email routing code, asynchronous extraction, editable readings, recurring label/category/card corrections and household file cleanup. Upload and To check open at phone and desktop widths. Live Storage, AI and Email Routing verification await the owner’s settings.
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
