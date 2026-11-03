# Architecture: how the app is wired

The app implements Try it and magic-link sessions, household-scoped Postgres reads and writes, Home and invoice review, reader intake, MCP, PayPal approval and verified-webhook handling. The local test suite exercises those paths with isolated PGlite data and simulated external results. Next.js dev reads a fictional household from the Supabase project in Tokyo (`ap-northeast-1`, transaction pooler); so does the local Worker. Vault and the private Storage bucket `household-documents` are verified. Magic-link delivery (needs the project's Authentication URL Configuration), Anthropic, deployed Worker connectivity and a real PayPal send-to-webhook round trip still need owner-side verification. The repository and app are private. Decisions: D18, D31–D37 in [DECISIONS.md](DECISIONS.md).

## The tree

```
Clients
├── Browser (phone and desktop): Next.js UI, Try it household or magic-link session; voice through browser speech
├── MCP client (Claude Code, ChatGPT…): bearer token → the same engine, read and draft only
├── Email: the user forwards a bill to their address on the owner's domain
└── PayPal sandbox: webhooks after an invoice is paid

Cloudflare
├── Email Worker: Email Routing hands it each forwarded mail → POST /api/inbound
├── Cron Trigger: once a day → GET /api/cron (keeps Supabase awake, sends reminders)
└── Next.js 16 app on Workers (OpenNext adapter)
    ├── Pages (server components): read the household's tables, render the sentence
    ├── API routes
    │   ├── /api/ask          typed or spoken question or log → agent (Claude + tools over the engine) → one or two sentences
    │   ├── /api/clients, /api/bills, /api/charges   typed-in client, bill and card charge
    │   ├── /api/invoices/draft, /api/invoices/paid  invoice draft; mark an invoice paid outside PayPal
    │   ├── /api/upload       photo or PDF → Storage → documents → reader
    │   ├── /api/inbound      forwarded email → Storage → documents → reader
    │   ├── /api/confirm      a reading → a bill or a charge; corrections become rules
│   ├── /api/approve      user approval → PayPal Sandbox send/reminder → events
    │   ├── /api/paypal/webhook  verify signature → webhook_deliveries → events → invoice paid
    │   ├── /api/paypal/import   read sandbox invoices → clients and invoices (one configured household only)
    │   ├── /api/mcp          MCP server; token → household; tools over the engine
    │   ├── /api/events       events since a time; the bell's unread list; Home polls it while something is in flight
│   ├── /api/try          Try it: new anonymous household; demo-only reset
│   │   /api/auth/*       magic-link request, callback and logout
│   │   /api/settings/*   household preferences, forwarding and AI-key lifecycle
    │   ├── /api/cron         ping + reminders
    │   └── /api/household    delete my data
    └── Core (pure TypeScript, no I/O)
        ├── Runway engine (lib/money/runway.ts): series, low, safe to spend, room per card, options ladder
        ├── Sentence composer: engine output → "You're fine if … If late, ¥18,780 short on the 27th."
        ├── Agent: one tool catalogue (read and draft tools) over the engine, shared with the MCP server; Claude through the Anthropic SDK
        ├── Reader: image/PDF/email extraction → validated reading that waits for confirmation
        ├── PayPal layer: agent gets draft/read tools; send/remind tools run only from /api/approve; sandbox guard
        └── Auth + scope: request → user → household_id; every query carries it

Supabase
├── Postgres (Drizzle, Tokyo region): households, members, users, paypal_connections, clients, invoices, bills,
│   cards, card_statements, charges, documents, readings, rules, events, webhook_deliveries,
│   api_tokens, fx_rates, request_buckets
├── Auth: magic-link login implementation (live email exchange unverified)
└── Storage: private receipt photos, PDFs and raw forwarded emails (private bucket `household-documents`)

Outside
├── Anthropic API: the user's own key (Settings, encrypted) or the owner's capped default
└── PayPal sandbox API: send invoice, send reminder; webhooks come back in
```

## Sessions and updates

- Email → magic-link request → callback → scoped membership → httpOnly session cookie. The routes and session checks are implemented; a real email exchange still needs the owner's Supabase settings. Sign-in links return to the required `APP_URL`, never to the request's Origin header. **Try it** makes an anonymous session with its own fictional household and can be upgraded through sign-in.
- Every change is an `events` row. Rows with `notify = true` feed the bell in the top bar (unread count, list, `read_at`). Home and To check poll the event feed every 5 s only while a tracked PayPal invoice is out or a bill is queued or being read. Returning focus checks the feed and refreshes the screen only when its summary changes. No email, no websockets for Nov 12; Web Push after.

## The six flows

1. **Open the app.** Page → auth → household_id → engine reads bills, cards, charges, statements, invoices, clients → sentence, safe to spend, the runway picture, the events list. Activity, Settings and Upload only need the owner, event feed, timezone and pending count for their navigation. The count uses the same household and charge date window as To check. No AI call on open.
2. **A bill arrives.** Forward it (Email Worker) or upload it → file to Storage, a `documents` row → reader asks Claude for `{biller, amount, due, category}` against a zod schema → a `readings` row → a "To check" row on Home → the user confirms → a `bills` row (or `charges` for a card email) → the engine recomputes → the sentence changes. A correction on the confirm card writes a `rules` row so the next read from that biller is right.
3. **Short, so get paid.** The engine finds the low point and ranks options. The user reviews an invoice and approves it; `/api/approve` sends through the PayPal Sandbox integration and records the sent event. In production, PayPal later posts a webhook; the route verifies its signature before the unique delivery, paid transition, balance credit and notification are committed together. Local tests inject a simulated PayPal transport and call the database handler with an already-verified event. No real invoice send or payment has been performed.
4. **Ask or log by voice.** Browser speech → text → `/api/ask` → the agent: Claude with tools over the engine (at most 4 tool turns, 20 s, no retries). Read tools (`where_am_i`, `whats_due`, `can_i_spend`, `list_clients_and_cards`, `timeline`, `options_when_short`, `list_invoices`) return the engine's numbers, which the model quotes verbatim in one or two sentences. Draft tools (`draft_invoice`, `add_bill`, `log_charge`) save a draft or a pending row in To check, and the answer links to it; the user confirms there. Tool output is treated as data. Nothing is sent or paid by the agent. With no key or setting, ask returns a clear error.
5. **From a terminal.** An MCP client presents a token → `api_tokens` → household → the same tool catalogue as the agent: where am I, what's due, draft an invoice. Sending still needs the tap in the app.
6. **Typed in, or imported.** The forms for a client, a bill and a card charge post to `/api/clients`, `/api/bills` and `/api/charges`; each writes a confirmed row and an event (the charge goes through the statement-charge lock), and the engine recomputes. An invoice with no PayPal id can be marked paid outside PayPal on its review page (`/api/invoices/paid`): the bank balance is credited at the stored FX rate and an event is recorded; PayPal-linked invoices are refused and stay with the webhook. `/api/paypal/import` lets the one non-demo household named by `PAYPAL_BALANCE_HOUSEHOLD_ID` read its sandbox merchant invoices (read-only, up to 5 pages), match clients by email and add them idempotently on `paypal_invoice_id`; already-paid invoices credit no balance.

## Rules the wiring enforces

- The browser is never trusted for payment state; only a verified webhook marks an invoice paid.
- The agent and the MCP server share one catalogue of draft and read tools; send tools exist in one place, `/api/approve`, behind the user's tap.
- Every table carries `household_id`; the data layer refuses a query without one.
- Money is integers in minor units with a currency; the FX rate used is stored on the row.
- `PAYPAL_ENVIRONMENT` must be `SANDBOX` or the app refuses to start.
- Keys never leave the server: AI keys in Supabase Vault with household-bound ownership, shown only as a limited hint; MCP tokens stored hashed. Every default-key model attempt reserves household quota using its actual local date and explicit ANTHROPIC_DAILY_READ_LIMIT. Own keys are never substituted when a saved key cannot be read.
- Rate limits (`request_buckets`): `/api/ask` and reads per household, drafts 20 and approvals 10 a minute per household, Try it 60 new demo households an hour app-wide. PayPal toolkit calls time out after 20 s. The webhook route logs the reason for a rejection and tells anonymous callers nothing; the AI-key route caps its body at 4 KiB.
- Lint allows only `src/app/api/approve/route.ts` to import the send-capable `runTool` and `deleteSmokeDraft`.
- No server-side image or PDF processing (Workers' CPU budget); files go to Claude as uploaded.

## Foundation: trust, credentials, data, logs

- **Tenant wall.** The app connects as the database owner through `DATABASE_URL`. RLS is enabled on every table with no policies, which guards Supabase's REST path only (the app does not use it). The effective wall is `requireHousehold()` in `src/db/household.ts` and the rule that every query filters by `household_id`.
- **Identities.** Try it visitor: a UUID in an httpOnly cookie, a bearer for that demo household (`findDemoHousehold`). Signed-in person: Supabase auth cookies (`pes-auth`, 30 days, refreshed in middleware, `getUser()` per request) → `users` → `members` → household. MCP client: a token hashed in `api_tokens`, scoped and revocable. Cron: `CRON_SECRET`, compared in constant time. Email Worker: `INBOUND_WORKER_SECRET`. PayPal: the webhook signature. Demo households are never deleted today (only rate-capped at 60 new per hour).
- **Credentials, three classes.** (a) Owner secrets: `.env.local` locally and Workers secrets in production (encrypted, write-only). (b) A user's Anthropic key: Supabase Vault (`households.ai_key_secret_id`), read inside a transaction immediately before each model call and never logged; `ai_key_hint` holds the prefix and last four characters only. Vault keeps the key out of plain dumps, but anyone holding `DATABASE_URL` can read `vault.decrypted_secrets`. The document being read travels to `api.anthropic.com` with that key, or under the owner's key when the household has none. (c) Sessions: httpOnly, SameSite=Lax, Secure in production, same-origin check on every mutating route.
- **Data held, most sensitive first.** Raw forwarded emails and receipts in the private bucket (kept indefinitely); `webhook_deliveries.payload` (full PayPal JSON, kept indefinitely); balances, bills, charges including `place`, `readings.extracted`; clients' names and emails (third-party data); invoice items and notes, member display names, the forwarding address.
- **Logs.** The app writes three `console` lines in total (the webhook rejection reason and two dev-only catalogue warnings); user-facing errors are fixed strings. Platform logs exist outside the app: Cloudflare request logs, Supabase Postgres, Auth and Storage logs, Anthropic and PayPal request logs. `events` is the user's audit trail; there is no operator log yet.
- **Backups and migrations.** No automatic database backups are configured. Migrations run from the owner's machine with `npm run db:migrate`, separately from deploys.
- **Limits.** Per-household rate limits exist (see "Rules the wiring enforces"). There is no app-wide AI spend budget and no per-IP limit on `/api/try` or `/api/auth/link`.
- **Environments.** One Supabase project and one PayPal sandbox app serve both local development and the future deployment.

The hardening checklist is phase J in PLAN.md; it is the last build stage by the owner's decision (D38).

The daily route requires `CRON_SECRET` and an explicit `CRON_HOUSEHOLD_IDS` list. It processes each configured household in its timezone, saves dated ECB cross-rate snapshots for real JPY households, closes statements and records due-date reminders. Empty configuration fails clearly. Demo FX remains fictional. A late charge confirmation and statement closing share the household lock so neither can drop or double-count the charge.

Reset, sign-in upgrade and deletion lock the household before removing its Vault key and private Storage objects. Database pointers remain when cleanup fails so a retry can finish. Storage removal is idempotent and external to the Postgres transaction; a later database rollback can leave an object already removed, and retrying cleanup handles that state.
