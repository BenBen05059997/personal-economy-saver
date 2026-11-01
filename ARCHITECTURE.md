# Architecture: how everything is wired

Current state only. Decisions behind it: D18, D31–D33 in [DECISIONS.md](DECISIONS.md).

## The tree

```
Clients
├── Browser (phone and desktop): the Next.js UI; voice through the browser's own speech API
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
    │   ├── /api/approve      a draft invoice or reminder → PayPal sends → events
    │   ├── /api/paypal/webhook  verify signature → webhook_deliveries → events → invoice paid
    │   ├── /api/mcp          MCP server; token → household; tools over the engine
    │   ├── /api/events       events since a time; the bell's unread list; Home polls it while something is in flight
│   ├── /api/try          Try it: anonymous session with a fresh copy of Ben's household; reset
│   ├── /api/cron         ping + reminders
    │   └── /api/household    delete my data
    └── Core (pure TypeScript, no I/O)
        ├── Runway engine (lib/money/runway.ts): series, low, safe to spend, room per card, options ladder
        ├── Sentence composer: engine output → "You're fine if … If late, ¥18,780 short on the 27th."
        ├── Reader: Claude vision → zod schema → a reading that waits for confirmation
        ├── PayPal layer: agent gets draft/read tools; send/remind tools run only from /api/approve; sandbox guard
        └── Auth + scope: request → user → household_id; every query carries it

Supabase
├── Postgres (Drizzle): households, members, users, paypal_connections, clients, invoices, bills,
│   cards, card_statements, charges, documents, readings, rules, events, webhook_deliveries,
│   api_tokens, fx_rates
├── Auth: magic-link login
└── Storage: receipt photos, PDFs, raw forwarded emails

Outside
├── Anthropic API: the user's own key (Settings, encrypted) or the owner's capped default
└── PayPal sandbox API: send invoice, send reminder; webhooks come back in
```

## Login and updates

- Email → magic link → httpOnly session cookie (30 days). **Try it** makes an anonymous session with its own copy of Ben's household, upgradable by adding an email.
- Every change is an `events` row. Rows with `notify = true` feed the bell in the top bar (unread count, list, `read_at`). Home polls `/api/events?since=` every 5 s only while an invoice is out or a bill is being read; otherwise it refreshes on focus. No email, no websockets for Nov 12; Web Push after.

## The five flows

1. **Open the app.** Page → auth → household_id → engine reads bills, cards, charges, statements, invoices, clients → sentence, safe to spend, the runway picture, the events list. No AI call on open.
2. **A bill arrives.** Forward it (Email Worker) or upload it → file to Storage, a `documents` row → reader asks Claude for `{biller, amount, due, category}` against a zod schema → a `readings` row → a "To check" row on Home → the user confirms → a `bills` row (or `charges` for a card email) → the engine recomputes → the sentence changes. A correction on the confirm card writes a `rules` row so the next read from that biller is right.
3. **Short, so get paid.** Engine finds the low point → options ladder ranked by total cost (nudge, invoice, then borrowing types) → the user taps the fix → `/api/approve` → PayPal layer runs `send_invoice` or `send_reminder` against the sandbox → `invoices.status = sent`, an `events` row → the client pays in the sandbox → PayPal posts the webhook → signature verified → `webhook_deliveries` (unique on PayPal's event id) → `invoices.status = paid`, an `events` row → Home, polling while an invoice is out, shows the new sentence.
4. **Ask or log by voice.** Browser speech → text → `/api/ask` → the engine answers "Can I afford ¥4,000 tonight?" from the same numbers; "I paid ¥3,800 on Card B" becomes a pending charge that goes through the same confirm step. Nothing is sent by voice.
5. **From a terminal.** An MCP client presents a token → `api_tokens` → household → the same engine: where am I, what's due, draft an invoice. Sending still needs the tap in the app.

## Rules the wiring enforces

- The browser is never trusted for payment state; only a verified webhook marks an invoice paid.
- The agent and the MCP server hold draft and read tools only; send tools exist in one place, `/api/approve`, behind the user's tap.
- Every table carries `household_id`; the data layer refuses a query without one.
- Money is integers in minor units with a currency; the FX rate used is stored on the row.
- `PAYPAL_ENVIRONMENT` must be `SANDBOX` or the app refuses to start.
- Keys never leave the server: AI keys encrypted at rest, shown as prefix…suffix; MCP tokens stored hashed.
- No server-side image or PDF processing (Workers' CPU budget); files go to Claude as uploaded.
