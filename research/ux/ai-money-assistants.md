# How AI money assistants act, and what our app lacks

Research date: 2026-11-04. Web research only.

Evidence key: **[V]** read on the vendor's own page. **[S]** secondary source (press, listing, third-party review). **(unverified)** memory or weak source; check before relying on it. Many vendor help pages returned 403 or were not indexed, so several rows rest on press coverage. Where a field says "not stated", I looked and the source does not say.

---

## 1. Product by product

### Cleo (Autopilot, Cleo 3.0)
- **See:** spending patterns, emerging risks and life changes, and a baseline "Onramp" analysis. [S](https://techintelpro.com/news/finance/financial-services/cleo-autopilot-ai-executes-your-financial-goals-automatically)
- **Does alone:** carries out decisions the user already approved, inside user-set guardrails. Today only merchant blocking; automated execution is described as coming later. [S](https://techintelpro.com/news/finance/financial-services/cleo-autopilot-ai-executes-your-financial-goals-automatically)
- **Needs approval:** the plan and the rules are approved first; the system then acts "with ongoing consent". US waitlist only. [S](https://www.streetinsider.com/PRNewswire/Cleo+Launches+Autopilot%3A+Automating+Your+Money+Moves/25951686.html)
- **Review and undo:** not stated (how consent is revoked, dollar limits).

### Copilot Money (Copilot Intelligence, Money Assistant)
- **See:** transaction name, amount, weekday and card, for categorising. [V](https://intercom.help/copilotmoney/en/articles/8182433-copilot-intelligence-for-spending)
- **Does alone:** after you review 30 transactions it applies a category only when confident, with an "Intelligence" badge. [V](https://intercom.help/copilotmoney/en/articles/8182433-copilot-intelligence-for-spending)
- **Needs approval:** nothing; low-confidence items stay unlabelled in the To Review inbox.
- **Review and undo:** open the transaction and pick another category; the top two guesses are shown first. The FAQ also lists a conversational "Money Assistant" but I found no details of its abilities. [V](https://www.copilot.money/faq)

### Monarch Money (AI Assistant, Weekly Recap)
- **See:** only the data a task needs, such as the transactions behind a question, which can include payee names and notes. [S](https://help.monarch.com/hc/en-us/articles/37526856682260-AI-in-Monarch)
- **Does alone:** explains changes and helps navigate the app; AI categorisation is built in and cannot be opted out of. I found no official statement that the assistant edits data. [S](https://help.monarch.com/hc/en-us/articles/37526856682260-AI-in-Monarch)
- **Needs approval:** not applicable (answers only, as far as found).
- **Review and undo:** the Assistant, Insights and Weekly Recap can be hidden under Settings > Preferences. [S] The help page warns it can make mistakes and is not financial advice.

### Rocket Money (Rowan, announced Sept 2026)
- **See:** subscribers' accounts continuously, plus email integration for free-trial tracking. [S](https://fintech.global/2026/09/03/rocket-money-launches-ai-agent-to-manage-finances/)
- **Does alone:** proactive flags for expiring trials, price rises and forgotten subscriptions.
- **Acts on request by text:** cancel subscriptions, negotiate rates, pursue refunds, recategorise, set reminders, build budgets. Part of Premium+ at $15 a month.
- **Needs approval and undo:** the article does not say whether Rowan asks before acting or keeps a history. Not verified against Rocket Money's own pages.

### Origin (proactive AI Advisor)
- **See:** the user's whole financial picture; hundreds of daily checks across cash flow, debt, credit, tax and more. [S](https://useorigin.com/resources/blog/financial-advice-without-having-to-ask)
- **Does alone:** surfaces "one clear action" per item with reasoning, and rolls them into a Financial Health Score. It advises rather than moves money.
- **Needs approval, undo:** not stated. The support article returned 403. Launch status is unclear (early access vs live).

### Fina
- Only a thin directory listing about syncing bank accounts and automated tracking. No agent behaviour found. Skip.

### Credit Karma (Intuit Assist)
- **See:** the member's credit and money data in the app. **Does alone:** answers, insights and notifications that suggest actions; a Debt Assistant and Refund Assistant were announced. **Approval and undo:** not stated. Dates uncertain. [S](https://www.accountingtoday.com/news/intuit-infuses-credit-karma-turbotax-with-ai-agents), [V](https://www.creditkarma.com/about/releases/introducing-intuit-assist-for-credit-karma)

### Intuit QuickBooks Payments Agent (the closest match to our nudge)
- **See:** invoice and payment history and trends. [V](https://quickbooks.intuit.com/learn-support/en-us/help-article/intuit-assist/get-started-payments-agent/L5y4ix9cA_US_en_US)
- **Does alone:** after approval, sends automatic reminders; suggests a late-fee amount.
- **Needs approval:** the reminder schedule is shown and approved before use; reminder text is editable; extracted invoice data may need verification.
- **Review and undo:** reminders and late fees each switch off in Settings > Sales. Claimed result: paid about 4 to 5 days faster (Intuit's own numbers; they differ between pages). [S](https://quickbooks.intuit.com/invoicing)

### Mercury (AI and MCP)
- **See:** balances, transactions, cards, recipient activity, read-only, through OAuth with tokens that expire after 24 hours. [V](https://mercury.com/blog/march-2026-product-updates)
- **Does alone:** AI cash-flow alerts, a Q&A chatbot, auto-categorisation (you approve or edit; it adapts). Optional invoice reminders 7 days and 1 day before, and 1 day and 7 days after due; they stop when paid.
- A "Command" agent for workflows is reported for June 2026, from a directory listing only. (unverified)

### Wave, FreshBooks, Bonsai, HoneyBook
- No confirmed 2025 to 2026 agentic launch from any of them. FreshBooks and Wave AI claims in blog comparisons conflict with their own pricing pages. (unverified) Their reminder features are in section 2.

### PayPal's own agent story
- **Agent Toolkit and MCP server:** `@paypal/mcp` runs locally with `npx`, authenticates with an access token, defaults to SANDBOX, and exposes `create_invoice`, `list_invoices`, `get_invoice`, `send_invoice`, `send_invoice_reminder`, `cancel_sent_invoice`, `create_order`, `pay_order`, `create_refund` and more. The README describes **no confirmation step**, including before sending invoices or refunds, and only warns that output may be inaccurate. [V](https://github.com/paypal/paypal-mcp-server)
- **Agentic commerce:** PayPal's pitch is agents that "shop, buy, and pay on our behalf", with Agent Ready (accept payments in AI channels) and Store Sync. The page does not mention user consent or approval. [V](https://www.paypal.ai)
- **Community guidance:** keep judgment-heavy cases with humans, automate routine low-risk work, and monitor agent activity. No confirmation or limit pattern is documented there. [V](https://developer.paypal.com/community/blog/best-practices-commerce-agents/)
- **Reading:** PayPal leaves the human-approval pattern to the integrator. Our draft versus send split with a user tap is therefore our own design, not a PayPal pattern we can cite.

---

## 2. Late-payer features in invoicing tools

| Feature | Who has it | What it looks like |
|---|---|---|
| Automatic reminder schedule | PayPal Invoicing (on by default, timing set in Invoice Settings) [V](https://www.paypal.com/us/brc/article/invoicing-automation); HoneyBook (7 days before, on due date, 2 days after, editable text) [V](https://honeybook.com/product/payment-reminders); FreshBooks (up to three per client, remembered for later invoices) [V](https://support.freshbooks.com/hc/en-us/articles/227559727-What-are-Late-Payment-Reminders-and-Late-Fees-); Mercury (7d and 1d before, 1d and 7d after) [V](https://mercury.com/blog/march-2026-product-updates) | Fixed offsets from the due date, stop on payment |
| AI-proposed schedule with approval | QuickBooks Payments Agent [V](https://quickbooks.intuit.com/learn-support/en-us/help-article/intuit-assist/get-started-payments-agent/L5y4ix9cA_US_en_US) | The agent suggests, the user approves, messages are editable |
| Manual nudge, rate limited | PayPal: up to 2 manual reminders per 24 hours [V](https://www.paypal.com/us/cshelp/article/how-do-i-send-a-reminder-for-an-invoice-or-money-request-help1152) | A "Send reminder" button |
| Late fees | FreshBooks (flat or percent after N days; new invoices only) [V](https://support.freshbooks.com/hc/en-us/articles/227559727-What-are-Late-Payment-Reminders-and-Late-Fees-); QuickBooks (AI-suggested) [V]. PayPal has no built-in late fee setting that I found [S](https://www.paypal.com/us/brc/article/speeding-up-collection-of-late-payments) | A policy applied to new invoices |
| Partial payments | PayPal (`allow_partial_payment`, `minimum_amount_due`, "Partially Paid" status) [S](https://www.paypal.com/us/cshelp/article/how-do-i-create-and-send-an-invoice-help319); FreshBooks (per invoice plus instalment schedules) [V] | A toggle at invoice creation |
| Payment plans | HoneyBook installment table with overdue and upcoming status [V](https://honeybook.com/product/payment-reminders) | Per-installment status |
| Client payment history used for prediction | QuickBooks uses history and trends [V]; an "adaptive tone from client history" claim for FreshBooks AI has no vendor source (unverified) | Late-payment prediction per invoice |
| Pay-by nudge before due date | HoneyBook, Mercury, FreshBooks (pre-due reminders) | A reminder before the date, not only after |
| Expected-payment forecasting into cash flow | Mercury cash-flow alerts [V]; I found none that turns a late client into a personal "short on the 27th" sentence (unverified, absence of evidence) | Business dashboards, not personal runway |

---

## 3. Memory, briefs, standing rules, consent and logs

- **Memory across chats:** Cleo 3.0 stores summaries, topics and sentiment of past chats (goals, recurring spending, stress points) and retrieves them only in open-ended talks, because memory hurt quick lookups like balances. I found no view, edit or delete controls. [V](https://web.meetcleo.com/blog/Introducing-cleo-3-0) QuickBooks remembers a user's choice of default invoice email text. [V](https://quickbooks.intuit.com/learn-support/en-us/help-article/intuit-assist/get-started-payments-agent/L5y4ix9cA_US_en_US) Copilot and Mercury "learn" from category corrections. [V]
- **Briefs and proactivity:** Monarch has a Weekly Recap that can be hidden. [S] Origin runs daily checks and surfaces one action each. [S] Rocket Money's Rowan flags trials and price rises. [S] Mercury sends cash-flow alerts. [V]
- **Standing rules:** Cleo Autopilot is the clearest case: user-set guardrails plus approved plans, then action under ongoing consent. [S] QuickBooks reminders and late fees are standing policies with a Settings switch. [V] HoneyBook and Mercury use fixed schedules on by default or opt in.
- **Consent pattern:** approve a plan or schedule once, edit the text, switch it off in settings. Per-action approval appears only where money leaves (our model; Cleo's execution is still "coming later").
- **Activity log, undo, "done by AI" labels:** the only visible label I found is Copilot's "Intelligence" badge on AI-set categories, with a one-tap correction. [V] I found no product that documents an agent activity log with undo. This is a gap in the market, and in our app Activity already records events.

---

## 4. Agent visibility (MCP, APIs, exports)

- **Mercury** ships a first-party read-only MCP connection for ChatGPT and Claude (OAuth, 24-hour tokens). It is the only first-party personal or business finance MCP I could confirm. [V](https://mercury.com/blog/march-2026-product-updates)
- **PayPal** ships `@paypal/mcp` with read and write tools, token auth and no approval gate. [V](https://github.com/paypal/paypal-mcp-server)
- **YNAB** has only community MCP servers on its personal access token, several read-only by default. [S](https://mcpservers.org/servers/hs737/mcp-server-for-ynab)
- **Monarch** has community MCP servers and an unofficial SDK, no official one found. [S](https://glama.ai/mcp/servers/jamiew/monarch-mcp)
- **Copilot Money, Origin, Cleo, Rocket Money:** no official MCP or user API found. (unverified)
- Third-party aggregators (Truthifi, BankSync, FinContext) expose bank data to Claude or ChatGPT, some read-only. [S](https://walnutinvest.com/resources/best-finance-mcp-servers-2026)
- I found no consumer finance app that publishes a versioned JSON Schema of the user's own data.

---

## 5. Gap table for our app

| Feature | We have | Others have | Worth adding before Nov 12? |
|---|---|---|---|
| Draft-only AI writes, human tap to send | Yes, 5 draft tools, send only from the approve route | PayPal's MCP has no gate; QuickBooks approves schedules | Already done; make it the demo's headline |
| Ask chat over a pure money engine | Yes, 16 tools | Monarch, Copilot, Mercury chat | Done |
| MCP server, revocable token, read plus draft | Yes | Mercury read-only; PayPal ungated | Done; demo it |
| Versioned export and JSON Schema | Yes | None found | Done; mention in the pitch |
| Late-client sentence in personal runway | Yes | None found | Done |
| Nudge a late client via PayPal, approved | Yes, one at a time | PayPal manual reminder; QuickBooks scheduled | Done |
| Standing rule ("nudge anyone 7 days late") | No | QuickBooks schedule, Cleo guardrails | **Yes**: smallest version is one setting that makes the cron draft a nudge into To check; user still taps |
| Cron that uses the model | No | Origin, Rowan proactive | **Yes**: one daily brief line written by Claude from engine numbers; cheap and visible |
| Activity log with "by AI" label | Activity exists, no AI label | Copilot badge only | **Yes**: tag events and pending rows as made by Ask or MCP; tiny change, strong trust story |
| Undo for AI drafts | Reject in To check | None documented | No: rejecting a pending row already works |
| Agent memory | No | Cleo | No: needs consent and delete UI, risky in 8 days; use a short "what I know about you" note only if time remains |
| Client payment history / typical lateness | Not shown | QuickBooks prediction | **Yes**: "Northwind paid 9 days late on average" from existing paid events feeds the forecast wording |
| Late fees | No | FreshBooks, QuickBooks | No: PayPal has no built-in fee and fees add legal risk |
| Partial payments | No | PayPal API supports it | No: touches webhook math and the sentence |
| Bank connection | No, typed balance | All consumer apps | No: out of scope, and typed balance is a privacy selling point |
| Cancel subscriptions, negotiate bills | Reminders only | Rowan | No: we are information-only by design (D7) |
| Sandbox-only PayPal guard | Yes | Not applicable | Done; show it |

---

## 6. Recommendations (ordered by hackathon value)

1. Show the approval gate as the story: PayPal's own MCP server and agentic-commerce pages document no confirmation step, so open the demo with the agent drafting an invoice and the user tapping Approve.
2. Add one standing rule, "draft a nudge when a client is N days late", that the daily cron applies as a pending item, which matches QuickBooks and Cleo without removing the tap.
3. Make the daily cron write one Claude-phrased brief line from engine numbers, so the app is visibly proactive.
4. Label every row and Activity event created by Ask or MCP as "drafted by AI" with the tool name, since no competitor documents an agent log.
5. Show each client's typical lateness from past paid events in the sentence and on the invoice review.
6. Demo the MCP server in Claude Desktop reading `household_snapshot`, and point to the committed JSON Schema as something no consumer finance app publishes.
7. Offer a pre-due "pay-by" nudge draft a few days before the due date, since HoneyBook and Mercury both remind before the date.
8. State in the pitch what we leave out on purpose (late fees, bank login, cancelling things for you) so judges read it as a safety choice.
