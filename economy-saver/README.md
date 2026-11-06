# Personal Economy Saver

A money assistant for people paid through PayPal. The example follows Ben, a fictional freelance designer in Tokyo whose clients pay in US dollars. Home gives a 30-day runway as one dated sentence, safe to spend, what needs checking and one PayPal action: invoice finished work or nudge a late client. The user must approve before the server sends anything through PayPal Sandbox.

This is a private hackathon project in development. Next.js dev and the local Worker render a fictional household from the Supabase project in Tokyo (`ap-northeast-1`). Not yet verified live: the deployed Worker, a live model call, magic-link delivery, Email Routing and a real PayPal sandbox send with its signed webhook.

## What is implemented

- A Next.js 16 app with household-scoped Postgres/Drizzle data and a fictional Ben seed.
- A deterministic runway and sentence from stored bills, cards, charges, invoices, FX rates and client payment history.
- Screens: Home, invoice review, To check, Activity, Cards, Clients, Plan, Options, Settings, Upload and document review, Ask (`/canvas`: the conversation and the canvas beside it) and Memory.
- A Try it household flow (with Reset to Ben's starting numbers in Settings), Start with my numbers (`/start`, also offered in Settings, posts the setup form to `/api/try/blank`: a new blank demo household that replaces any Try it one whose Home says what to add and shows First steps until a bill, a client and a card charge exist) and passwordless email sign-in.
- Typed-in data: clients, bills (optionally repeating monthly), card charges, a one-line bank balance, and invoices marked paid outside PayPal. Amounts take thousands separators and stop at ¥100,000,000 or $1,000,000; dates stop two years ahead. A mistyped bill (a monthly one as a whole series) or card charge is removed with Remove, after an in-page confirm. A refused form shows its message beside the form and keeps what you typed.
- Pots on the Plan page: money set aside for a reason, taken off the cash every runway number starts from, optionally filled by a percentage of each client payment.
- A household split: Settings → People sets each person's share, a bill or card charge can be shared, and Home shows who owes whom with Mark settled. It appears only with two or more people and does not change the runway.
- Categories and a business share: fourteen fixed categories and a Personal / Business / Mixed share on every bill and charge (proposed from the name, confirmed by you); Plan shows "Where the month goes" for the current month. Neither moves any money.
- Missing data: a bill can be saved with its amount or date not known yet; the forecast counts it at an estimate from the same name's last three real bills (the high end in the late case), says where the number came from, and To check → Missing asks only for the missing piece.
- Document intake (upload and forwarded email) with confirmation before a reading changes money records.
- Ask: the page `/canvas` (sidebar label Ask; the top bar links to it, voice where the browser supports it). `/api/ask` runs a model of your choice (D56) with tools over the engine (reads and drafts only). A reply is an answer, a clarifying question with choices to tap, or a decline for what is not about your money; code chooses which. An answer can come with a canvas: blocks that each hold a question, never a number, which the engine fills from your records, with "Show the recipe", "Based on" links and Helpful / Not helpful. "What if a client pays two weeks late?" runs the engine on a copy of your numbers and saves nothing. "Pin to Home" keeps a canvas (at most 8) under Home's sentence, drawn by the engine with no model call. A bill, receipt or card email can be attached in Ask ("Attach a bill"): the app reads it, asks what is unclear one question at a time, and adds it only when you confirm, then draws your month with it. The last 200 questions and replies are kept.
- Memory: the page `/memory` lists what the assistant remembers (each item says where it came from), and you can add, edit, delete or Forget everything. The assistant can `remember` and `forget` when you ask; a text with a run of 12 or more digits is refused. A To check card with a corrected name, category, work share or card offers "Also tell the assistant".
- Your AI model: Settings → Your AI model sets a provider (or any OpenAI-compatible address once signed in), the models and a key; Save and check runs three checks (uses tools, ignores an injected order, stays on money) and shows the host your questions go to. With no model of its own a household uses the server's `AI_` settings.
- The same tool catalogue and rules serve MCP (the server's `instructions`), except `clarify` and `out_of_scope`, which only the Ask page offers. Each Ask and each MCP call writes one content-free JSON log line to standard output.
- A family view by link: Settings → People makes a link that lasts 7 days (at most 5 live, stoppable at once; only its hash is stored, so the full link and a ready-to-paste LINE message show once). The page at `/family/<token>` needs no sign-in and has no actions: the sentence, the shared bills coming up and who owes whom. `APP_URL` sets the address in the link.
- One versioned household schema: Settings has Export my data (a version 2 JSON download: the record with the household's events, plus memory, pinned canvases and the conversation), the `household_snapshot` read tool gives the agent and MCP the record without events, and the files in `schema/` (`household.v2.json`, `recipe.v1.json`, `memory.v1.json`, `turn.v1.json`, `cash-flow-event.v1.json`) are generated from the same zod definitions.
- Your data: Settings → Your data lists five kinds (the record, memory, canvases, the conversation, documents) with where each is kept and how many there are. Memory, canvases and the conversation can be deleted all at once or one by one, and Ask has "Delete this conversation"; documents can be deleted too (confirmed bills and charges stay); "Delete everything" goes to the account page. Import reads a version 2 export into a household that has nothing in it yet (what it restores and leaves out: D44 in [DECISIONS.md](../DECISIONS.md)).
- This device only: memory, canvases and the conversation can be kept in the browser instead of our cloud (Settings → Your data). The server then holds none of it and stores nothing from a question; other devices and MCP see none of it, clearing the browser deletes it, and Import is refused while anything is kept there. Export from that device adds its items to the file (D59).
- PayPal sandbox REST and Agent Toolkit integration, with the draft/read tools separate from the server approval path; verified webhook deliveries are idempotent; a read-only import of sandbox invoice history.
- Per-household rate limits on every browser-facing route and an app-wide cap on Try it (the numbers: [ARCHITECTURE.md](../ARCHITECTURE.md)); PayPal toolkit calls time out after 20 s.
- A daily Cron route with an explicit household list (`CRON_HOUSEHOLD_IDS`). Its one standing rule is off until you set it in Settings: once a sent invoice is N days past due it records a "Nudge suggested" event and Home shows it as the one action; it never sends, the reminder still needs your tap.
- Every row and event records who made it (`made_by`); To check and Activity say "Drafted by Ask" or "Drafted through MCP" after what the agent drafted. The invoice review and the client panel show how fast a client usually pays.
- Isolated PGlite test suites (see Checks); they do not show that hosted services are configured.

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
   - **AI model (Ask and the reader), the server default:** `AI_PROTOCOL` (`anthropic` or `openai`, the OpenAI-compatible Chat Completions protocol), `AI_BASE_URL` (required for `openai`), `AI_API_KEY`, a positive `AI_DAILY_LIMIT`, `AI_TEXT_MODEL` (Ask and plain forwarded mail) and `AI_DOCUMENT_MODEL` (photos, PDFs and mail with attachments; it must accept images). A household can choose its own model in Settings instead; then it needs none of these for its own questions and documents.
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
npm run db:test      # all twenty-nine suites (listed below)
npm run schema       # rewrites the five files in schema/ from the zod definitions (db:test fails when one is stale)
npx tsc --noEmit -p .
npm run lint
```

Each suite also runs alone: `db:approve-test`, `mcp:demo`, `db:reader-test`, `db:settings-test`, `db:agent-test`, `db:ai-test`, `db:refresh-test`, `db:doors-test`, `db:import-test`, `db:csv-test`, `db:pots-test`, `db:snapshot-test`, `db:split-test`, `db:category-test`, `db:spending-test`, `db:regular-test`, `db:varies-test`, `db:gaps-test`, `db:checks-test`, `db:canvas-test`, `db:conversation-test`, `db:ask-document-test`, `db:memory-test`, `db:data-test`, `db:cron-test`, `db:sweep-test`, `db:isolation-test`, `db:family-test`. The approval tests use a simulated PayPal transport and cover duplicate approvals, retry recovery, a verified-delivery input and a single balance credit. A local pass is not a live transaction. The hand checks in a real browser, with the numbers each screen should show, are in [BROWSER-CHECKS.md](../BROWSER-CHECKS.md).

The model eval calls a real provider, so it is not part of `db:test`: `npm run model:eval -- --provider <id> --model <name> [--base-url <url>]` runs the real agent on Ben's fictional household in a throwaway database, reads the key from `EVAL_API_KEY` in `.env.local`, and prints one line per case and the `TESTED` line to add to `src/lib/ai/tested.ts`. Its graders are tested on the fake transport in `db:ai-test`.

With the app running and Supabase configured, `node scripts/frontend-check.mjs --run http://127.0.0.1:3123` times the core household workflows. `--extra` covers Upload, Options and invoice draft retries; `--guards` covers integration rejection paths. They create fictional Try it households. Results and timings are in [PLAN.md](../PLAN.md).

Cloudflare: `npm run cf:preview` builds and previews the Worker on port 8787 (reads `.dev.vars`); `npm run cf:size` builds, reports the bundle size (the limit is 64 MiB uncompressed and a startup under 1 s) and scans the Worker for credentials. Deploying (`npm run cf:deploy`) is owner-managed.

## PayPal sandbox

Use only an owner-configured PayPal Developer Sandbox app and sandbox recipients. `npm run smoke` exercises sandbox token, balance and invoice permissions and creates a temporary USD draft invoice, which it deletes unless run with `npm run smoke -- --keep`. `npm run webhook:register -- <approved-endpoint>` registers only against the sandbox and is owner-managed. Keep the webhook ID private. PayPal may cache OAuth tokens for hours after permission changes.

## Ask, voice and MCP

The Ask page accepts typed text and, where the browser supports it, speech. A character typed in the top bar's Ask box carries over to the page. The agent answers from the runway engine and can only read or draft: a spoken or typed bill, card charge, bank balance update, pot or invoice waits for confirmation (in To check, or on the invoice review page). Without a model (the server's AI settings, or the household's own) the Ask page names the missing setting.

To issue household-scoped MCP tokens, set `MCP_TOKEN_KEY`, then use Settings. Connect a Streamable HTTP MCP client to `/api/mcp` with the token as a Bearer credential. The token supports household reads and drafts (the same tools as the agent); approval and sending stay in the app. `npm run mcp:demo` runs a finite protocol demonstration on loopback with an isolated PGlite household and an in-memory key.

## Project map

```text
src/app/, src/components/   pages, API routes and UI by area
src/db/                     schema, household-scoped queries, seeds, rate limits
src/lib/                    money (the engine), agent, ai, canvas, schema, paypal, mcp, reader, catalogue
schema/                     the committed JSON Schemas (npm run schema)
scripts/                    isolated tests and explicit owner-operated checks
drizzle/                    ordered schema migrations, twenty-four files (0000–0023)
worker.ts                   Cloudflare Worker entry: the app, the daily Cron Trigger and the Email Worker handler
samples/bills/              fictional sample bills for the reader
```

The full map of files is in [AGENTS.md](../AGENTS.md), "Where things are".

## License

MIT. See [LICENSE](LICENSE).
