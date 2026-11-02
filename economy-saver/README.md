# Personal Economy Saver

A money assistant for freelancers paid across borders. The current example follows a fictional Tokyo designer whose clients pay in US dollars. Home calculates a 30-day runway from household records, highlights what needs checking, and links to an invoice review page. A user must approve before the server can send an invoice through PayPal Sandbox.

This is a private hackathon project in development. The code and local tests are available; the live Supabase/Worker connection and a real sandbox send-to-webhook round trip have not been verified. No public app or repository link is available.

## What is implemented

- A Next.js 16 app with household-scoped Postgres/Drizzle data and a fictional Ben seed.
- A deterministic runway and sentence based on stored bills, cards, charges, invoices, FX rates, and client payment history.
- Home, invoice review, To check, Activity, Cards, Clients, Settings, upload and document review screens.
- A Try it household flow, email/passwordless auth integration, per-household document intake, and confirmation before a reading changes money records.
- PayPal sandbox REST and Agent Toolkit integration. Draft/read tools are separate from the server approval path. Verified webhook deliveries are idempotent.
- MCP over Streamable HTTP. Household tools read and draft; sending remains an app approval action.
- A daily Cron route with explicit household allowlist (`CRON_HOUSEHOLD_IDS`).
- Isolated PGlite scripts for schema/seed/engine, approval and webhook behavior, MCP protocol, and reader flows. These are local tests and do not establish that hosted services are configured.

## Safety and demo status

- The application accepts only `PAYPAL_ENVIRONMENT=SANDBOX`; PayPal requests use `https://api-m.sandbox.paypal.com`.
- The server checks webhook signatures before applying a delivery. Only the verified webhook path records an invoice as paid.
- No credentials are needed for the PGlite test scripts. Keep actual settings in ignored local environment files or the owner's private service configuration. Never paste secrets into chat, screenshots, or this repository.
- Fictional seed records only. The recorded local rehearsal labels the external PayPal delivery as simulated. No live payment flow has been recorded.
- Deployment, account setup, and any public release are owner-managed steps and are not part of local setup here.

## Requirements

- Node.js 22.15 or newer and npm (the pinned Cloudflare/OpenNext build hook requires this runtime).
- A configured Supabase project for running the app against persistent data.
- PayPal Sandbox application credentials and a fictional/test client recipient for PayPal actions.

## Local setup

1. Install packages:

   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env.local` and fill only the settings required for the feature being used. The app fails clearly if a required setting is missing; there is no local database fallback. Keep `PAYPAL_ENVIRONMENT=SANDBOX`.

   Database-backed app routes need `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and `DATABASE_URL`. Use the Supabase transaction pooler connection string on port 6543 for Worker compatibility. PayPal actions additionally need `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, and `SANDBOX_CLIENT_EMAIL`. A webhook needs the private sandbox `PAYPAL_WEBHOOK_ID` after the owner has registered it.

   The default AI reader needs `ANTHROPIC_API_KEY` and a positive `ANTHROPIC_DAILY_READ_LIMIT`. Document extraction also needs `ANTHROPIC_DOCUMENT_MODEL`, `ANTHROPIC_TEXT_MODEL`, and `SUPABASE_DOCUMENT_BUCKET` naming a private Storage bucket. Forwarded email requires the owner's routing settings (`FORWARDING_DOMAIN`, `INBOUND_ADDRESS_KEY`, and `INBOUND_WORKER_SECRET`). The Cron route requires `CRON_SECRET` and `CRON_HOUSEHOLD_IDS`, a comma-separated list of household UUIDs; each run loads only those households. Refreshing the stored balance for a non-demo PayPal connection also requires `PAYPAL_BALANCE_HOUSEHOLD_ID` to select its household.

   For local Cloudflare preview, copy the needed local settings to ignored `.dev.vars`. Worker values such as PayPal, database, Cron, MCP, forwarding and reader settings are runtime bindings: the build does not package values from `.env.local`; local preview reads `.dev.vars`, and deployed Workers receive owner-managed runtime secrets/vars. The build hook checks its pinned OpenNext version and emits empty generated project-env exports so build-machine dotenv values are not embedded.

3. Apply the schema and create the fictional demo household only when using the owner's configured database:

   ```bash
   npm run db:migrate
   npm run db:seed
   ```

   The seed command prints the demo household ID only. `npm run db:vault-check` checks the owner-configured Vault connection and removes its temporary test secret.

4. Start the development server:

   ```bash
   npm run dev
   ```

   Open `http://localhost:3000`. `/api/health` reports readiness without revealing credential values.

## Local checks

These scripts use isolated PGlite test databases and simulated external results; they do not require Supabase or make PayPal calls:

```bash
npm run db:test
npm run db:approve-test
npm run db:reader-test
npm run mcp:demo
npx tsc --noEmit -p .
npm run lint
```

The approval tests use a simulated PayPal transport. They cover duplicate approvals, retry recovery, a verified-delivery input and a single balance credit. Live sandbox smoke checks are separate and require configured sandbox credentials; do not interpret a local test pass as a live transaction.

## PayPal sandbox setup

Use only an already owner-configured PayPal Developer Sandbox app and sandbox recipients. Never use live credentials. `npm run smoke` exercises sandbox token/balance/invoice permissions and creates a temporary USD draft invoice; it deletes that draft unless explicitly retained with `npm run smoke -- --keep`. `npm run webhook:register -- <approved-endpoint>` registers only against the sandbox and is an owner-managed operation. Keep the webhook ID private and set it in local settings. PayPal may cache OAuth tokens for several hours after permission changes.

## Voice and MCP

The ask panel accepts text and, where supported, browser speech recognition. It answers from the same runway data; proposed charges still wait for confirmation.

To issue household-scoped MCP tokens, set `MCP_TOKEN_KEY` to a dedicated random 32-byte key encoded as unpadded base64url, then use Settings. Keep the same private key across instances; rotating it invalidates tokens. The database stores token hashes. Connect a Streamable HTTP MCP client to `/api/mcp` with the issued token as a Bearer credential. The token supports household reads and optional invoice drafts; approval and sending stay in the app. `npm run mcp:demo` runs a finite local protocol demonstration on loopback with an isolated PGlite household and an ephemeral in-memory key.

## Project map

```text
src/app/                 pages and API routes
src/components/home/     data-backed Home and runway chart
src/components/invoices invoice review and draft UI
src/components/reader/   document upload, review and correction UI
src/db/                  schema, scoped queries, seed and transactions
src/lib/money/           pure runway, sentence and options logic
src/lib/paypal/          sandbox client, toolkit and webhook verification
src/lib/mcp/             Streamable HTTP tools
scripts/                 isolated tests and explicit owner-operated checks
drizzle/                 schema migration
```

## License

MIT. See [LICENSE](LICENSE).
