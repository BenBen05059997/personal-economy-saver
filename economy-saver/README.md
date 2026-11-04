# Personal Economy Saver

A money assistant for people paid through PayPal. The example follows Ben, a fictional freelance designer in Tokyo whose clients pay in US dollars. Home gives a 30-day runway as one dated sentence, safe to spend, what needs checking and one PayPal action: invoice finished work or nudge a late client. The user must approve before the server sends anything through PayPal Sandbox.

This is a private hackathon project in development. Next.js dev and the local Worker render a fictional household from the Supabase project in Tokyo (`ap-northeast-1`). Not yet verified live: the deployed Worker, a Claude call, magic-link delivery, Email Routing and a real PayPal sandbox send with its signed webhook.

## What is implemented

- A Next.js 16 app with household-scoped Postgres/Drizzle data and a fictional Ben seed.
- A deterministic runway and sentence from stored bills, cards, charges, invoices, FX rates and client payment history.
- Screens: Home, invoice review, To check, Activity, Cards, Clients, Plan, Options, Settings, Upload and document review.
- A Try it household flow (with Reset to Ben's starting numbers in Settings), Start with my numbers (`/start`, also offered in Settings, posts the setup form to `/api/try/blank`: a new blank demo household that replaces any Try it one whose Home says what to add and shows First steps until a bill, a client and a card charge exist) and passwordless email sign-in.
- Typed-in data: clients, bills (optionally repeating monthly), card charges, a one-line bank balance, and invoices marked paid outside PayPal. Amounts take thousands separators and stop at ¥100,000,000 or $1,000,000; dates stop two years ahead. A mistyped bill (a monthly one as a whole series) or card charge is removed with Remove, after an in-page confirm. A refused form shows its message beside the form and keeps what you typed.
- Pots on the Plan page: money set aside for a reason, taken off the cash every runway number starts from, optionally filled by a percentage of each client payment.
- A household split: Settings → People sets each person's share, a bill or card charge can be shared, and Home shows who owes whom with Mark settled. It appears only with two or more people and does not change the runway.
- Categories and a business share: thirteen fixed categories and a Personal / Business / Mixed share on every bill and charge (proposed from the name, confirmed by you); Plan shows "Where the month goes" for the current month. Neither moves any money.
- Document intake (upload and forwarded email) with confirmation before a reading changes money records.
- An in-app agent: `/api/ask` runs Claude with tools over the engine (reads and drafts only). The same tool catalogue serves MCP.
- One versioned household schema: Settings has Export my data (a JSON download with the household's events), the `household_snapshot` read tool gives the agent and MCP the same picture without events, and `schema/household.v1.json` is generated from the same definition.
- PayPal sandbox REST and Agent Toolkit integration, with the draft/read tools separate from the server approval path; verified webhook deliveries are idempotent; a read-only import of sandbox invoice history.
- Rate limits on Try it, Ask, MCP, drafts, approvals, uploads, document reads, imports and exports; PayPal toolkit calls time out after 20 s.
- A daily Cron route with an explicit household list (`CRON_HOUSEHOLD_IDS`).
- Isolated PGlite test suites for schema/seed/engine, approval and webhook behaviour, MCP, reader, settings, agent, PayPal refresh, typed-in data, import, pots, the household snapshot, the household split and the categories with the business share. They do not show that hosted services are configured.

## Safety

- The app accepts only `PAYPAL_ENVIRONMENT=SANDBOX`; PayPal requests go to `https://api-m.sandbox.paypal.com`.
- The server checks webhook signatures before applying a delivery. Only the verified webhook records a PayPal-sent invoice as paid.
- Lint allows only `src/app/api/approve/route.ts` to import the send-capable PayPal tool functions.
- Keep real settings in ignored local environment files or the owner's private service configuration. Never paste secrets into chat, screenshots or this repository.
- Seed records are fictional. Deployment, account setup and any public release are owner-managed.

## Requirements

- Node.js 22.15 or newer and npm (the pinned Cloudflare/OpenNext build hook requires it).
- A configured Supabase project for running the app against persistent data.
- PayPal Sandbox application credentials and a fictional/test client recipient for PayPal actions.

## Local setup

1. Install packages:

   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env.local` and fill only the settings the feature needs. The app fails clearly when a required setting is missing; there is no local database fallback. Keep `PAYPAL_ENVIRONMENT=SANDBOX`.

   - **Database-backed routes:** `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL` (the transaction pooler string, port 6543) and `APP_URL`. Sign-in links return to `APP_URL` (never to the request's Origin header), and it must be listed under the project's Authentication → URL Configuration. Locally it is `http://127.0.0.1:3123`; in the Worker preview `http://localhost:8787`.
   - **PayPal actions:** `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `SANDBOX_CLIENT_EMAIL`. A webhook also needs `PAYPAL_WEBHOOK_ID` once the owner has registered it. Refreshing the stored balance and importing invoice history for a non-demo household need `PAYPAL_BALANCE_HOUSEHOLD_ID`.
   - **Claude (Ask and the reader):** `ANTHROPIC_API_KEY`, a positive `ANTHROPIC_DAILY_READ_LIMIT`, `ANTHROPIC_TEXT_MODEL` (Ask and plain forwarded mail) and `ANTHROPIC_DOCUMENT_MODEL` (photos, PDFs and mail with attachments).
   - **Reader storage and forwarding:** `SUPABASE_DOCUMENT_BUCKET` (a private bucket; `household-documents` on the Tokyo project), `FORWARDING_DOMAIN`, `INBOUND_ADDRESS_KEY`, `INBOUND_WORKER_SECRET`.
   - **MCP tokens:** `MCP_TOKEN_KEY`, a dedicated random 32-byte key as unpadded base64url. Keep the same key across instances; rotating it invalidates tokens.
   - **Cron:** `CRON_SECRET` and `CRON_HOUSEHOLD_IDS` (comma-separated household UUIDs).

   For the local Cloudflare preview, copy the needed settings to the ignored `.dev.vars`. Worker values are runtime bindings: the build does not package values from `.env.local`; local preview reads `.dev.vars` and deployed Workers get owner-managed secrets. The build hook checks its pinned OpenNext version and emits empty generated project-env exports so build-machine dotenv values are not embedded.

3. Apply the schema and create the fictional demo household, only against the owner's configured database:

   ```bash
   npm run db:migrate
   npm run db:seed
   ```

   The seed prints the demo household ID only. `npm run db:vault-check` checks the Vault connection and removes its temporary test secret.

4. Start the development server:

   ```bash
   npm run dev -- -p 3123
   ```

   Open `http://127.0.0.1:3123`. `/api/health` reports readiness without revealing values.

## Checks

These use isolated PGlite databases and simulated external results; they need no Supabase credentials and make no PayPal calls:

```bash
npm run db:test      # all fourteen suites: db, approve, mcp, reader, settings, agent, refresh, doors, import, pots, snapshot, split, category, isolation
npm run schema       # rewrites schema/household.v1.json from the zod definition (db:test fails when it is stale)
npx tsc --noEmit -p .
npm run lint
```

Each suite also runs alone: `db:approve-test`, `mcp:demo`, `db:reader-test`, `db:settings-test`, `db:agent-test`, `db:refresh-test`, `db:doors-test`, `db:import-test`, `db:pots-test`, `db:snapshot-test`, `db:split-test`, `db:category-test`. The approval tests use a simulated PayPal transport and cover duplicate approvals, retry recovery, a verified-delivery input and a single balance credit. A local pass is not a live transaction. The hand checks in a real browser, with the numbers each screen should show, are in [BROWSER-CHECKS.md](../BROWSER-CHECKS.md).

With the app running and Supabase configured, `node scripts/frontend-check.mjs --run http://127.0.0.1:3123` times the core household workflows. `--extra` covers Upload, Options and invoice draft retries; `--guards` covers integration rejection paths. They create fictional Try it households. Results and timings are in [PLAN.md](../PLAN.md).

Cloudflare: `npm run cf:preview` builds and previews the Worker on port 8787 (reads `.dev.vars`); `npm run cf:size` builds, reports the bundle size (the free plan's limit is 3 MiB gzip) and scans the Worker for credentials. Deploying (`npm run cf:deploy`) is owner-managed.

## PayPal sandbox

Use only an owner-configured PayPal Developer Sandbox app and sandbox recipients. `npm run smoke` exercises sandbox token, balance and invoice permissions and creates a temporary USD draft invoice, which it deletes unless run with `npm run smoke -- --keep`. `npm run webhook:register -- <approved-endpoint>` registers only against the sandbox and is owner-managed. Keep the webhook ID private. PayPal may cache OAuth tokens for hours after permission changes.

## Ask, voice and MCP

The Ask panel accepts typed text and, where the browser supports it, speech. The agent answers from the runway engine and can only read or draft: a spoken or typed bill, card charge, bank balance update, pot or invoice waits for confirmation (in To check, or on the invoice review page). Without the Anthropic settings Ask shows a clear missing-setting error.

To issue household-scoped MCP tokens, set `MCP_TOKEN_KEY`, then use Settings. Connect a Streamable HTTP MCP client to `/api/mcp` with the token as a Bearer credential. The token supports household reads and drafts (the same tools as the agent); approval and sending stay in the app. `npm run mcp:demo` runs a finite protocol demonstration on loopback with an isolated PGlite household and an in-memory key.

## Project map

```text
src/app/                 pages and API routes
src/components/          UI by area: shell, home, household, plan, invoices, reader, settings, ask, auth, mcp, ui
src/db/                  schema, household-scoped queries, seeds, rate limits
src/lib/money/           pure runway, plans, repeating bills, sentence and options logic
src/lib/agent/           the tool catalogue and the Claude runner
src/lib/schema/          the one household schema (zod) and its JSON Schema generator
schema/                  household.v1.json, the committed JSON Schema
src/lib/paypal/          sandbox client, toolkit, invoice listing and webhook verification
src/lib/mcp/             Streamable HTTP server
src/lib/catalogue/       the wealth-move catalogue engine (words and sources in src/data/catalogue/)
src/lib/reader/          extraction, forwarding, storage
scripts/                 isolated tests and explicit owner-operated checks
drizzle/                 ordered schema migrations, fourteen files (0000–0013)
worker.ts                Cloudflare Worker entry: the app, the daily Cron Trigger and the Email Worker handler
samples/bills/           fictional sample bills for the reader
```

## License

MIT. See [LICENSE](LICENSE).
