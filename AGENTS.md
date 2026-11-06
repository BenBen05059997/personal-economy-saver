# Agent instructions

The briefing for any coding agent working on Personal Economy Saver. The owner is Ben. Read this file, then [PLAN.md](PLAN.md) (the checklist and what exists now), [DECISIONS.md](DECISIONS.md) (what is decided and why) and [ARCHITECTURE.md](ARCHITECTURE.md) (how it is wired). The app lives in `economy-saver/` and uses Next.js 16: read `economy-saver/AGENTS.md` before writing Next.js code.

## The product in one paragraph

A personal money agent for people paid through PayPal (D2). Home is one sentence with a date and a client name — *"You're fine if Acme and Northwind pay as usual. If they're late, you're ¥18,780 short on the 27th."* — then safe to spend (including unbilled card spend), the events in date order, and one PayPal action the user approves: invoice finished work or nudge a late client. The user taps Approve, PayPal (sandbox) sends, a verified webhook marks it paid, the sentence changes. Around that loop the person asks in their own words: the agent answers from the cash-flow engine, lays the answer out on a canvas of blocks that hold queries, never numbers (D57), remembers what it is told (D58), and runs on the model the household chooses (D56). One person is on screen: Ben, a freelance designer in Tokyo paid in USD (D8). Stages 20 to 24 in PLAN.md build the canvas, memory, any model and the storage choice; their contracts there are what a builder follows.

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
10. **No fallbacks in the app.** One database (Supabase) for what the server keeps, one way to do each thing; the browser's own storage only for what a household chose to keep on this device (D59). Code that needs a setting reads it and stops with a clear error naming the missing variable; no stand-in databases, mock services, silent defaults or alternative code paths. PGlite is allowed only inside test scripts (`scripts/*-test.ts`), never imported by the app.
11. **This is Next.js 16.** APIs differ from what you may know; read `economy-saver/node_modules/next/dist/docs/` before writing Next code (see `economy-saver/AGENTS.md`). `cacheComponents` and `partialPrefetching` are on.
12. **Working agreement (D19).** Routine jobs (doc updates, running suites, timing, mechanical edits) go to Sonnet or Haiku subagents. The lead plans, reviews and handles anything touching secrets or the owner's accounts.

## Where things are

```
AGENTS.md, DECISIONS.md, PLAN.md, ARCHITECTURE.md   rules, decisions, checklist, wiring
BROWSER-CHECKS.md                        the hand checks in a real browser, with expected numbers
design/one-screen.html                   the mockup the existing screens were built from (phone and desktop; the png files are screenshots of it); Ask, the canvas and pins follow D57 and the stage contracts in PLAN.md, not this mockup
research/                                background research; read only when a decision points at it
submission/                              Devpost text and video script drafts
economy-saver/                           the app
  src/lib/money/                         the engine (runway.ts: availableCash, series, low, safeToSpend, roomOnCard, ladder, timeline…), plan (monthlyRoom, planFor for pots), split (who owes whom, D45), month (monthByCategory, D46), categories (the fourteen keys) and categorise (keyword table), repeat (monthly and yearly bills into occurrences with the amount that applies, cancel-by notices, D48), spending (D53: dated items for any range, search by name or category grouped by month, the month view is built on it; the name normaliser is `name-key.ts`), regular (D54: regular costs and what changed), varies (D54: linking a real bill to its amount-varies series), gaps (D55: `openGaps`, a bill with its amount or date not known, its estimate and the words for it), name-key (`normalise` and `nameKey`, re-exported by spending), sentence, ask, options, to-check (pure, tested; don't change maths casually); amount (how a typed amount is read, ¥100,000,000 / $1,000,000 limits), horizon (the two-year date limit), event-kinds (Activity's Type words)
  src/lib/agent/, src/lib/ai/            the in-app agent (one tool catalogue shared with MCP, the runner) and `callModel`, the one way the app calls a model (D56): two adapters of our own (`anthropic.ts` on `@anthropic-ai/sdk`, `openai.ts` on fetch for OpenAI-compatible endpoints), `checkBaseUrl` (endpoint.ts), `PROVIDERS`, `unconfirmedAmounts` (number-check.ts); settings `AI_PROTOCOL`, `AI_BASE_URL`, `AI_API_KEY`, `AI_TEXT_MODEL`, `AI_DOCUMENT_MODEL`, `AI_DAILY_LIMIT`. Agent files: `tools.ts` (the catalogue, spreads `canvasTools` and `memoryTools`), `canvas-tools.ts` (`what_if`, `make_canvas`; `clarify` and `out_of_scope` have scope `ask` and are never offered over MCP), `memory-tools.ts` (`remember`, `forget`, `recall`), `memory-prompt.ts` (`memoryContext`, 6,000 characters), `reply.ts` (code chooses answer, clarify or declined; `FIXED`, `firstUse(host)`, the "Based on" sources), `rules.ts` (`MODEL_RULES`, `ASK_RULES`), `run.ts`, `log.ts`. AI files: `check.ts` (`checkConnection`: uses_tools, ignores_injection, stays_on_money), `tested.ts` (the tested list, empty), `providers.ts`; a household's own model is `saveHouseholdConnection` and `connectionView` in `src/db/ai-key.ts`
  src/lib/canvas/, src/components/canvas/  the canvas (D57): the recipe schema, the resolver that runs a block's query through the engine, starters, words, the request helper; blocks, `Pinned.tsx` on Home; what-if maths in `src/lib/money/whatif.ts`
  src/lib/schema/memory.ts, src/db/memory.ts, src/components/memory/  what the assistant remembers (D58): the item schema, the household-scoped functions, the `/memory` page; `src/lib/reader/correction.ts` and `CorrectionOffer.tsx` (the To check card's "Also tell the assistant" box)
  src/app/canvas/, src/components/ask/   Ask (D60): the page `/canvas` (sidebar "Ask"; `AskPage.tsx`: the conversation, the canvas, thumbs, "Pin to Home"); the top bar links to `/canvas#ask` and hands a typed character over in `sessionStorage` `pes-ask-draft` (`draft.ts`). Conversation turns: `src/lib/schema/turn.ts`, `src/db/conversation.ts` (200 a household); pins: `src/db/canvases.ts` (at most 8); the question's flow: `src/db/ask.ts`
  src/lib/catalogue/, src/data/catalogue/  the wealth-move catalogue engine and its Japan and US data (secondary, D6)
  src/lib/paypal/                        sandbox REST client, toolkit wrapper (draft/send split, 20 s timeout), invoice listing, webhook signature check
  src/lib/events.ts                      applies a verified webhook delivery to the database
  src/lib/reader/, src/lib/mcp/          reader (extraction, forwarding, storage) and the MCP server; src/lib/import/csv.ts the statement CSV parser (runs in the browser, D53)
  src/lib/schema/                        the one household schema (zod `HouseholdSnapshot`, version 2: the record, plus memory, canvases and journal in the export only) and its JSON Schema generator (D44); `cash-flow.ts` is `CashFlowEvent` version 1 (the `timeline` tool's items carry `direction`)
  src/db/data-kinds.ts, restore.ts, place.ts   the five kinds of stored data (D59): `DATA_KINDS`, `countKind(s)`, `deleteKind`, `deleteOne`, `deleteTurn`, `deleteConversation`, `deleteDocument`; `restoreHousehold` (Import, into an empty household only); `place.ts` where memory, canvases and the journal are kept (`readPlaces`, `requireCloud`, `moveToDevice`, `moveToCloud`)
  src/lib/store/                         this device only (D59, browser side): `device.ts` (IndexedDB `pes-device-<householdId>`, every call in try/catch), `memory-ops.ts` and `journal-ops.ts` (the same operations as the server, on lists in hand)
  src/app/api/data/, data/move/, restore/  POST /api/data (delete_kind, delete_one, delete_conversation), /api/data/move (read, to_device, to_cloud), /api/restore (Import); the Settings → Your data components `YourData.tsx`, `DataPlace.tsx`, `ExportData.tsx`, `ImportFile.tsx`, and `DevicePins.tsx` on Home
  src/lib/session.ts, src/lib/door.ts    route helpers: household guard `householdRequest` (same-origin + session), shared response helpers; src/lib/form-fetch.ts the two headers between `ApiForm` and the routes it posts to
  src/lib/sample/ben.ts                  Ben's sample data (also the seed's source)
  src/db/                                Drizzle schema (25 tables), client, household-scoped data layer (household.ts loads the money state; pots.ts, people.ts, settle.ts, bank-balance.ts, bills.ts, charges.ts… one function per job), household clock (clock.ts), snapshot builder (snapshot.ts), rate limits, money helpers, seeds
  schema/                                the committed JSON Schemas, generated by `npm run schema`: household.v2.json, recipe.v1.json, memory.v1.json, turn.v1.json, cash-flow-event.v1.json
  src/components/                        UI by area (shell, home, household, plan, invoices, reader, settings, ask, auth, mcp, ui); ui holds the one form that posts to an `/api` route (`ApiForm`), `ConfirmRemove` and the checked inputs
  drizzle/                               twenty-three ordered migrations (0000–0022)
  scripts/                               PGlite test suites (`ai-fake.ts` is the shared fake model transport), frontend-check.mjs (HTTP suites), `model-eval-cases.ts` and `model-eval-test.ts` (the model eval, not part of `db:test`), schema generator, seed, vault-check, smoke test, Worker build
  src/app/                               pages and API routes (the route list is in ARCHITECTURE.md)
  worker.ts, wrangler.jsonc, open-next.config.ts   Cloudflare Workers build (OpenNext) with the daily Cron Trigger and the Email Worker handler
```

## Commands (run from `economy-saver/`)

| What | Command |
|---|---|
| Dev server | `npm run dev -- -p 3123` |
| Type check | `npx tsc --noEmit -p .` |
| Lint | `npm run lint` |
| Database tests (no credentials; twenty-seven suites: db, approve, mcp, reader, settings, agent, ai, refresh, doors, import, csv, pots, snapshot, split, category, spending, regular, varies, gaps, canvas, conversation, memory, data, cron, sweep, isolation, family) | `npm run db:test` |
| Regenerate the five files in `schema/` from the zod definitions (`db:snapshot-test` fails when one is stale) | `npm run schema` |
| Model eval: Ben's fictional household, the real agent, one provider and model (key from `EVAL_API_KEY` in `.env.local`; prints a line per case and the `TESTED` line to add) | `npm run model:eval -- --provider <id> --model <name> [--base-url <url>]` |
| Regenerate migration after schema edits | `npm run db:generate` (then commit the SQL with the schema) |
| Apply migrations / seed one demo household / Vault probe (owner's database) | `npm run db:migrate` / `npm run db:seed` / `npm run db:vault-check` |
| HTTP suites against a running dev server | `node scripts/frontend-check.mjs --run\|--extra\|--guards http://127.0.0.1:3123` |
| Workers build + local preview | `npm run cf:preview` (port 8787; uses `.dev.vars`) |
| Worker size | `npm run cf:size` (limit 64 MiB uncompressed and a startup under 1 s; 14,705 KiB raw, 3,825 KiB gzip on Nov 6; the gzip figure is for reference only; keep the uncompressed size and startup time in mind when adding a package) |
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
- The Workers free plan allows 10 ms CPU per request: no server-side image/PDF processing; send files to the model as uploaded (D32).
- Migration 0018 is hand-edited after `db:generate`: the UNIQUE comes before the FK that needs it, and the FK is `ON DELETE SET NULL ("series_bill_id")` (a PostgreSQL 15+ column list, so a removed series clears only the link and never `household_id`; Tokyo runs 17). Drizzle's snapshot records plain "set null", so a later `db:generate` does not diff. Keep the SQL as it is.
- `scripts/*.ts` run with `npx tsx --tsconfig ./tsconfig.json …` so `@/` paths resolve.
- `APP_URL` is a required setting (`.env.example`, `.dev.vars.example`): `http://127.0.0.1:3123` for `npm run dev -- -p 3123`, `http://localhost:8787` for the Worker preview. It must also be in the Tokyo project's Authentication redirect URLs.
- Pages are fast only in-region: keep Supabase in Tokyo (D31). A distant region adds about 0.3 s per query.
- After a schema change, restart `next dev`: a running dev server can keep an old build of an API route's `src/db` module, so a new column is read on pages but silently not written by the route.
- `next.config.ts` sets `allowedDevOrigins: ["127.0.0.1"]`. Without it `next dev` blocks its dev resources for the 127.0.0.1 origin that `APP_URL` and the HTTP suites use, and pages never hydrate (buttons do nothing).
- When an agent drives the Claude desktop app's browser pane while the pane is hidden, the page is throttled and can sit on Suspense fallbacks ("Opening …"); take a screenshot or wait, it is not an app bug. A `next dev` can get stuck in a hot-reload loop with a tab open: its log fills with `✓ Compiled in 1ms` and the same page GET dozens of times a second, the browser console repeats "[Fast Refresh] rebuilding", the 3-connection DB pool runs out and the HTTP suites time out at 30 s. It is not the app: close the tab, restart `next dev`, then reopen one tab.
- `.claude/launch.json` starts the app on port 3123 and the design mockup on port 3125.
