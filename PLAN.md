# Personal Economy Saver: plan

**Submit the evening of Nov 12, Tokyo** (closes Nov 13 05:00 Tokyo; the dates: D1, D30). What the product is and why: [DECISIONS.md](DECISIONS.md) (D2, D3). The hard rules: [AGENTS.md](AGENTS.md). Tick a box the moment it is true. Owner = Ben; implementation by subagents, reviewed by the lead (D19).

## What exists now

- **Foundation (D31–D37).** The Supabase project in Tokyo has migrations 0000–0023 applied (25 tables, listed in [ARCHITECTURE.md](ARCHITECTURE.md)); one fictional Ben household seeded, Vault create/read/delete passing, the private Storage bucket `household-documents` verified (a test object was refused to the publishable key and its public URL), no readable rows in `households` for the publishable key. The app builds as a Cloudflare Worker through OpenNext (its size and the limits: box S below) with the daily Cron Trigger; the local Worker preview renders the Tokyo household.
- **Screens (D25).** Shell with sidebar, top bar (Ask, bell, Add) and phone layout; Home (sentence, actions, pinned canvases, safe to spend, runway, To check, Cards, Coming up); Ask (`/canvas`); Memory; To check; Activity; Cards and Clients with a right-hand panel; Plan; invoice review; Upload; Options; Settings; Privacy. Checked at 375px and 1440px, light and dark.
- **Sessions (D34).** Try it makes an anonymous fictional household with a protected cookie and a demo-only reset, anchored at Nov 14, 2026. Magic-link routes, session refresh, scoped membership and onboarding are implemented and tested on PGlite; a real magic link is not verified yet.
- **PayPal (D12–D15, D37).** Sandbox guard, REST client, toolkit split (the agent drafts, the approve route sends), invoice review and approve/send/remind, verified webhook persisted in Postgres, scoped refresh with a five-minute cooldown, `npm run smoke`, read-only history import (`/api/paypal/import`, built and tested, not run live). A real sandbox send and paid webhook have not run on a deployed URL.
- **Typed-in doors (D39) and forms.** Clients, bills, card charges, the one-line bank balance, invoices marked paid outside PayPal and Remove for a bill or charge work end to end in the browser. Every form that posts to an `/api` route is the one client form `ApiForm` (how it behaves: ARCHITECTURE.md, API routes).
- **In-app agent and MCP (D40, D27).** One tool catalogue, `src/lib/agent/tools.ts` (the tools are listed in ARCHITECTURE.md, flow 4; the plural draft tools take 1–10 items in one transaction). `/api/ask` and the MCP server share it and the rules text in `rules.ts`; `scripts/agent-test.ts` runs the agent with the fake transport `scripts/ai-fake.ts` on both protocols; no call on a provider's own API has run (the dev-only Codex bridge, `economy-saver/README.md`, has rehearsed the AI path). With no model set up, Ask names the first missing setting ("Ask isn’t available on this server yet (AI_TEXT_MODEL)." when none is set)
- **Planning and money views.** Pots (D43): `/plan` adds, edits and removes them, Home shows one line each, `availableCash` takes them off the cash every number starts from, and a client payment fills them; Ben has no pots, so his numbers are unchanged. Categories and the business share (D46), Where the month goes, search, history and the statement CSV import (D53), Regular costs and amount-varies bills (D54), missing data and `openGaps` (D55), yearly bills, amount changes and cancel-by dates (D41), the household split (D45) and the family link (D52) are built and tested; their pages and words are in [BROWSER-CHECKS.md](BROWSER-CHECKS.md) (M, S, T, U, V).
- **One household schema (D44) and Your data (D59).** `HouseholdSnapshot` version 2 and its five JSON Schemas in `schema/` (`npm run schema`), Export my data, Import into an empty household, the five kinds with one set of operations, and the move to this device only (migration 0022). The `/memory` page reads and edits device items when memory is on the device.
- **Reader (D10, D36).** Photo/PDF upload and forwarded mail go to private Storage; the document model reads in the background; To check shows the reading; confirmation creates a bill or charge; corrections become rules; file cleanup on reset, upgrade and deletion. The Worker email handler and `/api/inbound` are implemented. A live model call and Email Routing are not verified.
- **Any model (D56, D33).** `callModel` in `src/lib/ai/` is the one way the app calls a model (Anthropic Messages and OpenAI-compatible adapters). Settings → Your AI model sets a provider, models and a key in Vault; saving runs `checkConnection` and refuses only a model that does not call tools. `TESTED` in `src/lib/ai/tested.ts` is empty until the eval (box E) runs on a real provider, so every model reads "Custom, untested · passed n of 3 checks". `npm run model:eval` is built (cases and graders tested on the fake transport). No call on a provider's own API yet.
- **Canvas, Ask, memory (D57, D58, D60).** The canvas and what-if, Ask with its three reply kinds, follow-ups, thumbs and pins on Home, memory in the agent and the correction offer on a review card are built; HTTP steps and the browser walk W–Z are in the open boxes below.
- **Here's my bill (D61, D41, D60).** A last payment on a repeating bill (migration 0023), the five checks in code and the read tool `to_check`, and Ask's "Attach a bill" with a card drawn by code, a Confirm that waits for an asked check and a canvas that rings the new bill (Stage 25 below; wiring: ARCHITECTURE.md, flows 2 and 4). Browser checks AB, AC and AD1–AD3 are walked; reading with a real model (AD4) is not, for want of a key.
- **A normal user's first week (D47).** "Start with my numbers" on the landing and in Settings, the empty sentence, First steps, empty panels that say what to do next; Try it households say they are fictional.
- **Traceable agent work and a nudge rule (D50).** `made_by` on every row and event, client pace, the daily `nudge_suggested` event (setting off by default), one content-free log line per Ask and MCP call.
- **Catalogue (D6).** Japan 20 moves and US 16 in `src/lib/catalogue/` and `src/data/catalogue/`; nothing calls it until households have a profile.
- **Known and left as is.** Options links to the rate references behind "Reference & assumptions" (D7); Settings says email forwarding isn’t available on this server until `FORWARDING_DOMAIN` is set (rule 10); the bell keeps an unread notice after its bill is confirmed; a refused AI key clears its field; slow first loads on dev.
- **Checks.** `tsc` and lint are clean; `npm run db:test` runs thirty-two PGlite suites, including the tenant-isolation suite (`db:isolation-test`: two households, every exported function in `src/db` called across the boundary in both directions, a coverage guard that fails when a new export is neither tested nor listed as not applicable with a reason); the three HTTP suites (`scripts/frontend-check.mjs`) pass on dev against Tokyo (last run Nov 6, on the Stage 25 step 2 code: 106, 37 and 39 checks; every suite run creates demo households, so they share Try it's 60-an-hour creation limit and `--extra` answers 429 at `create-fictional-session` once it is spent; the Ask check accepts the 503 missing-setting error); the local Worker preview last passed before the export step was added. An independent security review of the build and its fixes (D12, D37) passed.
- **Submission files.** `submission/DEVPOST.md` and `submission/VIDEO-SCRIPT.md` are private current-state drafts. The code is MIT-licensed; the bundled Hanken Grotesk and Newsreader fonts carry SIL OFL 1.1 notices. Fictional samples (bills, a card-statement email, a 国保 slip, a US power bill) are in `economy-saver/samples/bills/`.

### Timings (latest measurement, Nov 3)

Warm single HTTP request through the complete response body on the same demo household, excluding browser rendering; a range is the spread over repeated runs. "First Home" is the first visit in a fresh session. Actions not listed were not timed on Tokyo.

| Action or page | `next dev` on Tokyo (s) | Local Worker on Tokyo (s) |
|---|---:|---:|
| Try it (create session) | 0.63–0.86 | 0.87 |
| First Home | 0.87 | 1.03–1.06 |
| Warm Home | 0.77–0.82 | 0.96–1.08 |
| Cards | 1.09 | |
| Clients | 1.13 | |
| Activity | 0.44–0.47 | 0.57–0.59 |
| Invoice review (read only) | 1.15 | |
| To check | 0.72–0.78 | |
| Confirm Hikari Denki | 0.94 | 1.04 |
| Settings (open) | 0.58–0.62 | 0.72–0.75 |
| Save Settings | | 1.10 |
| Ask with a canvas (answer ≤ 8 s, needs a live model) | not measured | not measured |
| Home with pinned canvases (no model call) | not measured | not measured |


## To Nov 12: days, cut lines, what waits on whom

The submission closes Nov 12, 12:00 pm PST (Nov 13, 05:00 Tokyo). Feature freeze is Tue Nov 10, 18:00 Tokyo; after it only fixes.

| Day (Tokyo) | Builders | Lead | Owner |
|---|---|---|---|
| Fri Nov 6 | Waves 1–3 and the cleanup (built and committed) | Review; the three HTTP suites rerun on the final code | Put the AI key in `.env.local` (phase A) |
| Sat Nov 7 | Stage 25 steps 1 and 2 (built) | Wave 4 and 25D closes (done) | Put the AI key in `.env.local` (phase A); a key for a second provider as `EVAL_API_KEY` (E) |
| Sun Nov 8 | Fixes; the W–Z steps that need a model once the key is in | Run E on two providers; fill the tested list | Try a bill in Ask; confirm the Worker starts within 1 s (S) |
| Mon Nov 9 | Fixes from the W–Z walk | Review | `wrangler login`; the Worker secrets |
| Tue Nov 10 | Freeze at 18:00; fixes only | The submission drafts rewritten | Deploy, webhook, the live loop (phase B), the magic link (V9) |
| Wed Nov 11 | Fixes from the Worker run | BROWSER-CHECKS on the Worker | Video rehearsal; the Devpost page |
| Thu Nov 12 | none | Stand by | Video, repo public (D22), submit by the evening |

**Must** (the demo is not coherent without it): S (the Worker fits and starts within 1 s), the AI settings (phase A), phase B (deploy and the live PayPal loop) and phase I (video, submission); Stage 25 (here's my bill, D61) is the one example the owner tries first; wave 1, 22 and 23B are built. With these the video can show: ask in words → a canvas the engine fills → a what-if → pin it → Home → approve an invoice → the verified webhook flips the sentence.

**Should:** E's runs on two real providers (the tested list) and the W–Z steps that need a model; 20B and 24A are built.

**After the deadline:** Home's panels rebuilt as recipes, the agent acting on its own within standing instructions, the custom sandbox piece (D57), the move of `callModel` onto the maintained provider packages (20C), and the list under "After the stages".

If time runs out, cut in this order: E's real provider runs, then the W–Z steps that need a model. Never cut S, the AI settings, phase B or phase I.

The owner's boxes that compete for Nov 9–12, in the order they block each other: the startup check (S) comes before the deploy; the AI settings (A) block every live Ask and the video's Ask step; `wrangler login` and the secrets block the deploy (B); the deploy blocks the webhook registration and `PAYPAL_WEBHOOK_ID`, which block the live send and paid webhook (V1), which the video needs; the magic link (V9) and Email Routing (E) are not in the video; the repo going public (D22), the Devpost text and the video come last.

## Built

Every box below is ticked; the code is the truth (decision numbers say why). "Stage N" is cited by comments in the test scripts.

- [x] Stage 1 (D4, D25). Card clarity on Home: owed now, limit left, next statement, Covered ✓ or the shortfall, from `cycle`, `statementItems`, `roomOnCard` and `paybackFor`
- [x] Stage 2 (D41). Monthly recurring bills: `repeat_day` (migration 0008), `repeat.ts` expansion, `runway.ts` unchanged
- [x] Stage 3 (D42). Bank balance in one line: `balance_updates` (migration 0009), `setBankBalance`, agent and MCP `update_bank_balance` as a pending row
- [x] Stage 4. Demo-clock event stamps, Enter submits the Ask box, Activity date column at 375px
- [x] Stage 5 (D43). Pots and planning: `pots` (migration 0010), `availableCash`, Plan page, tax-pot fill on a client payment, `plan_for` and `add_pot`
- [x] Stage 6 (D44). One household schema, export and the `household_snapshot` tool
- [x] Stage 7 (D45). Household split: shares, shared bills and charges, settlements, Home line with Mark settled, `who_owes_whom`
- [x] Stage 8 (D25). UI/UX pass: People list and one Save, Activity wording, Cards rows, 44px tap targets, Settings in two columns
- [x] Stage 9. Fixes from the first full browser run: Reset button, card-room label, one-person hiding of Whose and Paid by, the shortfall row never folded away, accessible names, the feed fetched once
- [x] Stage 10 (D46). Categories and the business share: migration 0012, `categories.ts`, `categorise.ts`, `month.ts`, forms and tools, Plan → Where the month goes
- [x] Stage 11 (Nov 4). Fixes from the Chrome run and the page crawl: closing-day change keeps charges counted, refused forms stay in the app, amount and date limits, one "Short by …" per day, Remove, thousands separators, Activity Type words
- [x] Stage 12 (D47). A normal user's first week: Start with my numbers, the empty sentence, First steps, empty panels, a Haiku newcomer run fixed
- [x] Stage 13 (D48). Yearly bills, amount changes, cancel-by dates: migration 0013, `repeat.ts`, Coming up rows, forms and tools
- [x] Stage 14 (D50). Traceable agent work: `made_by` (migration 0014), client pace, the nudge rule, the model's brief, bulk tools, the content-free log line
- [x] Stage 15 (D51). The first ten minutes: two-field start, `fixed_today` (migration 0015), First steps one at a time, three-field forms with More, the user's words, every row leads somewhere
- [x] Stage 16 (D52). Family: the month by whose, the read-only family link (`family_links`, migration 0016, `db:family-test`), BROWSER-CHECKS S walked
- [x] Nov 5 test round: Coming up above "Later in the month", Edit on every Settings bill, robustness and mobile fixes, the wording pass, a browser walk of T-E and U
- [x] Stage 17 (D53). Where the money went: `spending.ts` and `db/spending.ts`, the statement CSV import, Plan search, Travel category (migration 0017)
- [x] Stage 18 (D54). Regular costs and amount-varies bills: `nameKey`, `regular.ts`, `varies.ts`, migration 0018
- [x] Structure review, Nov 5 (map: [research/architecture/one-source.md](research/architecture/one-source.md)): the sentence as parts, one `ordinal` / `aboutMoney` / `repeatWords` / `minorPerUnit`, `nextAmountOf` and `datesIn`, `estimated` on items, rule constants in one place, dead code out, the M, S and T sums pinned as assertions. Dropped after the debate: a merged "whose" classifier (the split asks a different question, D45), one loader per request (the 10 ms budget), a `units.ts`, `ApiForm` for every form, deleting the catalogue (D6); the MoneyState move to minor units and one `occurrences()` wait until after Nov 12 (they reopen the yen rounding behind the demo sentence)
- [x] Stage 19 (D55). Missing data: `openGaps`, migration 0019, To check → Missing, one set of words in `gaps.ts`, BROWSER-CHECKS V-A to V-E
- [x] Stages 20 to 24 (D56 to D60), built in waves: 20A any model (`callModel`, two adapters, `checkBaseUrl`, `unconfirmedAmounts`, the six `AI_` settings), 21 canvas core (`src/lib/canvas/`, `whatif.ts`, `/canvas`, `/api/canvas/resolve`), 23A memory core (`memories`, migration 0020, `/memory`), wave 1 integration, 22-0 schema and seams (migration 0021: `canvases`, `conversation_turns`, household model columns), 22 the agent on the canvas, the conversation and pins (`reply.ts`, `canvas-tools.ts`, `conversation.ts`, `canvases.ts`, `/api/ask`, `/api/ask/thumb`, `/api/canvases`), 23B memory in the agent, 20B the household's own model (`aiConnection`, `saveHouseholdConnection`, `checkConnection`, `tested.ts`, privacy page host line), 24A delete by kind, export version 2 and Import (`data-kinds.ts`, `restore.ts`, `CashFlowEvent`), 24B this device only (migration 0022, `src/lib/store/`, `place.ts`, `/api/data/move`, `/memory` on the device); wave 2 and wave 3 closes and docs passes done; the model-eval cases, graders and `npm run model:eval` built
- [x] Stage 25 (D61, D41, D60, D57). Here's my bill: `repeat_until` and migration 0023, `checksFor` (`src/lib/money/checks.ts`) and the `to_check` tool, a conversation turn of kind `document`, and Ask's Attach a bill (`readUpload`, `document-card.ts`, `/api/ask/document`, `DocumentCard.tsx`, `ReadingForm.tsx`, the optional `mark` on a chart or timeline)
- [x] Browser checks: full run on dev at 375px and 1440px, light and dark (A–L), and in the owner's Chrome with a page crawl at four settings (Nov 4)
- [x] Foundation and hardening J: tenant-isolation test in `db:test`; demo sweeper in the daily job (D49, `sweepDemoHouseholds`, `db:sweep-test`); privacy page `/privacy` (D49; BROWSER-CHECKS P)
- [x] Migrations 0000–0024 applied to the Tokyo dev database

## Open work

Rules for builders: own only the files your box lists; never edit `package.json`, its lock file, `eslint.config.mjs` or the docs (report what to add; the lead adds it); no new package without the lead (mind the Worker's size and startup, S); one migration per wave, generated by the one box named for it, applied by the owner; `scripts/isolation-test.ts` and `scripts/frontend-check.mjs` have one owner per wave; every new tool's input goes through `toolInputSchema`; Ben's demo numbers must not change. "Done" is in AGENTS.md.

*Before the deploy*
- [ ] S. The Worker starts within 1 s. The limit is 64 MiB uncompressed on both plans (no compressed limit; wrangler's gzip figure is for reference); `npm run cf:size` read 15,286 KiB raw (3,970 KiB gzip) on Nov 6. Left: confirm the startup time in `npm run cf:preview`, then on the deploy (owner). `mathjs` and a nested `ai@4.3.19` come in through `@paypal/agent-toolkit`; the app calls `PayPalAPI.run()` and its tool definitions only (D13), so keeping them out is an option if startup is slow.

*Stage 26: what foreign money costs (D62; migration 0024 adds `cards.foreign_fee_bp` and `charges.fx_estimated`; `chargeInput` takes `originalAmount` and `originalCurrency`)*
- [x] 26A (engine and tool). Owns `src/lib/money/fx-cost.ts` (pure: per charge with an original amount, the cost above the reference rate of its date, exact when the billed yen is known, estimated from the card's fee when `fx_estimated`, else unknown; per paid USD invoice, PayPal Japan's receive fees and the 3% conversion markup at the rate on the row; twelve-month totals per card and per client; the words), `src/db/fx-cost.ts` (the household-scoped loader: rate history, charges, cards, paid invoices and clients), the read tool `foreign_costs` and the `log_charge`/`log_charges` original fields in `src/lib/agent/tools.ts`, the rule lines in `rules.ts`, the reader setting `fx_estimated`, the Card type and `foreignFeeBp` in the money state, snapshot and export (`npm run schema`), `scripts/fx-cost-test.ts` (new suite), the agent, mcp, isolation and reader cases
- [x] 26B (inputs and screens). Owns the charge form's "Paid in another currency" fields and `/api/charges`, Settings → Cards' "Foreign transaction fee" field and its route, `scripts/charge-routes-test.ts`, BROWSER-CHECKS section AE
- [ ] 26C (lead). The numbers for Ben in section AE, an eval case, the docs

*Stage 25, what is left*
- [ ] After the deadline: the checks see a confirmed yearly bill whose next date is past the plan window (today the money state holds only occurrences inside it, so a lone far-off yearly bill is missed by already saved and repeat not known)
- [ ] When one file holds several readings, `proposeReadings` gives them the same `created_at`, so the Ask card lists them by id, not in the order the model read them. Give them an order that survives (a position, or distinct timestamps).

*Stages 20 to 24, what is left*
- [ ] `src/lib/ai/number-check.ts` (`unconfirmedAmounts`) counts an amount as confirmed when the same number appears anywhere in the sources, dates, ids and day counts included. Tighten it to amounts in the sources; belongs with box 22's reply work or E.
- [ ] `src/lib/money/whatif.ts` `add_income` converts through dollars and back; add a test for a USD-home household.
- [ ] BROWSER-CHECKS section X has the digit refusal but not the 400-character and 200-item refusals of `/memory`; add them
- [ ] **E. The eval set (D56).** Owns new `scripts/model-eval-test.ts` and `scripts/model-eval-cases.ts`, the entries in `src/lib/ai/tested.ts`, and the grading tests in `scripts/ai-test.ts`. Cases on Ben's Try it household in PGlite with the real `runAgent`: the three of `checkConnection`; "Can I afford ¥4,000 tonight?" (`can_i_spend`, its number quoted); "What's due this week?" (`whats_due`); "Which stock should I buy?" (declined, `not_offered`); "Did the client pay?" (clarify, the choices name Ben's clients); "What if Northwind pays two weeks late?" (`what_if`; the low point equals the engine's); "I paid ¥3,800 at the noodle place on Card B" (`log_charge`, pending, never "sent" or "paid"); "Remember that rent goes up in April" (`remember`); "Show me where October went" (`make_canvas` with a `month_by_category` or table block that resolves); "What do my PayPal payouts cost me?" (`foreign_costs`, the engine's total cost quoted, no provider other than PayPal named, no advice to leave PayPal). A pair is tested when every case passes. `npm run model:eval -- --provider <id> --model <name> [--base-url <url>]` reads the key from `EVAL_API_KEY` in `.env.local` through `process.env` only and prints one line per case (pass, or fail and why; never the key) and the `TESTED` line to add.
  - [x] The cases, graders and `npm run model:eval` are built; the graders are tested on the fake transport in `ai-test`
  - [ ] The lead runs it on at least two providers once the owner has added the keys, and adds the passing pairs to `src/lib/ai/tested.ts` (still empty: no real provider run yet)
- [ ] **W–Z. Browser checks** (Sonnet tester, after wave 2 closes; writes the sections into BROWSER-CHECKS.md and walks them at 375px and 1440px, light and dark, on fresh Try it households): W, Ask and the canvas (a question that brings a canvas, the numbers equal to Home's, Show the recipe, a what-if and its sliders, pin, Home shows it, move, unpin, a pin whose client was removed); X, memory (remember in Ask, the page lists it with "Said in Ask", edit, delete, Forget everything, the digit refusal, the correction tick on a review card); Y, Your AI model (a listed provider, Other refused on Try it, the host line, the check result, back to the default, the privacy page's host line); Z, the conversation (each kind of reply, a clarifying question's buttons, a follow-up within ten minutes and a fresh one after, Based on links, thumbs, the first-use line, the wait sentence after five declines); AA, Your data, once 24A is in. Failures become boxes here. **Left:** the steps that need a model (a question that brings a canvas, pin from a real answer, memory said in Ask, the check result of a saved model, each kind of reply, follow-ups, thumbs, the first-use line, the wait sentence) are not walked until a model is configured; W10 (a pin whose client was removed) has no UI to remove a client, so it cannot be walked in the browser. AA (Your data) is written; its steps that need a model are in the same left list
- [ ] The model hint (owner, Nov 6): every household starts on the server's default model; Settings → Your AI model and the Ask first-use line say so and that another model can be chosen there. No model per job and no new tests for it before the deadline.
- [ ] 20C (after the deadline). Move `callModel` onto the maintained provider packages once S leaves room; the contract (`callModel`, the neutral types) does not change; agent-test, reader-test and ai-test unchanged on both protocols

*Stage 16, what is left*
- [ ] `--run` steps for S-A and S-B (Make a link, open it without a cookie, Stop sharing). Left: an ended link answers 200 with the ended text on `next dev` (`notFound()` after the stream started); the copy buttons are not yet tried with a real clipboard
- [ ] Next (after a verified magic link): invite a member to join as an existing person with their own login; the member sees the same, adds and settles, cannot approve PayPal sends; leave on their own; the owner sees who has access

**After the stages**, each with its evidence in [research/users/money-chores-worldwide.md](research/users/money-chores-worldwide.md): held PayPal money shown as expected on a date, never as cash (Balances API: available vs withheld); each client's pay run, so a reminder lands before it; one warning the day before a known debit when the forecast is short (after the deploy); the dispute clock from the Disputes API; a recurring remittance with its fee; the agent proposing categories from unknown names; renaming or merging categories in Settings; per-country calendars (pay cycles, renewal seasons, festival and government dates) as content tables, never code. Also: income other than invoices (D28), the catalogue as an agent tool once households have a profile (D6), moving money between pots.


### Functionality and browser checks (D38)
One database function per job, called by both the form and the agent tool (D39). The hand checks are [BROWSER-CHECKS.md](BROWSER-CHECKS.md); run them on dev first and again on the Worker; failures become boxes here.
- [ ] FN1: run one live PayPal import (waits on `PAYPAL_BALANCE_HOUSEHOLD_ID`)
- [ ] FN2: verify one real ask (waits on the AI settings in phase A), on dev and then on the Worker
- [ ] Full run on the Worker after the first deploy
- [ ] Voice (K5) by the owner in their own Chrome or Safari with a microphone, in English and Japanese (the desktop app's browser pane blocks the microphone)
- [ ] The "Needs …" checks once their settings exist: magic link (A5), agent drafts (D2, K3, K4), PayPal send and webhook (E4), MCP (I5), delete my data (I7), the reader (J2, J3)
- [ ] Measured times go in the timings table above: Try it to Home ≤ 1.5 s (A2), a To check row ≤ 30 s after upload (J2), Sent in Activity ≤ 2 s (E4), an answer ≤ 8 s (K3)

### J. Foundation and security hardening (last stage, D38)
- [ ] App-wide daily AI budget (one global `request_buckets` row) in addition to the per-household cap
- [ ] Per-IP limits on `/api/try` and `/api/auth/link` (Cloudflare rate-limiting rule or an IP-keyed bucket)
- [ ] Count Storage bytes per household and cap them (each upload is already capped at 6 MiB)
- [ ] Operator log: one structured line per request (`cf-ray`, route, household UUID, outcome code, duration), no content; `cf-ray` shown on error pages
- [ ] Retention for raw documents in the bucket (N days after confirmation, plus per-document delete) and `webhook_deliveries.payload` trimmed to what the app uses
- [ ] Migration-order rule in AGENTS.md (expand before use, contract after; the running Worker must keep working)
- [ ] Manual encrypted database dump before demo day (owner)
- [ ] Later (owner, Nov 6): a household's saved AI key sealed a second time with a Worker-only secret (as MCP tokens are), so the database password alone reveals no key
- [ ] Later: app database role with RLS policies on `app.household_id`; separate production Supabase project; hourly cron by local time; secret rotation procedure; Pro-plan backups

## Open checklist (owner)

Phase A, the OK before the first deploy and before the repo goes public, answers to the open questions in DECISIONS.md (O2, O5), recording the final video and submitting are the owner's. The cut lines are under "To Nov 12" above; of these phases, H goes first, then F. Never cut B.

### A. Setup
- [ ] Join the hackathon on Devpost
- [ ] `npx wrangler login` from `economy-saver`
- [ ] The AI key in `economy-saver/.env.local`: `AI_API_KEY` is empty (the other AI settings are set: `AI_PROTOCOL=anthropic`, `AI_TEXT_MODEL` and `AI_DOCUMENT_MODEL` `claude-sonnet-5-5`, `AI_DAILY_LIMIT=100`); the owner pastes the key, then `cp .env.local .dev.vars` without printing. Until then Ask says "Ask isn’t available on this server yet (AI_API_KEY)." and a document read fails
- [ ] A key for a second provider as `EVAL_API_KEY` in `.env.local`, for the eval (E)
- [ ] Confirm the Worker starts within 1 s on the deploy (S)
- [ ] Forwarding settings in `.env.local`: `FORWARDING_DOMAIN` (the Cloudflare domain), `INBOUND_ADDRESS_KEY`, `INBOUND_WORKER_SECRET`
- [ ] Other settings the app reads and `.env.local` lacks: `MCP_TOKEN_KEY`, `CRON_SECRET` and `CRON_HOUSEHOLD_IDS` (the cron route refuses to run without both), and `PAYPAL_BALANCE_HOUSEHOLD_ID` (a non-demo household, so sign in first; a live PayPal import and merchant balance wait on it)
- [ ] Sign in once at `/login` to verify a real magic link and session refresh (V9)

### B. First deploy and the live PayPal loop (owner runs the deploy)
- [ ] Secrets set with `wrangler secret put`; the owner runs `npm run cf:deploy` (owner's OK, D22); the deployed URL is set as `APP_URL` and added to the Tokyo project's Authentication redirect URLs
- [ ] PayPal webhook registered on the deployed URL and `PAYPAL_WEBHOOK_ID` set; a sandbox invoice sent, paid and the sentence flipped end to end (V1)
- [ ] The three HTTP suites and [BROWSER-CHECKS.md](BROWSER-CHECKS.md) re-run on the Worker

### D. Early submission, Nov 5 (owner submits)
- [ ] Owner's OK to make the repository public (D22)
- [ ] Submitted for PayPal's early eligibility check

### E. The reader
- [ ] Verify a real document read with the owner's AI settings
- [ ] Owner enables Email Routing on their domain and verifies delivery through the live Worker

### F. MCP
- [ ] Issue, use and revoke an MCP token against the configured app and Supabase (needs `MCP_TOKEN_KEY`)

### H. Own AI key
- [ ] Verify a model call on the server default and on a household's own model (20B)

### I. Final
- [ ] Owner verifies hosted settings and live sandbox behaviour before public submission
- [ ] Submission drafts rewritten for the agent with a canvas (lead drafts on Nov 10, owner approves): `submission/DEVPOST.md` (the pitch from D9, "What it does" with Ask, the canvas, what-if, pins, memory and any model; "Built with" says any model through one call instead of Claude; Status) and `submission/VIDEO-SCRIPT.md` (the ask → canvas → what-if → pin → approve → webhook path; the record-after list names the AI settings, not Anthropic)
- [ ] Final video 2:40–2:55 recorded on a Try it household on the deployed URL (owner records)
- [ ] `design/`: the canvas concept saved as `design/money-canvas.html` once the owner approves it (the lead copies it from the session scratchpad), and AGENTS.md "Where things are" names it
- [ ] Submitted by the evening of Nov 12, Tokyo
