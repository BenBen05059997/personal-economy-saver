# Personal Economy Saver: project brief

**Status (Nov 1, 2026):** the screen runs on sample data (runway with expected and worst case, bill to approve to paid flow, client-paid card, deadline strip, "Found for you", Ben and Maya switch, phone layout). The PayPal plumbing exists (sandbox guard, REST client, toolkit split, verified webhook route, smoke test). The Japan and US catalogues run, and sample bills, a card-statement email and the Devpost text and video script drafts are ready.
**Deadline:** submit the evening of Nov 12, 2026, Tokyo (the contest closes Nov 13 05:00 Tokyo, Nov 12 12:00 PT). Decisions are in [DECISIONS.md](DECISIONS.md), work and state in [PLAN.md](PLAN.md).

## 1. The one line, and the three questions

*A daily money assistant for freelancers paid across borders, built on PayPal.*

It is a live planner and executor. With the user's real numbers it answers:

1. **Where am I?** Cash, card spend and statements, bills, what is coming in.
2. **Can I proceed, or should I hold off?**
3. **If I use credit, how do I pay it back** from what is coming in?

Then it does the part it can through PayPal: invoice finished work, remind a late client, and confirm when the money arrives.

## 2. Who it is for

**Ben** is a freelance designer in Tokyo. He is paid in USD through PayPal and lives in yen. He is the demo. **Maya** is a freelance illustrator in Austin, paid through PayPal. One tap switches the screen to her, and it shows the same loop works in dollars.

Why freelancers paid across borders: their problem is timing, not knowledge of products. Income arrives late and lumpy, while card due dates and bills do not move.

- 58% of US self-employed have income that varies month to month, and 22% struggled to pay bills because of it (Fed SHED 2025).
- 32.4% of Japanese freelancers had a ¥0 month last year (Mynavi 2025).
- A text reminder three days before a loan instalment worked about as well as a 25% interest cut (Cadena & Schoar 2011). A reminder tied to a dated obligation is the strongest nudge measured.

Sources are in `research/users/README.md`.

## 3. The daily loop

The loop is the product. Events from the inbox drive everything. Each one shows what it means for the next 30 days and offers one action.

| Something happens | The app shows | The app can do |
|---|---|---|
| A bill arrives (email or photo) | What it is, when it is due, where it lands on the runway | Confirm it |
| A card charge arrives (at home or travelling) | Running total on that card, statement date, due date, covered or not | Remind before the due date |
| A client pays into PayPal | Balance updated, what is now covered, the tax share to set aside | Set it aside |
| A card statement arrives | The real total, the due date, pay in full from where | Remind; invoice first if short |
| The runway shows a shortfall | The cheapest way to cover it | Draft the invoice or reminder; you approve; PayPal sends; webhook confirms |
| A date is near | Only dates tied to his money | One action |

**A bill arrives.** The reader turns an email or a photo into biller, amount, due date and period. A confirmation card shows what it understood. After confirming, the bill sits on the runway on its due date. Action: confirm.

**A card charge arrives.** A card-use email or a receipt adds to that card's spend. The card shows the running total, the statement date and the due date, and whether expected income covers it. Action: a reminder before the due date.

**A client pays.** The PayPal webhook is verified, the balance updates, and the runway shows what is now covered. The card suggests setting aside the tax share of the payout. Action: set it aside.

**A card statement arrives.** The real total replaces the running estimate and sits on the runway at its due date. The app shows how to pay it in full. Action: a reminder, or an invoice first if income does not cover it.

**The runway shows a shortfall.** The app names the day, the amount and the cheapest cover. The cheapest cover is getting paid: invoice finished work, remind a late client, offer an early-payment discount, or accept a partial payment. Action: the agent drafts, the user approves, PayPal sends, and the verified webhook closes the loop.

**A date is near.** Only dates with money attached, such as the statement due date, the 消費税 election by Dec 31 and the 予定納税 reduction request. Action: one, behind a confirm.

## 4. Credit and travel

Credit is part of "where am I". The app never logs into a card.

- **Cards are typed in at setup:** name, statement day and due day.
- **Charges come from emails and receipts.** A card-use email or a receipt becomes spend on that card.
- **Spend rolls into the coming statement.** The statement sits on the runway at its due date, marked covered or not covered by expected income.
- **Reminders, not lectures.** Before a due date the app gives the amount, the date, whether it is covered, and one action: pay in full from the bank, or invoice first if short.
- **Paying back from incoming money** is the third question. The app shows which client payments land before the due date and which would land too late.
- **Never suggested as a fix:** リボ, minimum payments or a loan. Cash is checked before any "pay now".

**Travel example.** Ben is in another country for a week. A hotel booking email and a few receipts arrive. Each one adds to his card's running total. The card shows the statement date, the due date and a "not covered" mark, because the client's invoice is expected after the due date. The app reminds him, shows the gap, and drafts a reminder to the client for him to approve. When the client pays, the mark turns to "covered".

## 5. Inputs and safety

- **Inputs:** a forwarding address (the user forwards bills, card-use emails and receipts) and photo or PDF upload.
- **One reader** handles bills, card-use emails and receipts.
- **Confirmation card.** Every read shows "AI understood this as…" and waits for the user. Corrections become rules, so accuracy builds up. Nothing enters the runway or triggers anything on an unconfirmed read.
- **No bank, card or Gmail login.** The only connection is PayPal. Gmail read access needs a security review and caps test users, so forwarding is the route.
- **Sandbox only, enforced in code.** The app refuses to start unless `PAYPAL_ENVIRONMENT=SANDBOX`. The only PayPal host in the code is the sandbox.
- **Verified webhooks.** PayPal's signature check runs before anything changes. The browser is never trusted for payment state.
- **Approval before anything is sent.** The agent holds only draft and read tools. Send and reminders run on the server after the user taps Approve (the toolkit's draft/send split).
- **Fictional only.** Fictional companies and billers, no real bills or personal data, no third-party trademarks or copyrighted music in the video.

## 6. The runway

A 30-day line of projected daily balance.

- **Cash** is the PayPal balance (read live) plus the bank balance the user types in.
- **Out** is bills and card statements, each on its due date.
- **In** is invoices at two dates. *Expected* is the send date plus that client's median days to pay. *Worst case* is the send date plus that client's slowest payment. Both come from the client's paid invoices in PayPal.
- **Alerts fire on the worst case.** There is no red and green scoring and no false precision. The user sees why one date is the problem before it arrives.

## 7. PayPal: what we use and why

PayPal data goes in, AI reasons over it, and PayPal action comes out.

- **Invoice** finished work and **remind** late clients. The action is getting paid, not paying bills. The billers are not PayPal merchants, so paying them through PayPal would make us a bill-payment intermediary, and paying a bill takes cash away. Getting paid is where PayPal is strongest.
- **Balance** feeds the runway. **Webhooks** confirm that a client paid.
- **Agent Toolkit used directly** (`PayPalAPI.run()` plus its tool definitions), not its AI SDK wrapper, which is pinned to an old AI SDK.
- **Fee framing.** The biggest single cost for a foreign-paid freelancer is the cross-border fee stack, about 7% in Japan (research figure: 3.6% plus 0.5% plus $0.30 to receive, plus 3% to convert). The app helps the user keep more of each payout: price the fee into the next invoice, choose the invoice currency, convert in bulk. It never says "leave PayPal".
- **Stack:** Next.js 16 (App Router, TypeScript), zod 3, PayPal Agent Toolkit 1.11, Claude as the model, Render for hosting.
- **Sandbox accounts:** the app "Personal Economy Saver" is on the Japan Business sandbox account (Ben). The US Personal sandbox account is the client who pays.

### Toolkit reference (`@paypal/agent-toolkit` 1.11.0, Apache-2.0, source read Oct 31, 2026)

- Each tool is a prompt, a zod schema and one REST call. `PayPalAPI.run(method, args)` runs any tool by name. Tools are switched on per product through `configuration.actions`.
- `create_invoice` makes a **draft**. `send_invoice` is a separate call. That split is the approval gate. The agent gets the draft tool; the send tool stays server-side. The same applies to `send_invoice_reminder` and `create_conditional_rules_for_invoice`.
- `create_invoice` has no due date or payment term. Expected payment date is send date plus the client's observed days to pay.
- **The code defaults to live** (`sandbox ?? false`), though the README says sandbox. Set `sandbox: true` explicitly.
- **No balance tool and no webhook tools.** Balance is a direct REST call (`/v1/reporting/balances`). Webhooks are direct REST with signature verification.
- Errors come back as JSON strings (`ok:false`, `code`, `message`), so failure paths can be shown honestly.
- `search_invoicing` (filter by status PAID and dates) plus `get_invoice` give each client's payment history. `list_transactions` caps ranges at 31 days.
- `record_payment_for_invoice` marks an invoice paid through PayPal and still fires the paid webhook. It is the fallback if the sandbox payer flow misbehaves while recording.

## 8. Suggestions (Know, secondary)

Know is the sourced catalogue of wealth moves per region. It is secondary. A suggestion appears only when it is tied to a daily event. The list:

- pay the statement in full and on time;
- which card for this spend;
- pay in local currency abroad;
- set aside the tax share of each payout;
- price the PayPal fee into the next invoice;
- the one or two tax dates with real money attached: the 消費税 election by Dec 31 and the 予定納税 reduction request.

The rest of the catalogue sits in a secondary "Found for you" panel. Japan has 20 moves and the US has 16, both checked on primary pages on Nov 1. Job-change moves, subsidies, self-back, IPO lotteries and other regions are parked.

**Rules for every suggestion**

1. One per real event.
2. The user's own number, currency and a date.
3. A one-line why, with the source behind a tap.
4. One action behind a confirm.
5. "Not now" and "never for this".
6. Check cash before any "pay now".
7. Never suggest リボ, minimum payments or a loan as a fix.
8. Information, not brokerage. Never name a product to buy, never classify one person's tax position, label anything paid.

The legal line: 金商法 and 税理士法 in Japan, SEC and state adviser registration in the US, 景品表示法 for unlabelled affiliate links. Research is in `research/users/`.

## 9. Judging and where we aim

**Aim:** Best Use of PayPal + AI first, Most Impactful second, Render as the sponsor prize. Agentic Commerce gets one sentence in the text. AG Grid only if everything else is done. Six of the thirteen judges are PayPal staff, and our loop is PayPal data in, AI reasoning, PayPal action out.

**Official rules** (verified Oct 31, 2026, paypalaihackathon.devpost.com):

- **Stage One is pass or fail:** does the project fit the theme and apply PayPal's APIs. "PayPal integration is central to the project" is the one hard requirement.
- **Stage Two: five criteria, equally weighted.** Tie-break order: Technological Implementation, Design, Potential Impact, Innovation/Idea, Presentation.
  - *Technological Implementation:* "How thoroughly and skillfully does the project use PayPal Developer Platform and AI tool(s)? … a working, non-trivial implementation?" Ours: an agent acting through the Agent Toolkit behind an approval gate, verified webhooks, balance, invoice-history reasoning.
  - *Design:* "a complete, coherent product experience, not just a technical proof of concept." Ours: one daily loop on one screen.
  - *Potential Impact:* "a credible, specific case for solving a real problem for a real audience." Ours: freelancers paid across borders, with Ben's real numbers.
  - *Innovation/Idea:* bills, card charges and receipts read from the inbox, a runway computed from PayPal history, and an agent that transacts only on approval.
  - *Presentation:* "Does the video clearly demonstrate the project working end-to-end?" Ours: the loop, recorded on the deployed URL.
- **Judges may not run it.** They "may choose to judge based solely on the text description, images, and video." The video and the text carry most of the score.
- **Prizes:** 1st $12,000, 2nd $8,000, 3rd $5,000. Honorable mentions $5,000 each: Most Creative, Most Impactful, Best Demo Delivery, Best Use of PayPal + AI, Best Use of Agentic Commerce. A project can win one grand or one honorable prize, plus one sponsor prize. Sponsor prizes: AG Grid ($5,000 / $2,000 / 3 × $1,000), APIMatic (3 × $1,000), Bryntum (3 × $1,000), Channel3 ($1,500), Render (credits).
- **Submission gates:** a functional demo (hosted URL or complete run instructions; mockups fail); a public repo with a visible open-source licence; a text description; the tools used and how; a video under 3 minutes on YouTube showing the project running, with no third-party trademarks or copyrighted music; English.
- **Eligibility:** open worldwide except sanctioned countries, Brazil and Quebec. Japan residents are fine.
- **Dates:** submissions close Nov 12, 2026 12:00 pm PT. Judging Dec 1 to 15. Winners on or around Dec 21.

## 10. What must exist by Nov 12, in risk order

State for each item is in [PLAN.md](PLAN.md).

1. **The PayPal loop running for real on the deployed URL:** balance, invoice draft, approve, send, client pays in the sandbox, verified webhook, runway updates.
2. **Cards, charges and statements on the runway:** cards with statement and due days; card spend rolling into the coming statement; "covered / not covered"; due-date reminders; travel sample data.
3. **The reader:** bills, card-use emails and receipts by forwarding or photo, with the confirmation card.
4. **Daily moments on real data:** charge arrived, client paid, statement arrived, shortfall, date near.
5. **The video:** electricity bill, short, invoice, paid, covered; then charges arriving on a trip with their due dates; under 3 minutes; recorded on the deployed URL.
6. **Submission:** Devpost text, public repo with licence, screenshots, live URL.
7. Maya switch, AG Grid, polish: only if 1 to 6 are done.

## 11. Not for Nov 12

Live bank or card connections. Gmail inbox scan. Personalised investment advice. Paying bills through PayPal. A transfer advisor. Miles optimisation. Daily chat. A what-if simulator. Other regions' catalogues.

## 12. Decisions and open questions

Current decisions, open questions and facts to verify live in [DECISIONS.md](DECISIONS.md).
