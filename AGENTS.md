# Agent instructions

The briefing for any coding agent working on Personal Economy Saver. The owner is Ben. Read this file, then [PLAN.md](PLAN.md) (the checklist and what exists now), [DECISIONS.md](DECISIONS.md) (what is decided and why) and [ARCHITECTURE.md](ARCHITECTURE.md) (how it is wired). The app lives in `economy-saver/` and uses Next.js 16: read `economy-saver/AGENTS.md` before writing Next.js code.

## The product in one paragraph

A money assistant for people paid through PayPal. Home is one sentence with a date and a client name — *"You're fine if Acme and Northwind pay as usual. If they're late, you're ¥18,780 short on the 27th."* — then safe to spend (including unbilled card spend), the events in date order, and one PayPal action the user approves: invoice finished work or nudge a late client. The user taps Approve, PayPal (sandbox) sends, a verified webhook marks it paid, the sentence changes. One person is on screen: Ben, a freelance designer in Tokyo paid in USD (D8).

## Hard rules (never break these)

1. **PayPal sandbox only.** `src/lib/env.ts` refuses anything but `PAYPAL_ENVIRONMENT=SANDBOX`; the only host is `api-m.sandbox.paypal.com`; the toolkit is created with `sandbox: true`. Don't weaken any of it.
2. **Never print, copy into chat, or commit secret values.** `economy-saver/.env.local` and `economy-saver/.dev.vars` hold real keys; read them only through `process.env`. If you need `.dev.vars` refreshed, `cp .env.local .dev.vars` without printing.
3. **Never create accounts, log in, or deploy.** No `wrangler login`, `wrangler deploy`, `npm run cf:deploy`, `wrangler secret put`, Supabase project creation. The owner does those.
4. **Commit only when the owner asks.** The GitHub repo is private (`BenBen05059997/personal-economy-saver`); making it public needs the owner's OK. Commits use the repo-local git identity already set.
5. **Send tools live in one place.** The AI agent and the MCP server get draft and read tools only; `send_invoice` / `send_invoice_reminder` run only from the approve route after the user's tap (D12); lint fails any other import of `runTool` or `deleteSmokeDraft`. The browser is never trusted for payment state; only a verified webhook marks an invoice paid (D15).
6. **Every query is scoped by `household_id`.** Use `src/db/household.ts`; its functions throw without a household id. Money is integer minor units plus a currency, never floats (D31).
7. **Fictional data only.** No real companies, bills or people (D20). Suggestions are information, never a named product to buy; never リボ or minimum payments (D7).
8. **Current state only in docs.** No backup copies (`.v1`, `old/`), no changelogs, no "replaced" notes. When something changes, rewrite the line in `DECISIONS.md` / `PLAN.md` in place, tick boxes in `PLAN.md` as items become true, and do it in the same turn as the change (D23).
9. **`reference/` is someone else's code.** Never edit it, import from it or commit it (it is git-ignored).
10. **No fallbacks in the app.** One database (Supabase), one way to do each thing. Code that needs a setting reads it and stops with a clear error naming the missing variable; no stand-in databases, mock services, silent defaults or alternative code paths. PGlite is allowed only inside test scripts (`scripts/*-test.ts`), never imported by the app.
11. **This is Next.js 16.** APIs differ from what you may know; read `economy-saver/node_modules/next/dist/docs/` before writing Next code (see `economy-saver/AGENTS.md`). `cacheComponents` and `partialPrefetching` are on.
12. **Working agreement (D19).** Routine jobs (doc updates, running suites, timing, mechanical edits) go to Sonnet or Haiku subagents. The lead plans, reviews and handles anything touching secrets or the owner's accounts.

## Where things are

```
AGENTS.md, DECISIONS.md, PLAN.md, ARCHITECTURE.md   rules, decisions, checklist, wiring
BROWSER-CHECKS.md                        the hand checks in a real browser, with expected numbers
design/one-screen.html                   the approved clickable mockup (phone and desktop); the png files are screenshots of it
research/                                background research; read only when a decision points at it
submission/                              Devpost text and video script drafts
economy-saver/                           the app
  src/lib/money/                         the engine (runway.ts: availableCash, series, low, safeToSpend, roomOnCard, ladder, timeline…), plan (monthlyRoom, planFor for pots), split (who owes whom, D45), repeat (monthly bills into occurrences), sentence, ask, options, to-check (pure, tested; don't change maths casually)
  src/lib/agent/, src/lib/anthropic.ts   the in-app agent (one tool catalogue shared with MCP, the runner) and the one way the app calls Claude
  src/lib/catalogue/, src/data/catalogue/  the wealth-move catalogue engine and its Japan and US data (secondary, D6)
  src/lib/paypal/                        sandbox REST client, toolkit wrapper (draft/send split, 20 s timeout), invoice listing, webhook signature check
  src/lib/events.ts                      applies a verified webhook delivery to the database
  src/lib/reader/, src/lib/mcp/          reader (extraction, forwarding, storage) and the MCP server
  src/lib/schema/                        the one household schema (zod `HouseholdSnapshot`, version 1) and its JSON Schema generator (D44)
  src/lib/session.ts, src/lib/door.ts    route helpers: household guard `householdRequest` (same-origin + session), shared response helpers
  src/lib/sample/ben.ts                  Ben's sample data (also the seed's source)
  src/db/                                Drizzle schema (21 tables), client, household-scoped data layer (household.ts loads the money state; pots.ts, people.ts, settle.ts, bank-balance.ts, bills.ts, charges.ts… one function per job), household clock (clock.ts), snapshot builder (snapshot.ts), rate limits, money helpers, seeds
  schema/household.v1.json               the committed JSON Schema, generated by `npm run schema`
  src/components/                        UI by area (shell, home, household, plan, invoices, reader, settings, ask, auth, mcp, ui)
  drizzle/                               twelve ordered migrations (0000–0011)
  scripts/                               PGlite test suites, frontend-check.mjs (HTTP suites), schema generator, seed, vault-check, smoke test, Worker build
  src/app/                               pages and API routes (the route list is in ARCHITECTURE.md)
  worker.ts, wrangler.jsonc, open-next.config.ts   Cloudflare Workers build (OpenNext) with the daily Cron Trigger and the Email Worker handler
```

## Commands (run from `economy-saver/`)

| What | Command |
|---|---|
| Dev server | `npm run dev -- -p 3123` |
| Type check | `npx tsc --noEmit -p .` |
| Lint | `npm run lint` |
| Database tests (no credentials; twelve suites: db, approve, mcp, reader, settings, agent, refresh, doors, import, pots, snapshot, split) | `npm run db:test` |
| Regenerate `schema/household.v1.json` from the zod definition (`db:snapshot-test` fails when it is stale) | `npm run schema` |
| Regenerate migration after schema edits | `npm run db:generate` (then commit the SQL with the schema) |
| Apply migrations / seed one demo household / Vault probe (owner's database) | `npm run db:migrate` / `npm run db:seed` / `npm run db:vault-check` |
| HTTP suites against a running dev server | `node scripts/frontend-check.mjs --run\|--extra\|--guards http://127.0.0.1:3123` |
| Workers build + local preview | `npm run cf:preview` (port 8787; uses `.dev.vars`) |
| Worker size | `npm run cf:size` (free plan limit 3 MiB gzip; 2,674 KiB on the last dry run) |
| PayPal sandbox smoke test | `npm run smoke` |

Before calling any task done: `tsc`, `lint` and `db:test` pass, and the screens it touches pass their checks in [BROWSER-CHECKS.md](BROWSER-CHECKS.md) at phone width (375px) and desktop width.

## How to continue

Work from the unchecked boxes in `PLAN.md`. Stop and ask the owner only at these gates, then carry on with whatever doesn't depend on the answer:
- **Anything needing the owner's account or keys:** Supabase dashboard settings, Cloudflare (deploy, `wrangler secret put`, Email Routing), Devpost.
- **Anything public or outward:** making the repo public, the deploy, the submission.
- **Commits:** whenever a phase is done and checked, ask whether to commit.

## Gotchas

- `opennextjs-cloudflare` needs the read-only **static-assets incremental cache** (`open-next.config.ts`); the default dummy cache hangs the prerendered home page. It means `revalidateTag` / `revalidatePath` don't persist on Workers yet.
- `worker.ts` uses `@ts-ignore` (with an eslint exception) on imports from `.open-next/`, which exists only after a Workers build; `@ts-expect-error` would break once it exists. Don't run `wrangler types` (its `worker-configuration.d.ts` clashes with DOM types).
- postgres.js on Workers: `prepare: false`, the Supabase **transaction pooler** (port 6543), small `max`.
- The Workers free plan allows 10 ms CPU per request: no server-side image/PDF processing; send files to Claude as uploaded (D32).
- `scripts/*.ts` run with `npx tsx --tsconfig ./tsconfig.json …` so `@/` paths resolve.
- `APP_URL` is a required setting (`.env.example`, `.dev.vars.example`): `http://127.0.0.1:3123` for `npm run dev -- -p 3123`, `http://localhost:8787` for the Worker preview. It must also be in the Tokyo project's Authentication redirect URLs.
- Pages are fast only in-region: keep Supabase in Tokyo (D31). A distant region adds about 0.3 s per query.
- After a schema change, restart `next dev`: a running dev server can keep an old build of an API route's `src/db` module, so a new column is read on pages but silently not written by the route.
- `next.config.ts` sets `allowedDevOrigins: ["127.0.0.1"]`. Without it `next dev` blocks its dev resources for the 127.0.0.1 origin that `APP_URL` and the HTTP suites use, and pages never hydrate (buttons do nothing).
- When an agent drives the Claude desktop app's browser pane while the pane is hidden, the page is throttled and can sit on Suspense fallbacks ("Opening …"); take a screenshot or wait, it is not an app bug. A `next dev` can get stuck in a hot-reload loop with a tab open: its log fills with `✓ Compiled in 1ms` and the same page GET dozens of times a second, the browser console repeats "[Fast Refresh] rebuilding", the 3-connection DB pool runs out and the HTTP suites time out at 30 s. It is not the app: close the tab, restart `next dev`, then reopen one tab.
- `.claude/launch.json` starts the app on port 3123 and the design mockup on port 3125.
