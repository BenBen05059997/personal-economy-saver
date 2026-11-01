# Personal Economy Saver

Personal Economy Saver is a money assistant for freelancers who are paid across borders. It reads your bills, watches your PayPal income, tells you the cheapest money move at the moment you need it, and acts through PayPal when you approve. The first case is a freelancer in Japan who is paid in USD by US clients.

Built for the PayPal AI Hackathon on Devpost. It works in three layers:

- **See:** a cash-flow view of your balances, upcoming bills and expected client payments.
- **Know:** suggestions based on your own numbers, each with an amount and its reasoning.
- **Act:** the AI drafts the action in PayPal, you approve it, PayPal runs it, and a webhook confirms it.

## Status

M1: the screen runs on sample data (no live PayPal calls yet).

What works today:

- The main screen: runway chart (expected and worst case from each client's payment history), the bill → options → approve → paid flow, activity, who pays when, and the bills coming out.
- The wealth-moves catalogue: Japan (18 moves) and the US (15), each with a value formula, sources and dates, ranked by an engine that applies the house rules (`src/lib/catalogue/`, `src/data/catalogue/`).
- Moment cards (a bill arrived, a client paid), the deadline strip, and "Found for you".
- Environment validation that refuses to run unless `PAYPAL_ENVIRONMENT` is `SANDBOX`.
- A PayPal sandbox client (OAuth token and a small REST helper).
- The PayPal Agent Toolkit wired up with a split between agent tools and approval-only tools.
- `GET /api/health`: reports whether the environment is ready. It returns no secrets.
- `POST /api/paypal/webhook`: verifies PayPal's signature and records the event. `GET` lists recent events.
- `npm run smoke`: checks the whole PayPal sandbox setup from the command line.
- `npm run webhook:register`: registers the webhook with PayPal.

Next: real PayPal calls and the agent (M2), reading bills (M3), the engine fed by real PayPal income (M4). See `../PLAN.md` and `../DECISIONS.md`.

## Safety

- **Sandbox only.** `src/lib/env.ts` accepts only `PAYPAL_ENVIRONMENT=SANDBOX` and throws on anything else. The only PayPal host in the code is `https://api-m.sandbox.paypal.com`; there is no live URL. The Agent Toolkit is always created with `sandbox: true`.
- **The agent can only draft.** The AI agent gets tools that create, read, list, search and delete invoice drafts. It does not get the send, reminder or payment tools. The server runs those only after you approve a specific action.
- **Webhooks are verified.** Incoming webhook calls are checked with PayPal's signature verification before the app acts on them. Unsigned or forged calls get a 400 and are logged as rejected.
- **No real money moves.** Use sandbox accounts only. Never put live credentials in `.env.local`.

## Prerequisites

- Node.js 20 or newer
- A PayPal Developer account (free): https://developer.paypal.com

## Setup

1. In the PayPal Developer Dashboard, open Testing Tools -> Sandbox Accounts and create two accounts:
   - A **Business** account with country **Japan**. This is the freelancer; the app is linked to it.
   - A **Personal** account with country **United States**. This is the client who receives invoices.

2. Open Apps & Credentials, switch to **Sandbox**, and create an app linked to the Japan business account. Copy its client ID and secret.

3. Create your local environment file and fill it in. The variables are explained in `.env.example`.

   ```bash
   cp .env.example .env.local
   ```

   Set `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` and `SANDBOX_CLIENT_EMAIL` (the email of the US personal account). Leave `PAYPAL_WEBHOOK_ID` empty for now.

4. Install dependencies.

   ```bash
   npm install
   ```

5. Check the PayPal connection.

   ```bash
   npm run smoke
   ```

   If the balance or invoice check fails with 403 "insufficient permissions", tick **Invoicing** and **Transaction search** under the app's Features and save. PayPal keeps returning the same access token for about 9 hours, so the new permissions only reach the app once that token expires; rerun the smoke test then.

   It checks the environment, gets a sandbox token, reads the balance, creates, reads and deletes a USD draft invoice, and lists webhooks. To keep the draft invoice so you can see it in the sandbox, run:

   ```bash
   npm run smoke -- --keep
   ```

6. Start the app.

   ```bash
   npm run dev
   ```

   Open http://localhost:3000 for the home page and http://localhost:3000/api/health to check the environment.

### Webhooks

PayPal needs a public URL to deliver webhooks, so deploy the app first (for example on Render, with the same environment variables as `.env.local`). Then register the webhook against the deployed URL.

```bash
npm run webhook:register -- https://your-app.onrender.com
```

This registers the webhook for `INVOICING.INVOICE.PAID`, `INVOICING.INVOICE.CANCELLED`, `INVOICING.INVOICE.UPDATED` and `INVOICING.INVOICE.REFUNDED`, and prints a `PAYPAL_WEBHOOK_ID`. Set that value in your local `.env.local` and in the Render environment settings. The webhook route needs it to verify signatures.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Starts the development server at http://localhost:3000. |
| `npm run build` | Builds the app for production. |
| `npm run start` | Runs the production build. |
| `npm run lint` | Runs ESLint. |
| `npm run smoke` | Checks env, sandbox token, balance, draft invoice create/read/delete, and webhook list. Add `-- --keep` to keep the draft. |
| `npm run webhook:register -- <url>` | Registers the PayPal webhook for the deployed app and prints `PAYPAL_WEBHOOK_ID`. |

## Project structure

```text
src/
  app/
    page.tsx              the main screen
    api/
      health/             GET /api/health
      paypal/webhook/     POST (receive events), GET (list recent events)
  components/
    app/                  runway chart, bill and approval flow, activity, top bar
    moments/              moment cards and the deadline strip
    know/                 "Found for you" and the "Why" disclosure
  data/catalogue/         jp.json, us.json: the wealth moves, with sources
  lib/
    catalogue/            schema, engine, value formulas per region
    money/                money types and the runway maths
    sample/               sample personas (Ben in Tokyo, Maya in Austin)
    env.ts                environment validation, sandbox-only check
    paypal/
      client.ts           sandbox token and REST helper
      toolkit.ts          Agent Toolkit tools: agent (draft/read) vs approval-only
scripts/                  smoke test and webhook registration
```

## Built with

- Next.js 16 (App Router, TypeScript)
- PayPal Agent Toolkit 1.11
- PayPal REST APIs (sandbox)
- zod for environment validation
- AI model: Claude (from M2)

## License

MIT. See [LICENSE](LICENSE).
