# Architecture: how the app is wired

The app implements Try it and magic-link sessions, household-scoped Postgres reads and writes, Home and invoice review, reader intake, MCP, PayPal approval and verified-webhook handling. The local test suite exercises those paths with isolated PGlite data and simulated external results. Next.js dev reads a fictional household from the Supabase project in Tokyo (`ap-northeast-1`, transaction pooler); the local Worker on Tokyo is pending. Vault is verified. The private Storage bucket `household-documents` does not exist yet on the Tokyo project. Magic-link delivery (needs the project's Authentication URL Configuration), Anthropic, deployed Worker connectivity and a real PayPal send-to-webhook round trip still need owner-side verification. The repository and app are private. Decisions: D18, D31–D37 in [DECISIONS.md](DECISIONS.md).

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
    │   ├── /api/ask          typed or spoken question or log → engine → one sentence
    │   ├── /api/upload       photo or PDF → Storage → documents → reader
    │   ├── /api/inbound      forwarded email → Storage → documents → reader
    │   ├── /api/confirm      a reading → a bill or a charge; corrections become rules
│   ├── /api/approve      user approval → PayPal Sandbox send/reminder → events
    │   ├── /api/paypal/webhook  verify signature → webhook_deliveries → events → invoice paid
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
        ├── Reader: image/PDF/email extraction → validated reading that waits for confirmation
        ├── PayPal layer: agent gets draft/read tools; send/remind tools run only from /api/approve; sandbox guard
        └── Auth + scope: request → user → household_id; every query carries it

Supabase
├── Postgres (Drizzle, Tokyo region): households, members, users, paypal_connections, clients, invoices, bills,
│   cards, card_statements, charges, documents, readings, rules, events, webhook_deliveries,
│   api_tokens, fx_rates, request_buckets
├── Auth: magic-link login implementation (live email exchange unverified)
└── Storage: private receipt photos, PDFs and raw forwarded emails (bucket `household-documents`, to be created by the owner)

Outside
├── Anthropic API: the user's own key (Settings, encrypted) or the owner's capped default
└── PayPal sandbox API: send invoice, send reminder; webhooks come back in
```

## Sessions and updates

- Email → magic-link request → callback → scoped membership → httpOnly session cookie. The routes and session checks are implemented; a real email exchange still needs the owner's Supabase settings. Sign-in links return to the required `APP_URL`, never to the request's Origin header. **Try it** makes an anonymous session with its own fictional household and can be upgraded through sign-in.
- Every change is an `events` row. Rows with `notify = true` feed the bell in the top bar (unread count, list, `read_at`). Home and To check poll the event feed every 5 s only while a tracked PayPal invoice is out or a bill is queued or being read. Returning focus checks the feed and refreshes the screen only when its summary changes. No email, no websockets for Nov 12; Web Push after.

## The five flows

1. **Open the app.** Page → auth → household_id → engine reads bills, cards, charges, statements, invoices, clients → sentence, safe to spend, the runway picture, the events list. Activity, Settings and Upload only need the owner, event feed, timezone and pending count for their navigation. The count uses the same household and charge date window as To check. No AI call on open.
2. **A bill arrives.** Forward it (Email Worker) or upload it → file to Storage, a `documents` row → reader asks Claude for `{biller, amount, due, category}` against a zod schema → a `readings` row → a "To check" row on Home → the user confirms → a `bills` row (or `charges` for a card email) → the engine recomputes → the sentence changes. A correction on the confirm card writes a `rules` row so the next read from that biller is right.
3. **Short, so get paid.** The engine finds the low point and ranks options. The user reviews an invoice and approves it; `/api/approve` sends through the PayPal Sandbox integration and records the sent event. In production, PayPal later posts a webhook; the route verifies its signature before the unique delivery, paid transition, balance credit and notification are committed together. Local tests inject a simulated PayPal transport and call the database handler with an already-verified event. No real invoice send or payment has been performed.
4. **Ask or log by voice.** Browser speech → text → `/api/ask` → the engine answers "Can I afford ¥4,000 tonight?" from the same numbers; "I paid ¥3,800 on Card B" becomes a pending charge that goes through the same confirm step. Nothing is sent by voice.
5. **From a terminal.** An MCP client presents a token → `api_tokens` → household → the same engine: where am I, what's due, draft an invoice. Sending still needs the tap in the app.

## Rules the wiring enforces

- The browser is never trusted for payment state; only a verified webhook marks an invoice paid.
- The agent and the MCP server hold draft and read tools only; send tools exist in one place, `/api/approve`, behind the user's tap.
- Every table carries `household_id`; the data layer refuses a query without one.
- Money is integers in minor units with a currency; the FX rate used is stored on the row.
- `PAYPAL_ENVIRONMENT` must be `SANDBOX` or the app refuses to start.
- Keys never leave the server: AI keys in Supabase Vault with household-bound ownership, shown only as a limited hint; MCP tokens stored hashed. Every default-key model attempt reserves household quota using its actual local date and explicit ANTHROPIC_DAILY_READ_LIMIT. Own keys are never substituted when a saved key cannot be read.
- Rate limits (`request_buckets`): `/api/ask` and reads per household, drafts 20 and approvals 10 a minute per household, Try it 60 new demo households an hour app-wide. PayPal toolkit calls time out after 20 s. The webhook route logs the reason for a rejection and tells anonymous callers nothing; the AI-key route caps its body at 4 KiB.
- Lint allows only `src/app/api/approve/route.ts` to import the send-capable `runTool` and `deleteSmokeDraft`.
- No server-side image or PDF processing (Workers' CPU budget); files go to Claude as uploaded.

The daily route requires `CRON_SECRET` and an explicit `CRON_HOUSEHOLD_IDS` list. It processes each configured household in its timezone, saves dated ECB cross-rate snapshots for real JPY households, closes statements and records due-date reminders. Empty configuration fails clearly. Demo FX remains fictional. A late charge confirmation and statement closing share the household lock so neither can drop or double-count the charge.

Reset, sign-in upgrade and deletion lock the household before removing its Vault key and private Storage objects. Database pointers remain when cleanup fails so a retry can finish. Storage removal is idempotent and external to the Postgres transaction; a later database rollback can leave an object already removed, and retrying cleanup handles that state.
