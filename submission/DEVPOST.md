# Personal Economy Saver — private Devpost draft

**Pitch:** Personal Economy Saver shows a freelancer’s 30-day cash-flow shortfall and lets them approve a PayPal Sandbox invoice from the same screen.

## Inspiration

Freelancers can have enough income on paper and still be short on the day a bill is due. The useful question is not only “what is my balance?” It is “what changes if this client pays late, and what can I do now?”

Personal Economy Saver follows that question for a fictional freelance designer in Tokyo, paid in US dollars through PayPal. Bills, card statements, expected client payments and one approval-gated invoice action meet in the same 30-day view.

## What it does

Home leads with a dated sentence calculated from the household’s stored financial rows and the runway engine. The demo seed initially shows a ¥18,780 shortfall on November 27 if clients pay late. Confirming the pending fictional Hikari Denki bill changes that database-backed result to ¥30,000 short. The screen also shows safe-to-spend, card spend not yet billed, bills to check and upcoming events. The next action links to a review page for Beacon Studio’s fictional $400 invoice.

The user reviews the client, work, due date and amount, then approves. The server’s PayPal integration is sandbox-only and keeps sending behind the approval route. Verified PayPal webhook deliveries can update a matching invoice and the household’s PayPal balance once. The app does not trust browser state to mark an invoice paid.

## Demo and evidence

The local rehearsal uses fictional records in isolated PGlite test databases. Its PayPal transport is simulated, and the paid webhook is passed to the database layer as already verified; no invoice was sent, no client logged in, and no payment was made. The final sentence shown after the simulated $400 payment reflects the resulting database mutation and the runway engine. The video labels this clearly as **“Local rehearsal · simulated sandbox delivery.”**

Automated scripts cover seed and engine behavior, household isolation, bill confirmation, invoice approval/idempotent retries, webhook replay handling, and the resulting ¥60,000 balance increase at the seeded ¥150 per US dollar rate. The displayed paid state is calculated from that PGlite database mutation.

## How it is built

- **A deterministic money engine:** integer minor-unit amounts, household-scoped database reads, stored FX rates and a pure runway/sentence calculation from confirmed rows.
- **A reviewable action:** invoice details are shown before approval. Agent and MCP tools may read or draft; the send path is available only through the server approval route.
- **A verified payment update:** the webhook signature is checked before delivery handling. Duplicate event IDs do not apply the payment twice.
- **Private intake:** photo/PDF upload and forwarded-email reading produce a proposed reading that waits for the user to confirm. Local tests cover extraction and confirmation behavior.
- **Sandbox boundary:** the environment validator accepts only `PAYPAL_ENVIRONMENT=SANDBOX`, the PayPal client targets the sandbox host, and the Agent Toolkit is configured with sandbox mode.

## Current status

The Next.js 16 app, household-scoped Postgres data layer, fictional seed, Home and invoice review screens, local reader flow, sandbox integration code, and isolated PGlite tests are in the private repository. The rough recording is a local artifact. No public repository or live app URL is available, and the submission has not been made.

## Built with

Next.js 16, TypeScript, React, Drizzle ORM, Postgres/Supabase, PayPal Agent Toolkit, PayPal REST APIs (sandbox), and Claude for document reading and language tasks.

## Links

Video, public repository, and deployed URL: **owner to add only after review and publication**.
