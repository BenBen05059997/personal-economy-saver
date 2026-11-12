# Agent instructions

Personal Economy Saver, branded fipa. The owner is Ben. Read this file, then [DECISIONS.md](DECISIONS.md) (what the product is and why) and [PLAN.md](PLAN.md) (the open work and the owner's gates). The docs hold the design only; for anything else (a path, a route, a table, a limit, a count) read the code, which is the truth. The app is in `economy-saver/`.

## The product

A personal money agent for people paid through PayPal (D2, D29). Home is one sentence with a date and a client name, *"You're fine if Acme and Northwind pay as usual. If they're late, you're ¥18,780 short on the 27th."*, then safe to spend (including unbilled card spend), the events in date order, and one PayPal action the person approves: make a payment link for finished work or offer it again to a late client. Approve makes the link through the PayPal sandbox, the client pays, a verified webhook marks the invoice paid, and the sentence changes. Around that loop the person asks in their own words (D60): the agent answers from the cash-flow engine, lays the answer out on a canvas whose blocks hold queries, never numbers (D57), remembers what it is told (D58) and runs on the model the household chooses (D56). The model only understands, picks tools and words the result; code does every sum, every check and every write, so no model can send money, invent a number or save something unconfirmed (D40). One person is on screen: Ben, a fictional freelance designer in Tokyo paid in USD (D8).

## Hard rules

1. **PayPal sandbox only.** The app refuses anything but `PAYPAL_ENVIRONMENT=SANDBOX` and the sandbox host. Never weaken that guard (D14).
2. **No secrets in output.** Never print, paste into chat, screenshot or commit a secret value. `economy-saver/.env.local` and `economy-saver/.dev.vars` hold real keys; code reads them only through `process.env`. To refresh `.dev.vars`, run `cp .env.local .dev.vars` without printing either file.
3. **No accounts, logins or secrets.** Never create an account, log in or set a secret: no `wrangler login`, no `wrangler secret put`, no Supabase project or dashboard change, no Devpost. The owner does those, unless the owner asks for it in chat (for example a dashboard change the owner has you make). A deploy that needs a new secret still waits for the owner.
4. **Ask before migrations and anything public.** Commit, push and deploy (`npm run cf:deploy`) finished, checked work without asking. Ask the owner first before applying a migration (`npm run db:migrate`), before a deploy whose code needs a migration not yet applied, and before anything public (making the repo public, the submission).
5. **Sending only from the Approve tap.** The in-app agent and the MCP server get read and draft tools only. A payment link is made only on the Approve tap (and renewed only by the link's own Pay), a payment is taken only by the verified-webhook route, and, in a Try it household only, by the server's sandbox test-card payment as the client, tapped by the judge; lint fails any other import of those calls (D12). The browser is never trusted for payment state; only a verified PayPal webhook marks an invoice paid (D15).
6. **Household scope and integer money.** Every query is scoped by household id through the household data layer, which refuses a query without one. Money is integer minor units plus a currency, never floats (D31).
7. **Fictional data only.** No real companies, bills or people (D20). A suggestion is information, never a named product to buy, and never リボ or minimum payments (D7).
8. **Docs hold design, not code.** Update a doc only when a design decision changes: rewrite its row in DECISIONS.md in place, and add or delete its line in PLAN.md. Never write code facts into a doc (file paths, function names, routes, tables, limits that restate code, test counts, sizes, commits, deploy records), and keep no history, changelog or backup copy.
9. **`reference/` is someone else's code.** Never edit it, import from it or commit it.
10. **No fallbacks.** One database (Supabase) for what the server keeps and one way to do each thing; the browser's own storage only for what a household chose to keep on this device (D59). Code that needs a setting reads it and stops with an error naming the missing variable: no stand-in databases, mock services, silent defaults or alternative paths. PGlite runs only inside test scripts, never in the app.
11. **This is Next.js 16.** Read `economy-saver/AGENTS.md` and the guide in `economy-saver/node_modules/next/dist/docs/` before writing Next code.

## Working agreement

- The lead plans, reviews and handles anything touching secrets or the owner's accounts. Sonnet agents build, each owning its own files, in parallel where the files don't overlap.
- Work from PLAN.md. Stop only at an owner gate (rules 3 and 4) and carry on with whatever doesn't depend on the answer.
- Builders run only the checks for what they changed: `npx tsc --noEmit -p .` and the suites that cover their files. The lead runs `npm run lint` and the full `npm run db:test` once, before committing.
- Each behaviour is tested once: household isolation in the isolation suite, the cross-site guard in its unit test and the HTTP guard list, and a QA scenario only for what a script can't see in a browser.
- A migration only adds before the code that uses it ships, and removes only after no running Worker reads the old shape.
- QA runs at desktop width, 1440px; judges use a computer. Phone width only when the owner asks. How to run QA: [qa/README.md](qa/README.md).
- The accent is the logo's light yellow: buttons and selected states `#FCCB78` with dark text, chart marks `#F7A30A`; no blue, no dark amber (D72).
- Each question gets the one chart form its data needs; a switch picks the question, or chart versus table, never line versus bar versus donut (D73).
- Never rank or cut work by the deadline; list everything and fix it all.
- The submission text and video are the owner's; touch them only when asked.
- Commits use the repo's local git identity. Setup and commands: [economy-saver/README.md](economy-saver/README.md).

## Traps the code doesn't show

- After a schema change, restart `next dev`: a running server can keep an old build of an API route's data module and silently skip a new column.
- A `next dev` stuck in a hot-reload loop (its log fills with `✓ Compiled in 1ms`) drains the database pool and the HTTP suites time out. Close the tab, restart `next dev`, open one tab.
- The Claude desktop app's browser pane is throttled while hidden and can sit on "Opening …". Take a screenshot or wait; it is not an app bug.
- Migrations 0018 and 0032 are hand-edited after `db:generate` (the `ON DELETE SET NULL` column list). Keep their SQL as it is.
- Don't run `wrangler types`: its file clashes with the DOM types.

## Where things are

| | |
|---|---|
| `DECISIONS.md` | what the product does, for whom, and why |
| `PLAN.md` | open work and the owner's gates |
| `qa/` | the QA scenarios for what a script can't see in a browser, their latest results, the expected numbers and how to run them |
| `design/` | the approved mockups |
| `research/` | background reading the decisions cite |
| `submission/` | the owner's Devpost text and video script |
| `economy-saver/` | the app |
| `reference/` | someone else's code, git-ignored |
