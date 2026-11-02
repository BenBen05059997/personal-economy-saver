# Handoff to Codex

You are taking over a solo PayPal AI Hackathon entry from Claude Code. The owner is Ben. The final submission is due the evening of **Nov 12, Tokyo**; an early version goes to Devpost by **Nov 5**. Read this file, then `PLAN.md` (the checklist you work from), `DECISIONS.md` (why things are the way they are) and `ARCHITECTURE.md` (how it is wired).

## The product in one paragraph

A money assistant for people paid through PayPal. Home is one sentence with a date and a client name — *"You're fine if Acme and Northwind pay as usual. If they're late, you're ¥18,780 short on the 27th."* — then safe to spend (including unbilled card spend), the events in date order, and one PayPal action the user approves: invoice finished work or nudge a late client. The user taps Approve, PayPal (sandbox) sends, a verified webhook marks it paid, the sentence changes. Demo person: Ben, a freelance designer in Tokyo paid in USD.

## Hard rules (never break these)

1. **PayPal sandbox only.** `src/lib/env.ts` refuses anything but `PAYPAL_ENVIRONMENT=SANDBOX`; the only host is `api-m.sandbox.paypal.com`; the toolkit is created with `sandbox: true`. Don't weaken any of it.
2. **Never print, copy into chat, or commit secret values.** `economy-saver/.env.local` and `economy-saver/.dev.vars` hold real keys; read them only through `process.env`. If you need `.dev.vars` refreshed, `cp .env.local .dev.vars` without printing.
3. **Never create accounts, log in, or deploy.** No `wrangler login`, `wrangler deploy`, `npm run cf:deploy`, `wrangler secret put`, Supabase project creation. The owner does those.
4. **Commit only when the owner asks.** The GitHub repo is private (`BenBen05059997/personal-economy-saver`); making it public needs the owner's OK. Commits use the repo-local git identity already set.
5. **Send tools live in one place.** The AI agent and the MCP server get draft and read tools only; `send_invoice` / `send_reminder` run only from the approve route after the user's tap (D12). The browser is never trusted for payment state; only a verified webhook marks an invoice paid (D15).
6. **Every query is scoped by `household_id`.** Use `src/db/household.ts`; its functions throw without a household id. Money is integer minor units plus a currency, never floats (D31).
7. **Fictional data only.** No real companies, bills or people (D20). Suggestions are information, never a named product to buy; never リボ or minimum payments (D7).
8. **Current state only in docs.** No backup copies (`.v1`, `old/`), no changelogs, no "replaced" notes. When something changes, rewrite the line in `DECISIONS.md` / `PLAN.md` in place and tick boxes in `PLAN.md` as items become true (D23).
9. **`reference/` is someone else's code.** Never edit it, import from it or commit it (it is git-ignored).
10. **No fallbacks in the app.** One database (Supabase), one way to do each thing. Code that needs a setting reads it and stops with a clear error naming the missing variable; no stand-in databases, mock services, silent defaults or alternative code paths. PGlite is allowed only inside test scripts (`scripts/*-test.ts`), never imported by the app.
11. **This is Next.js 16.** APIs differ from what you may know; read `economy-saver/node_modules/next/dist/docs/` before writing Next code (see `economy-saver/AGENTS.md`). `cacheComponents` and `partialPrefetching` are on.

## Where things are

```
DECISIONS.md, PLAN.md, ARCHITECTURE.md   decisions, checklist, wiring
design/one-screen.html                   the approved clickable mockup (phone and desktop); desk-*.png and a/b/d/e.png are screenshots
research/                                background research; read only when a decision points at it
submission/                              Devpost text and video script drafts (to be rewritten for the new screen)
economy-saver/                           the app
  src/lib/money/runway.ts                the engine: series, low, safeToSpend, roomOnCard, ladder, timeline… (pure, tested; don't change maths casually)
  src/lib/money/types.ts                 MoneyState, the engine's input
  src/lib/paypal/                        sandbox REST client, toolkit wrapper (draft/send split), webhook signature check
  src/lib/events.ts                      TEMPORARY in-memory webhook log — to be replaced (task 2)
  src/lib/sample/ben.ts                  Ben's sample data (also the seed's source)
  src/db/                                Drizzle schema (17 tables), client, household-scoped data layer, money helpers, seedBen()
  drizzle/0000_init.sql                  the one migration (nothing applied anywhere yet; regenerating it is fine)
  scripts/db-test.ts                     PGlite test of schema + seed + engine (20 checks)
  src/app/api/health, paypal/webhook, cron   existing routes
  src/components/app/                    the OLD five-tab screen on a browser reducer — to be replaced (tasks 4–7)
  worker.ts, wrangler.jsonc, open-next.config.ts   Cloudflare Workers build (OpenNext) with the daily Cron Trigger
```

## Commands (run from `economy-saver/`)

| What | Command |
|---|---|
| Dev server | `npm run dev -- -p 3123` |
| Type check | `npx tsc --noEmit -p .` |
| Lint | `npm run lint` |
| Database test (no credentials) | `npm run db:test` |
| Regenerate migration after schema edits | `npm run db:generate` (then commit the SQL with the schema) |
| Workers build + local preview | `npm run cf:preview` (port 8787; uses `.dev.vars`) |
| Worker size | `npm run cf:size` (free plan limit 3 MiB gzip; now ~1.1 MiB) |
| PayPal sandbox smoke test | `npm run smoke` |

Before calling any task done: `tsc`, `lint` and `db:test` pass, and the screen has been opened in a browser at phone width (375px) and desktop width.

## State on Nov 2

Done: schema, data layer, seed, PGlite test (20/20); Workers build runs locally with the cron; users' own AI keys will live in Supabase Vault (D33).

**Uncommitted in the working tree** (intentional, from the last Claude turn): the Vault switch (`households.ai_key_secret_id`, regenerated `drizzle/` files, `APP_ENCRYPTION_KEY` removed from the env examples), D33/V7 in `DECISIONS.md`, the new checklist in `PLAN.md`, and this file. Keep them; commit them when the owner asks.

Waiting on the owner (PLAN phase A): Supabase keys in `.env.local`, `wrangler login`, Devpost join, the forwarding domain. Task 1 needs the Supabase keys; if they aren't in yet, do task 2 first (it is tested in a script) and come back.

## Your tasks, in order

Each one is small enough to finish and check on its own. Tick the matching boxes in `PLAN.md` when done.

### 1. Connect the app to the real Supabase
Needs the owner's `SUPABASE_*` and `DATABASE_URL` in `.env.local` (check they are set without printing them). `src/db/client.ts` stays as it is: no `DATABASE_URL`, clear error. Apply the migration with `npm run db:migrate`. Add `scripts/seed.ts` and `npm run db:seed` that seeds one demo household with `seedBen(db, { isDemo: true })` and prints only its id. Check that Vault works through our connection (V7: `vault.create_secret` then read it back from `vault.decrypted_secrets`, then delete the test secret). Check the database is reachable from the Worker (V6): `npm run cf:preview` with `.dev.vars` refreshed by `cp`, and a request that reads the household. Tick V6 and V7 in `DECISIONS.md` (move them to Verified).
**Done when:** a server component on `npm run dev` calls `loadMoneyState(db(), id, "2026-11-14")` against Supabase and gets Ben's numbers, and the same works on `npm run cf:preview`.

### 2. Webhook events into Postgres
Replace `src/lib/events.ts` (in-memory, lost on restart, not shared between Workers) with the database. In `src/app/api/paypal/webhook/route.ts`: verify the signature first (unchanged), then find the household by `invoices.paypal_invoice_id`, then `recordWebhookDelivery(db, householdIdOrNull, …)` — it returns `false` for a redelivery, in which case answer 200 and do nothing. For a verified `INVOICING.INVOICE.PAID`: set the invoice `paid` with `paid_on`, and `recordEvent` with `notify: true`. Unverified deliveries are not stored. `GET` lists recent deliveries from the table (sandbox only, no payloads with personal data).
**Done when:** a PGlite test (extend `scripts/db-test.ts` or add `scripts/webhook-test.ts`, faking the verify step) shows paid → invoice paid + one notify event, and the same event id twice → one row, one event.

### 3. Try it: a household per visitor (no login yet)
Magic-link login needs Supabase, so ship Try it first (D34). `GET /api/try`: create a household with `seedBen(db, { isDemo: true })`, set an httpOnly, SameSite=Lax, Secure-in-production cookie `household` with its uuid (unguessable), redirect to `/`. A server helper `currentHouseholdId()` reads the cookie and checks the household exists; with no cookie the landing page shows one **Try it** button. `POST /api/try/reset` (demo households only) deletes the household and makes a fresh one. Mutating routes check the `Origin` header (D37).
**Done when:** two browsers get two different households, reset works, and a non-demo household can't be reset.

### 4. The new shell from the approved mockup
Rebuild the UI to match `design/one-screen.html` (open it in a browser; the "View phone · desktop" switch shows both). Desktop (D25): left sidebar ~230px (Home, To check with a count badge, Activity, Cards, Clients; Settings and the person at the bottom), top bar 56px with the ask field + mic and one **Add** button, **plus a bell with an unread count** (D35, not in the mockup yet). Phone: the single column from the mockup. Keep the mockup's type: Newsreader for the sentence and big numbers, Hanken Grotesk for UI; warm paper background, one cobalt accent, light and dark themes. Server components read the household through `currentHouseholdId()` + `src/db/household.ts`. No tabs, no persona switch, no demo buttons on screen (D8, D25).
**Done when:** the shell renders at 375px and 1440px in both themes with real data from the local database.

### 5. Home on real data
Home = the sentence as the heading, the action row led by the fix (e.g. "Invoice Beacon $400"), then four panels: next 30 days (safe to spend with "includes ¥X on Card B not yet billed", and the runway line), To check, Cards (Covered ✓), Coming up. Put the sentence logic in a pure function (e.g. `src/lib/money/sentence.ts`) taking the engine's output, with a small test. **Numbers come from the engine only** — the mockup has a few figures that don't reconcile (its "¥59,100 after PayPal's fee" is not modelled anywhere); where the mockup and the engine disagree, the engine wins and the fee line is dropped until a fee is modelled.
**Done when:** Ben's seeded household shows "¥18,780 short on the 27th", confirming the Hikari Denki bill changes it to ¥30,000, and both come from the database.

### 6. Bell, Activity, To check, Cards, Clients
`/api/events?since=` returns the household's events; the bell shows unread `notify` events and marks them read; Home polls every 5 s only while an invoice is out or a bill is being read, otherwise refreshes on focus (D35). Activity is a full-width table of `events`. To check confirms pending bills and charges. Cards and Clients are lists; a row opens a ~420px right-hand panel with its own URL (D25).

### 7. Approve → PayPal → paid
An invoice page (its own page, per the mockup state C): To, For, Due, Amount (USD with ≈ yen), Note, "Approve and send". `POST /api/approve` with the invoice's `approve_key` (idempotent: a second call does nothing) → create and send the invoice through `runTool` in the PayPal **sandbox** (`src/lib/paypal/toolkit.ts`; `SANDBOX_CLIENT_EMAIL` is the client) → store `paypal_invoice_id`, status `sent`, an event. The paid step arrives through task 2's webhook once deployed; locally, the owner can pay in the sandbox and you can replay. Then remove the old five-tab screen, `src/components/app/state.ts`'s reducer and the persona switch.
**Done when:** approving in the local app creates a real sandbox invoice (visible on the sandbox), a double click sends once, and the old screen is gone.

### After that: build everything else in `PLAN.md`
Keep going in order through every phase (B's code parts, E: the reader, F: voice and MCP, G: options and household, H: own AI key via Vault, I: final). Write the code for each phase even when it can't be switched on yet: it reads the settings it needs and stops with a clear error when one is missing (rule 10). Test it in a script on PGlite or against the PayPal sandbox where you can.

Stop and ask the owner only at these gates, then carry on with whatever doesn't depend on the answer:
- **Design review after task 5.** Show the owner the shell and Home at phone and desktop width before building tasks 6–7. The screen is where earlier versions went wrong.
- **Anything needing the owner's account or keys:** Supabase keys (everything after that, including migrating, you can run), Cloudflare (deploy, `wrangler secret put`, Email Routing), Devpost.
- **Anything public or outward:** making the repo public, the deploy, the submission.
- **Commits:** whenever a phase is done and checked, ask whether to commit.

## Gotchas already found

- `opennextjs-cloudflare` needs the read-only **static-assets incremental cache** (`open-next.config.ts`); the default dummy cache hangs the prerendered home page. It means `revalidateTag` / `revalidatePath` don't persist on Workers yet.
- `worker.ts` uses `@ts-ignore` (with an eslint exception) on imports from `.open-next/`, which exists only after a Workers build; `@ts-expect-error` would break once it exists. Don't run `wrangler types` (its `worker-configuration.d.ts` clashes with DOM types).
- postgres.js on Workers: `prepare: false`, the Supabase **transaction pooler** (port 6543), small `max`. Not yet tested against a real Supabase (V6).
- The Workers free plan allows 10 ms CPU per request: no server-side image/PDF processing; send files to Claude as uploaded (D32).
- `scripts/*.ts` run with `npx tsx --tsconfig ./tsconfig.json …` so `@/` paths resolve.
- `src/components/app/Activity.tsx` labels any non-receipt charge "Card email"; voice/manual charges now exist (`types.ts`). It's on the old screen, which task 7 deletes.
- The Claude preview config in `.claude/launch.json` runs the app on port 3123 and the mockup on 3125; you can ignore it.
