# Personal Economy Saver

A personal money agent for people paid through PayPal. Home gives a 30-day runway as one dated sentence, what is safe to spend, and one PayPal action the person approves: make a payment link for finished work, or offer it again to a late client. Ask answers questions about the money in the person's own words. The example follows Ben, a fictional freelance designer in Tokyo paid in US dollars.

PayPal sandbox only, fictional data only. What the product does and why: [../DECISIONS.md](../DECISIONS.md). Rules for anyone working on it: [../AGENTS.md](../AGENTS.md). How to test it by hand: [../qa/README.md](../qa/README.md).

## Requirements

- Node.js 22.15 or newer and npm.
- A Supabase project (the app has no local database).
- PayPal sandbox REST app credentials, fipa's partner attribution code and platform merchant id, and (to try a payment end to end) a sandbox business account to connect and a sandbox buyer account to pay with.

## Setup

1. `npm install`
2. Copy `.env.example` to `.env.local` and fill it in. Each setting is explained there, and the app stops with an error naming any setting it needs and does not have. Keep `PAYPAL_ENVIRONMENT=SANDBOX`.
3. Notes that are easy to miss:
   - `APP_URL` is `http://127.0.0.1:3123` locally (open 127.0.0.1, not localhost) and `http://localhost:8787` for the Worker preview. `<APP_URL>/api/auth/callback` must be listed in Supabase under Authentication, URL Configuration, Redirect URLs, or the magic link does not sign in.
   - PayPal: `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET` are the sandbox app's; `PAYPAL_PARTNER_ATTRIBUTION_ID` and `PAYPAL_PARTNER_MERCHANT_ID` are fipa's partner code and its own platform merchant id (the payee for Try it). `PAYPAL_WEBHOOK_ID` comes from registering the webhook (below). There is no setting for a client's email or for a household's PayPal: each household connects its own in Settings → PayPal.
   - `CLIENT_IP_HEADER` is `x-forwarded-for` locally and `cf-connecting-ip` on the Worker; the public pay page and the sign-in link count requests by it.
   - Keep `AI_KEY_SEAL_KEY` and `MCP_TOKEN_KEY` fixed once set. A key sealed with another value cannot be opened, and rotating `MCP_TOKEN_KEY` invalidates every token.
   - `.dev.vars` holds the same settings for the Worker preview (`cp .env.local .dev.vars`).
   - `db:migrate`, `db:seed` and `db:vault-check` touch the owner's database: owner only.
4. `npm run dev -- -p 3123`, then open `http://127.0.0.1:3123`. `/api/health` reports readiness without revealing values.

Local ports: 3123 the app, 3130 the Codex bridge, 3125 the design mockup, 8787 the Worker preview.

## Commands

Run from this folder. Never commit or print `.env.local` or `.dev.vars`.

| What | Command |
|---|---|
| Dev server | `npm run dev -- -p 3123` |
| Type check | `npx tsc --noEmit -p .` |
| Lint | `npm run lint` |
| All database tests and the QA scenario check (isolated PGlite, no credentials) | `npm run db:test` |
| One suite | `npm run db:<name>-test` (package.json lists them) |
| QA scenario files check | `npm run qa:check` |
| MCP protocol demo (loopback, isolated) | `npm run mcp:demo` |
| Regenerate the JSON Schemas in `schema/` from the zod definitions | `npm run schema` |
| Regenerate a migration after a schema edit | `npm run db:generate` |
| Apply migrations (owner only) | `npm run db:migrate` |
| Seed the demo household (owner only) | `npm run db:seed` |
| Check the Vault connection (owner only) | `npm run db:vault-check` |
| Model eval on a real provider (key from `EVAL_API_KEY` in `.env.local`) | `npm run model:eval -- --provider <id> --model <name> [--base-url <url>]` |
| HTTP suites against a running dev server | `node scripts/frontend-check.mjs --run\|--extra\|--guards http://127.0.0.1:3123` |
| PayPal sandbox smoke test: makes one $1.00 order nobody approves and checks the webhook is registered (talks to the sandbox, so it only runs when asked) | `npm run smoke -- --run` |
| Register the PayPal webhook (owner only) | `npm run webhook:register -- <https address of the Worker>` |
| Generate Web Push keys (owner only) | `npm run push:keys` |
| Worker build and local preview | `npm run cf:preview` |
| Worker size and secret scan | `npm run cf:size` |
| Deploy (owner only) | `npm run cf:deploy` |
| Codex bridge (dev only) and its check | `npm run codex:bridge` / `npm run codex:bridge-check` |

Scripts in `scripts/*.ts` run with `npx tsx --tsconfig ./tsconfig.json <file>` so the `@/` paths resolve.

## Payment links

Approve on a draft invoice makes the invoice's fipa link, `/pay/<token>`, and a PayPal sandbox order for it, paid to the household's connected PayPal (Try it pays fipa's own sandbox account). The link is the invoice's own and stays the same; it shows the client only the item and the amount, with no household or seller name. The client taps Pay, pays on PayPal's sandbox page and lands on a "Thank you" page that says PayPal is confirming the payment. Only a verified PayPal webhook captures the payment and marks the invoice paid; the browser is never trusted for it. Once a payment is approved the link never makes a second order, and a link that is paid or ended says so.

A household that has connected its own PayPal has Home read that PayPal's balance and incoming payments (Try it makes no PayPal call). A read payment that looks like an open invoice's is offered on the invoice page as "Is this that invoice?", naming the payer, and the owner confirms it; the "Paid another way (bank, cash)" button is folded away while such a payment is offered, so the money is counted once.

- `npm run webhook:register -- <address>` registers `<address>/api/paypal/webhook` with the sandbox for the events the app reads (order approved, capture completed, merchant onboarding completed, partner permission revoked). PayPal needs an https address it can reach, so use the deployed Worker, not localhost. Copy the webhook id it leaves in the sandbox dashboard into `PAYPAL_WEBHOOK_ID` privately (owner only).
- Locally, `next dev` can make a link (Approve), show the pay page and hand the client to PayPal's sandbox checkout, but PayPal cannot call back to localhost, so the invoice stays "Awaiting payment" until the webhook reaches a deployed app. Test the rest without PayPal: `npm run db:approve-test` (Approve and the link's Pay), `npm run db:connect-test` (Connect PayPal), `npm run db:test` (the rest, including the webhook and matching a payment), all on a disposable database with fake PayPal calls. The HTTP guards (`node scripts/frontend-check.mjs --guards`) check the public routes against the dev server.
- Invoices sent before payment links existed get their link from a one-off backfill: `npm run db:backfill-pay-tokens -- --dry-run` prints counts only and writes nothing; `--apply` writes. The owner runs `--apply`.
- To connect a household's own PayPal, sign in (Try it cannot connect) and use Settings → PayPal; the sandbox sign-up returns to `<APP_URL>/api/paypal/connect/return`.

## MCP

Make a token in Settings, then connect a Streamable HTTP MCP client to `/api/mcp` with it as a Bearer token. It reads and drafts only; approval and sending stay in the app.

## Codex bridge (dev only)

With the Codex CLI installed and logged in, `npm run codex:bridge` answers OpenAI Chat Completions requests by running `codex exec`, so the AI features run without an API key. Start the app with `AI_PROTOCOL=openai`, `AI_BASE_URL=http://127.0.0.1:3130/v1`, any non-empty `AI_API_KEY`, and `AI_TEXT_MODEL` and `AI_DOCUMENT_MODEL` set to a model your Codex login offers. It reads images but not PDFs, and only `next dev` can use it (the Worker refuses private addresses). Prompts go to OpenAI through your ChatGPT login, so use fictional data only. Its answers and timeouts are not a judgement of Ask; judge Ask with a real key.

## License

MIT. See [LICENSE](LICENSE).
