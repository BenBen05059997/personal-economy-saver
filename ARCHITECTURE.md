# Architecture: how the app is wired

A Next.js 16 app on Cloudflare Workers (OpenNext) over household-scoped Postgres in Supabase (Tokyo, `ap-northeast-1`, transaction pooler). Try it and magic-link sessions, Home and invoice review, typed-in data (clients, bills, card charges, invoices marked paid), PayPal history import, the reader (upload and forwarded email), the in-app agent, MCP, PayPal approval and verified-webhook handling are implemented. The local test suites run them on isolated PGlite data with simulated external results. Next.js dev and the local Worker read a fictional household from the Tokyo project; Vault and the private Storage bucket `household-documents` are verified there. Not yet verified live: magic-link delivery, a Claude call, the deployed Worker, Email Routing, and a real PayPal send-to-webhook round trip. The repository and the app are private. Decisions: D18, D31–D40 in [DECISIONS.md](DECISIONS.md).

## The tree

```
Clients
├── Browser (phone and desktop): Next.js UI, Try it household or magic-link session; voice through browser speech
├── MCP client (Claude Code, ChatGPT…): bearer token → the same tool catalogue as the agent, read and draft only
├── Email: the user forwards a bill to their address on the owner's domain
└── PayPal sandbox: webhooks after an invoice is paid

Cloudflare
├── Email Worker: Email Routing hands it each forwarded mail → POST /api/inbound
├── Cron Trigger: once a day → GET /api/cron (keeps Supabase awake, FX snapshots, statements, reminders)
└── Next.js 16 app on Workers (OpenNext adapter)
    ├── Pages (server components): read the household's tables, render the sentence
    ├── API routes (mutating routes start with `householdRequest` from src/lib/session.ts: same-origin check, then household; shared responses in src/lib/door.ts)
    │   ├── /api/ask             typed or spoken question or log → agent (Claude + tools over the engine) → one or two sentences
    │   ├── /api/clients, /api/bills, /api/charges   typed-in client, bill and card charge
    │   ├── /api/invoices/draft, /api/invoices/paid  invoice draft; mark an invoice paid outside PayPal
    │   ├── /api/upload          photo or PDF → Storage → documents → reader
    │   ├── /api/inbound         forwarded email → Storage → documents → reader
    │   ├── /api/readings/retry  read a document again
    │   ├── /api/confirm         a reading or pending row → a bill or a charge; corrections become rules
    │   ├── /api/approve         user approval → PayPal Sandbox send/reminder → events
    │   ├── /api/paypal/webhook  verify signature → webhook_deliveries → events → invoice paid
    │   ├── /api/paypal/import   read sandbox invoices → clients and invoices (one configured household only)
    │   ├── /api/mcp, /api/mcp/tokens   MCP server (token → household); token issue and revoke
    │   ├── /api/events          GET events since a time and the feed summary; POST mark read (the bell). Home polls it while something is in flight
    │   ├── /api/try, /api/try/reset   Try it: new anonymous household; demo-only reset
    │   ├── /api/auth/link, /callback, /logout   magic-link request, callback and logout
    │   ├── /api/onboarding      first-run setup for a signed-in person (name, timezone, balance, card); upgrades a Try it household
    │   ├── /api/settings, /api/settings/ai-key, /api/forwarding   household preferences, AI-key lifecycle, forwarding address
    │   ├── /api/household       delete my data
    │   ├── /api/cron            daily job (bearer secret)
    │   └── /api/health          readiness, no values
    └── Core (pure TypeScript, no I/O)
        ├── Runway engine (lib/money/runway.ts): series, low, safe to spend, room per card, options ladder
        ├── Sentence composer: engine output → "You're fine if … If late, ¥18,780 short on the 27th."
        ├── Agent (lib/agent): one tool catalogue (read and draft tools) over the engine, shared with the MCP server; Claude through the Anthropic SDK (lib/anthropic.ts)
        ├── Reader: image/PDF/email extraction → validated reading that waits for confirmation
        ├── PayPal layer: agent gets draft/read tools; send/remind tools run only from /api/approve; sandbox guard
        └── Auth + scope: request → user → household_id; every query carries it

Supabase
├── Postgres (Drizzle, Tokyo region), 18 tables: households, members, users, paypal_connections, clients, invoices, bills,
│   cards, card_statements, charges, documents, readings, rules, events, webhook_deliveries,
│   api_tokens, fx_rates, request_buckets
├── Auth: magic-link login
├── Vault: users' own Anthropic keys
└── Storage: private receipt photos, PDFs and raw forwarded emails (private bucket `household-documents`)

Outside
├── Anthropic API: the user's own key (Settings, encrypted) or the owner's capped default
└── PayPal sandbox API: send invoice, send reminder, read invoices; webhooks come back in
```

## Updates

Every change is an `events` row. Rows with `notify = true` feed the bell in the top bar (unread count, list, `read_at`). Home and To check poll the event feed every 5 s only while a tracked PayPal invoice is out or a bill is queued or being read. Returning focus checks the feed and refreshes the screen only when its summary changes. No email, no websockets for Nov 12; Web Push after.

## The six flows

1. **Open the app.** Page → auth → household_id → engine reads bills, cards, charges, statements, invoices, clients → sentence, safe to spend, the runway picture, the events list. Activity, Settings and Upload only need the owner, event feed, timezone and pending count for their navigation. The count uses the same household and charge date window as To check. No AI call on open.
2. **A bill arrives.** Forward it (Email Worker) or upload it → file to Storage, a `documents` row → reader asks Claude for `{biller, amount, due, category}` against a zod schema → a `readings` row → a "To check" row on Home → the user confirms → a `bills` row (or `charges` for a card email) → the engine recomputes → the sentence changes. A correction on the confirm card writes a `rules` row so the next read from that biller is right.
3. **Short, so get paid.** The engine finds the low point and ranks options. The user reviews an invoice and approves it; `/api/approve` sends through the PayPal Sandbox integration and records the sent event. PayPal later posts a webhook; the route verifies its signature before the unique delivery, paid transition, balance credit and notification are committed together. Local tests inject a simulated PayPal transport and call the database handler with an already-verified event; no real invoice send or payment has been performed.
4. **Ask or log by voice.** Browser speech → text → `/api/ask` → the agent: Claude with tools over the engine (at most 4 tool turns, 20 s, no retries). Read tools (`where_am_i`, `whats_due`, `can_i_spend`, `list_clients_and_cards`, `timeline`, `options_when_short`, `list_invoices`) return the engine's numbers, which the model quotes verbatim in one or two sentences. Draft tools (`draft_invoice`, `add_bill`, `log_charge`) save a draft or a pending row in To check, and the answer links to it; the user confirms there. Tool output is treated as data. Nothing is sent or paid by the agent. With no key or setting, ask returns a clear error.
5. **From a terminal.** An MCP client presents a token → `api_tokens` → household → the same tool catalogue as the agent: where am I, what's due, draft an invoice. Sending still needs the tap in the app.
6. **Typed in, or imported.** The forms for a client, a bill and a card charge post to `/api/clients`, `/api/bills` and `/api/charges`; each writes a confirmed row and an event (the charge goes through the statement-charge lock), and the engine recomputes. An invoice with no PayPal id can be marked paid outside PayPal on its review page (`/api/invoices/paid`): the bank balance is credited at the stored FX rate and an event is recorded; PayPal-linked invoices are refused and stay with the webhook. `/api/paypal/import` lets the one non-demo household named by `PAYPAL_BALANCE_HOUSEHOLD_ID` read its sandbox merchant invoices (read-only, up to 5 pages), match clients by email and add them idempotently on `paypal_invoice_id`; already-paid invoices credit no balance.

## Rules the wiring enforces

- The browser is never trusted for payment state; only a verified webhook marks an invoice paid.
- The agent and the MCP server share one catalogue of draft and read tools; send tools exist in one place, `/api/approve`, behind the user's tap. Lint allows only `src/app/api/approve/route.ts` to import the send-capable `runTool` and `deleteSmokeDraft`.
- Every table carries `household_id`; the data layer (`requireHousehold()` in `src/db/household.ts`) refuses a query without one.
- Money is integers in minor units with a currency; the FX rate used is stored on the row.
- `PAYPAL_ENVIRONMENT` must be `SANDBOX` or the app refuses to start. PayPal toolkit calls time out after 20 s.
- Rate limits (`request_buckets`, per household per minute): ask 30, MCP 30, drafts 20, approvals 10, uploads and retries 6, document reads 6, PayPal import 2. Try it is capped across the app at 60 new demo households an hour.
- The webhook route logs the reason for a rejection and tells anonymous callers nothing; the AI-key route caps its body at 4 KiB; sign-in links return to the required `APP_URL`, never to the request's Origin header.
- No server-side image or PDF processing (Workers' CPU budget); files go to Claude as uploaded.

## Foundation: trust, credentials, data, logs

- **Tenant wall.** The app connects as the database owner through `DATABASE_URL`. RLS is enabled on every table with no policies, which guards Supabase's REST path only (the app does not use it). The effective wall is the household-scoped data layer above.
- **Identities.** Try it visitor: a UUID in an httpOnly cookie, a bearer for that demo household (`findDemoHousehold`); Try it makes an anonymous session with its own fictional household. Signed-in person: email → magic link → callback → Supabase auth cookies (`pes-auth`, 30 days, refreshed in middleware, `getUser()` per request) → `users` → `members` → household; a Try it household can be upgraded through sign-in. MCP client: a token hashed in `api_tokens`, scoped and revocable. Cron: `CRON_SECRET`, compared in constant time. Email Worker: `INBOUND_WORKER_SECRET`. PayPal: the webhook signature. Demo households are never deleted today (only rate-capped).
- **Credentials, three classes.** (a) Owner secrets: `.env.local` locally and Workers secrets in production (encrypted, write-only). (b) A user's Anthropic key: Supabase Vault (`households.ai_key_secret_id`), read inside a transaction immediately before each model call and never logged or returned to the browser; `ai_key_hint` holds the prefix and last four characters only. Vault keeps the key out of plain dumps, but anyone holding `DATABASE_URL` can read `vault.decrypted_secrets`. A saved key that cannot be read is never replaced by another key. The document being read travels to `api.anthropic.com` with that key, or under the owner's key when the household has none; every default-key attempt reserves household quota first, using the household's local date and `ANTHROPIC_DAILY_READ_LIMIT`. MCP tokens are stored hashed. (c) Sessions: httpOnly, SameSite=Lax, Secure in production, same-origin check on every browser-facing mutating route.
- **Data held, most sensitive first.** Raw forwarded emails and receipts in the private bucket (kept indefinitely); `webhook_deliveries.payload` (full PayPal JSON, kept indefinitely); balances, bills, charges including `place`, `readings.extracted`; clients' names and emails (third-party data); invoice items and notes, member display names, the forwarding address.
- **Logs.** The app writes four `console` lines in total (the webhook rejection reason, the cron status in `worker.ts`, and two dev-only catalogue warnings); user-facing errors are fixed strings. Platform logs exist outside the app: Cloudflare request logs, Supabase Postgres, Auth and Storage logs, Anthropic and PayPal request logs. `events` is the user's audit trail; there is no operator log yet.
- **Backups and migrations.** No automatic database backups are configured. Migrations run from the owner's machine with `npm run db:migrate`, separately from deploys.
- **Not limited yet.** There is no app-wide AI spend budget and no per-IP limit on `/api/try` or `/api/auth/link`.
- **Environments.** One Supabase project and one PayPal sandbox app serve both local development and the future deployment.

The hardening checklist is phase J in PLAN.md; it is the last build stage by the owner's decision (D38).

## The daily job and deletion

The daily route requires `CRON_SECRET` and an explicit `CRON_HOUSEHOLD_IDS` list. It processes each configured household in its timezone, saves dated ECB cross-rate snapshots for real JPY households, closes statements and records due-date reminders. Empty configuration fails clearly. Demo FX stays fictional. A late charge confirmation and statement closing share the household lock so neither can drop or double-count the charge.

Reset, sign-in upgrade and deletion lock the household before removing its Vault key and private Storage objects. Database pointers remain when cleanup fails so a retry can finish. Storage removal is idempotent and external to the Postgres transaction; a later database rollback can leave an object already removed, and retrying cleanup handles that state.
