# Personal Economy Saver — private Devpost draft

**Pitch:** Know before the card bill does. Personal Economy Saver is a money assistant for people paid through PayPal: it reads your bills and receipts, tells you whether to spend or hold off, and gets you paid through PayPal when you approve.

## Inspiration

Freelancers can have enough income on paper and still be short on the day a bill is due. The useful question is not only "what is my balance?" It is "what changes if this client pays late, and what can I do now?"

Personal Economy Saver follows that question for one fictional person: Ben, a freelance designer in Tokyo, paid in US dollars through PayPal. Bills, card statements, expected client payments and one approval-gated invoice action meet in the same 30-day view.

## What it does

Home leads with a dated sentence computed from the household's stored rows by the runway engine. Ben's seed starts at "You're fine if Acme and Northwind pay as usual. If they're late, you're ¥18,780 short on the 27th." Below it: safe to spend (including card spend not yet billed), what needs checking, and the dates ahead.

- **Bills and receipts in.** Forward a bill to your address or upload a photo or PDF. Claude reads it into a proposed reading that waits in To check; confirming it moves the forecast (confirming the fictional Hikari Denki bill changes the seeded shortfall from ¥18,780 to ¥30,000). Corrections become rules for the next bill from that biller. Clients, bills (repeating monthly if you like), card charges and the bank balance can also be typed in, and an invoice paid outside PayPal can be marked paid.
- **An agent with tools.** Type or say a question or a purchase. Claude calls tools over the engine, quotes the engine's numbers and never does the arithmetic itself. It can read the outlook, what is due, whether a purchase fits, the timeline and the ranked options when short. It can draft an invoice or put a bill, a card charge, a bank balance update or a pot into To check, and it can work out what a savings goal needs per month. It cannot send or pay.
- **Getting paid.** When the forecast is short, the next action is to invoice finished work or remind a late client. Ben reviews the invoice (Beacon Studio, a fictional $400 milestone) and taps Approve. The server sends it through PayPal Sandbox. A PayPal webhook, signature-verified, marks it paid once and credits the balance; the sentence changes. The browser never sets payment state.
- **Set aside.** On the Plan page, pots hold money for a reason (a tax percentage of each client payment, a car, a trip). Money in a pot comes off safe to spend, the lowest point and the sentence together, and a paid invoice fills the pots that have a rule.
- **Options when short.** Every option ranked by total cost in yen, cheapest first; a loan is never the recommendation while a ¥0 option (invoice finished work, nudge a late client) covers the gap. Information only, never a product to buy.
- **From a terminal.** The same tool catalogue is an MCP server: an MCP client with a token can ask where Ben stands or draft an invoice. Sending still needs the tap in the app.

## How it is built

- **A deterministic money engine:** integer minor-unit amounts, household-scoped database reads, stored FX rates, and a pure runway and sentence calculation from confirmed rows.
- **One tool catalogue, one send path:** the in-app agent and the MCP server share read and draft tools; the PayPal send and reminder tools run only from the approval route, and lint fails any other import of them.
- **A verified payment update:** the webhook signature is checked before anything changes; duplicate PayPal event ids do not apply a payment twice.
- **Private intake:** originals go to a private Supabase Storage bucket and are read in the background; nothing changes the forecast until the user confirms.
- **Sandbox boundary:** the environment validator accepts only `PAYPAL_ENVIRONMENT=SANDBOX`, the PayPal client targets the sandbox host, and the Agent Toolkit is created in sandbox mode.
- **Households, one person on screen:** every row carries a household id and every query is scoped by it; the demo shows Ben alone.

## Status

The app is in a private repository. Automated suites run on isolated test databases with simulated PayPal and Claude responses: seed and engine, household isolation, bill confirmation, invoice approval and idempotent retries, webhook replay handling and the balance credit (a $400 payment adds ¥60,000 at the seeded ¥150 per dollar), the reader, the agent, the typed-in doors, pots, the household split, categories and the month view, the household export and the PayPal import. The app also renders Ben's household from a Supabase project in Tokyo, in local dev and in a local Cloudflare Worker.

Not yet verified live, and not claimed above as working live: a Claude call from the running app, a real PayPal Sandbox send with its signed paid webhook, magic-link sign-in, and email forwarding. No public repository or live URL exists and nothing has been submitted.

## Built with

Next.js 16, TypeScript, React, Drizzle ORM, Supabase (Postgres, Auth, Vault, Storage), Cloudflare Workers, PayPal Agent Toolkit and REST APIs (sandbox), Model Context Protocol, and Claude.

## Links

Video, public repository and deployed URL: **owner to add only after review and publication**.
