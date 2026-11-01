# Devpost submission: Personal Economy Saver (draft)

Draft written Nov 1, 2026. Submission closes Nov 12, 12:00 PT (Nov 13, 05:00 Tokyo). Each section says what is true today and marks the rest "(planned for Nov X)" per PLAN.md. Delete this note and every marker before submitting. Fill in later: video link, repo link, live URL, screenshots.

**Tagline:** A money assistant for freelancers paid across borders. It tells you the right move at the moment it matters, and acts through PayPal only when you approve.

---

## Inspiration

Most people do not lose money by being careless. They lose it through what they do not know at the moment it matters. The facts exist, but they sit in card terms, tax pages and forum threads. Nobody puts them next to the bill on your screen.

Freelancers feel this most. In the US, 58% of self-employed people have income that varies from month to month, and 22% struggled to pay bills because of it (Fed SHED 2025). In Japan, 32.4% of freelancers had a month with no income last year (Mynavi 2025). A dashboard that shows the dip does not help. The user needs the cheapest way to cover the gap, and a button.

My example user is Ben, a freelance designer in Tokyo. His clients pay him in US dollars through PayPal. His bills are in yen and in Japanese. The PayPal hackathon asked for a tool for freelancers who bill in several currencies and for agents that act, not only advise. Ben is that user. (All people, companies and billers in the demo are fictional.)

## What it does

The unit of the product is the moment, not the dashboard. The app speaks when something happens: a bill arrives, a client pays, a deadline gets close. At each moment it shows one thing, in the user's own numbers, with a source behind a tap.

It works in three layers.

- **See.** A 30-day runway with two lines: expected balance and worst case. Expected arrival of a client's money is the sent date plus that client's median days to pay. Worst case uses their slowest. Alerts fire on the worst case.
- **Know.** A hand-written catalogue of legal wealth moves, each with a source, a date and a formula. Each move names the world that already knows it, such as tax accountants or point hunters. Things a normal job teaches you (iDeCo, NISA, hometown tax donations) are shown once as a checklist. The product is the other kind.
- **Act.** The agent drafts a PayPal invoice. The user reviews it and taps Approve. Only then does the server send it. A verified PayPal webhook confirms payment, and the red gap closes.

**The demo, start to finish (sample data):**

1. A Hikari Denki electricity bill (a fictional biller) arrives. The app shows "here is what I understood" and Ben confirms. Nothing counts until he does.
2. The runway turns red. In the worst case Ben is ¥30,000 short on Nov 27.
3. The app prices the ways out in yen. Invoicing finished work costs nothing. Reminders may land too late. A cash advance costs about ¥250. A 2% early-payment discount costs ¥3,600. The free one is first.
4. The agent drafts a $400 invoice to Beacon Studio. Ben approves. PayPal sends it.
5. The client pays in the PayPal sandbox. The verified webhook flips the invoice to Paid. The gap closes.
6. The payment opens a second moment. The tax pot is pinned first: about a quarter of the payout is already owed. Then what the payout cost in PayPal fees (about ¥4,230 of a $400 payout at ¥150 per dollar, sample rate) and how to price that into the next invoice.
7. A deadline card for the consumption-tax election, due Dec 31. If Ben elects, the 10% he pays on Japanese expenses can come back, about ¥90,900 a year per ¥1M of such spending (sample figure). The card names who knows this (tax accountants), shows the two-year lock-in, and puts the official source behind a tap. The app files nothing.
8. A switch to Maya, a freelance illustrator in Austin. Same engine, US catalogue, US dates.

**Status today (Nov 1):** the full screen runs on typed sample data for Ben and the catalogue covers Japan (18 moves) and the US (15 moves). The PayPal client, the Agent Toolkit wiring, the sandbox guard, the verified webhook route and a smoke test are in code. Live PayPal calls in the flow are not wired yet.

**Planned before Nov 12:**
- Switch between Ben and Maya on the screen (planned for Nov 2-3).
- Real create, approve and send in the PayPal sandbox, a Claude agent that drafts, and the paid moment driven by the verified webhook (planned for Nov 4-5).
- Reading a bill from a photo or PDF with Claude, a forwarding inbox, and corrections that become rules (planned for Nov 6-7).
- The runway and "Found for you" fed by real PayPal invoice history (planned for Nov 8).

## How we built it

**PayPal first.** Every PayPal action goes through the PayPal Agent Toolkit. I use its tool definitions and its `run()` dispatcher directly, not its AI SDK wrapper, because that wrapper is pinned to an old AI SDK version. The toolkit is created with `sandbox: true` every time. Its code defaults to live PayPal even though its README says otherwise.

**The draft/send split is the approval gate.** `create_invoice` only creates a draft. `send_invoice` is a separate call. The agent holds only draft and read tools (create, list, get, search, invoice number, delete). Sending, reminders, early-payment discount rules and recording a payment run on the server after the user taps Approve. The agent has no way to send anything.

**Verified webhooks.** The webhook route sends each delivery to PayPal's signature check before anything changes. A missing header, a missing webhook ID or a failed check gets a 400 and is logged as rejected. The browser is never trusted for payment state.

**Sandbox only, enforced in code.** The app refuses to start unless `PAYPAL_ENVIRONMENT=SANDBOX`. The only PayPal host in the code is the sandbox host. There is no live URL to switch to.

**Runway from PayPal history.** The toolkit's invoice tool has no due date, so I do not use one. Each client's expected payment date is the sent date plus their median days to pay, and the worst case uses their slowest. Today this runs on sample history. Feeding it from `search_invoicing` and `get_invoice` is planned for Nov 8.

**The catalogue engine: rows are data, formulas are code, the model only writes wording.**
- Each move is a row in `jp.json` or `us.json`: the user's question, the one fact they did not know, a deadline, steps, traps, an exit note, a tax note, what the app may say and must not say, and dated sources with a confidence tag.
- Each move has a formula in TypeScript, keyed by the same id. The formula decides if the user is eligible and returns the amount with a one-line basis. The language model never produces a number.
- The engine ranks moves for a moment. It applies the house rules before any maths: one suggestion per real event, a free-cash gate, insider moves frozen while a loan application is pending, and nothing suggested that hurts the buffer.
- Only new money counts toward "Found for you". Timing moves (the November tax instalment) and protected money (the tax pot) are shown but not counted.
- Rows that rest on example figures show a "sample" flag on the card.

**Claude** is the model for reading bills and for the agent's wording and reasoning (planned for Nov 4-7). The app uses it for language and never for a yen amount.

**Stack:** Next.js 16 (App Router, TypeScript), React 19, zod 3 (the toolkit uses zod 3), the PayPal Agent Toolkit 1.11, Claude. Hosting on Render, which also gives PayPal a public URL for webhooks (deploy planned for Nov 4-5).

### PayPal APIs used

| API or toolkit tool | What it does in the app | Where in the flow | Status today |
|---|---|---|---|
| Agent Toolkit `create_invoice` | Drafts the USD invoice for the finished work | Act, before approval (agent-held) | Wired; live run planned for Nov 4-5 |
| Agent Toolkit `generate_invoice_number` | Gets the next invoice number for the draft | Act, before approval (agent-held) | Wired |
| Agent Toolkit `search_invoicing`, `get_invoice` | Reads paid invoices per client to learn days to pay | See, runway and "who pays when" | Sample data today; live planned for Nov 8 |
| Agent Toolkit `send_invoice` | Sends the invoice after the user taps Approve | Act, server side after approval | Wired; live run planned for Nov 4-5 |
| Agent Toolkit `send_invoice_reminder`, `setup_invoice_auto_reminders` | Nudges a slow client | Act, server side after approval | Wired |
| Agent Toolkit `create_conditional_rules_for_invoice` | Adds the 2% early-payment discount rule | Act, server side after approval | Wired |
| Agent Toolkit `record_payment_for_invoice` | Marks an invoice paid in PayPal if the sandbox payer flow misbehaves; still fires the paid webhook | Fallback for the paid step | Wired |
| REST `/v1/reporting/balances` | Reads the starting balance for the runway | See, runway start | Planned (permission check pending, see Challenges) |
| REST `/v1/notifications/verify-webhook-signature` | Verifies each webhook delivery before the app acts | Close the loop, paid moment | Route written; live registration planned for Nov 4-5 |
| Webhooks `INVOICING.INVOICE.PAID`, `.CANCELLED`, `.UPDATED`, `.REFUNDED` | Tell the app the invoice changed | Close the loop | Registration script written; planned for Nov 4-5 |
| REST OAuth token | Authenticates every call against the sandbox | All | Working (keys tested) |
| Sandbox accounts | App on a Japan Business account (Ben); a US Personal account is the paying client | All | Set up |

## Challenges we ran into

**PayPal returns a cached access token for about 9 hours.** On Nov 1 the smoke test returned 403 "insufficient permissions" on the balance and invoice checks. I ticked Invoicing and Transaction search on the sandbox app and saved. PayPal then kept returning the token it had issued at 00:30 Tokyo, before the save, until it expired around 09:30. New app features only reach the token after it expires. Lesson: change app permissions early in the day, and write the delay in the README so the next person does not debug a permission that is already fixed. Once the old token expired, the smoke test passed 7 of 7: balance read, and a USD draft invoice created, read and deleted from the Japan sandbox account.

**The research budget ran out.** I researched 218 moves across seven research files covering Japan, the US, the UK, Germany, India, the Philippines and cross-border income. Every research agent hit its search limit. Figures marked "secondary only" or "anecdotal" were not read on a primary page, and "unknown, verify" is an honest blank. So the catalogue is hand-picked (18 for Japan, 15 for the US), every row carries its confidence tag, and rows with example figures show a "sample" flag. A verification pass re-opens each secondary figure on its primary page and settles the known conflicts, such as whether design work for overseas clients counts as an export or as a cross-border digital service, and how PayPal Japan groups its cross-border rate (planned for Nov 9).

**The toolkit is missing pieces.** It has no balance tool, no webhook tools and no due date on invoices, and its code defaults to live PayPal. I call REST directly for balances and webhook verification, derive expected dates from payment history, and set sandbox mode explicitly.

**Saying less.** Japanese money search is full of affiliate blogs, and an unlabelled affiliate recommendation is illegal stealth marketing in Japan. So the app never names a product to buy, never classifies one person's tax position, and labels anything paid. Cutting live search and bank connections from the demo was a decision, not a gap.

## Accomplishments that we're proud of

- A complete loop on one screen: bill, red gap, costed options, approval, paid, gap closed. Today it runs on sample data and is being connected to the live sandbox in steps.
- An approval gate that comes from the structure of the tools, not from a custom permission system. The agent cannot send because it does not hold the send tool.
- A sourced catalogue instead of model memory: 33 moves (Japan 13 insider and 5 baseline, US 10 insider and 5 baseline), each with a formula, dated sources and a "known by" line.
- For the sample Ben, recurring moves come to about ¥1.14M a year (sample figures, many marked illustrative; the largest line, ¥419,200, is the PayPal fee row). For the sample Maya, about $5,400 a year of recurring new money, excluding a health-insurance credit she already holds. These are checks on the engine, not promises.
- One engine, two countries. Maya is a swap of catalogue rows, formulas, deadlines and persona.

## What we learned

- The unit of a finance product is the moment. Education fades within about 20 months. A fact at the decision does not (Fernandes, Lynch and Netemeyer 2014).
- Protective advice scores near zero if you count it as money found. The tax pot saves no yen by itself, so it is pinned first and not counted.
- Keeping the model away from numbers makes the numbers testable. The engine output for Ben and Maya can be checked row by row.
- PayPal's draft/send split already gives an approval gate. Reading the toolkit source before choosing the design saved a custom system.
- Reading the source also showed what PayPal does not give: balances, webhooks and invoice due dates.

## What's next

Not in the Nov 12 build (from the roadmap):

- A transfer advisor, framed as "keep more of each payout": invoice currency, when to convert, withdrawal timing. It never says "leave PayPal".
- A payday router (today at most one advice line, the tax set-aside).
- Miles for flights and the best card per purchase, once there is a sourced card-points row.
- A points wallet with expiry alerts and a cheaper-provider finder.
- A daily money chat, a what-if simulator and a tax pack.
- A full inbox connection as an opt-in source, and PayPal Orders, Subscriptions, Payouts, Vault and Disputes.
- Catalogues for the UK, Germany, India and the Philippines. Their research is done.
- An agent that refreshes a catalogue row or checks a campaign amount at the edges, with citations and a label, approved the same way as a PayPal action.
- A partner or connected-account setup so one app can act for many users. The demo uses the freelancer's own sandbox account.

Cut for good: live bank connections, personalised investment advice, and paying third-party bills through PayPal.

## Built with

`paypal-agent-toolkit` `paypal-invoicing-api` `paypal-webhooks` `paypal-sandbox` `paypal-rest-api` `claude` `anthropic-api` `claude-code` `next.js` `react` `typescript` `zod` `node.js` `render` `vision-model-bill-reading` `ai-agents`

(`vision-model-bill-reading` is planned for Nov 6-7. Remove tags for anything not built at submission.)

## How it meets each judging criterion

| Criterion | How the project answers it |
|---|---|
| Stage 1: PayPal integration is central | The income, the clients, the invoice and the paid moment are all PayPal data. The one action the app takes is a PayPal invoice, through the Agent Toolkit. The catalogue's moves attach to those PayPal events. |
| Technological Implementation | Agent Toolkit used directly with a draft/send split as the approval gate. Verified webhooks. Sandbox-only guard in code. Runway from per-client payment history. Catalogue engine with rows as data and formulas as code, so the model writes wording and no numbers. Several PayPal pieces are live today in code; the full live loop lands Nov 4-5. |
| Design | One screen: See, Know, Act, organised around moments. Every card opens with the user's question, gives their own number and a date, shows the source behind a tap, and offers "not now" and "never for this". Desktop and phone layouts. |
| Potential Impact | A real audience and a measured problem (58% of US self-employed with varying income, 22% struggled to pay bills; 32.4% of Japanese freelancers with a zero-income month). The sample Ben sees about ¥1.14M a year of recurring moves. The same engine runs for Maya in the US. |
| Innovation | Moves that only some other world knows, each naming who knows it. Moments instead of a dashboard. An agent that transacts only on approval. Japanese bill reading (planned for Nov 6-7) and a Japan-first catalogue under a single engine. |
| Presentation | A video of the golden path on the deployed URL, under 3 minutes, English, no music, and no third-party logos other than PayPal's own sandbox pages. This text, plus screenshots. Judges may score from text and video alone, so the video shows every claim above that is built. |

## Try it

Live URL: (planned for Nov 4-5, Render). Repo: (public, MIT license; planned for Nov 4 once the owner approves). Run locally: `npm install`, copy `.env.example` to `.env.local`, add sandbox keys, `npm run smoke`, `npm run dev`. The app refuses to run against anything but the PayPal sandbox.
