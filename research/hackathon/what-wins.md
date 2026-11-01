# What wins financial-product hackathons, and what PayPal's judges want

Research date: 2026-11-01. Web research only.

Method: I pulled winner lists straight from Devpost's winner data, not from summaries. That covers 13 payment- or fintech-sponsored Devpost hackathons (97 winning entries) and 14 large AI hackathons from 2025–26 (148 winning entries). For every winner I recorded the tagline, the "Built With" tags, the number of team members and the YouTube video length. I also read sponsor winner posts, Devpost and MLH judging guidance, and the PayPal hackathon's own pages (overview, rules, resources, updates, FAQ, discussions).

Labels: **[inf]** marks my own inference. **[2nd]** marks a secondary source I could not check against the original.

---

## 0. Facts about this contest that change the strategy

- **Field size.** 26,140 registrants as of 2026-11-01. For comparison, Square + Google AI 2023 had 2,431 and Gemini 3 had 35,499. Expect well over a thousand submissions [inf]. Judges will spend minutes on each one, not hours. https://paypalaihackathon.devpost.com/
- **Tie-break order.** Ties are broken criterion by criterion in the order listed, and **Technological Implementation is listed first**. So when scores are equal, the deeper PayPal + AI integration wins. https://paypalaihackathon.devpost.com/rules
- **Stage 1 wording.** The project must "reasonably appl[y] the required APIs/SDKs featured in the Hackathon" (rules). The overview page says "Any AI tool works, as long as PayPal integration is central".
- **Video rules.** Under 3 minutes ("judges aren't required to watch past that"). It "must show the project functioning on the device it was built for". https://paypalaihackathon.devpost.com/
- **Working demo required.** "judges must be able to actually run or interact with a working build… A design mockup, static prototype, or non-functional demo does not meet this requirement." If the site needs a login, the login details must be in the testing instructions (rules).
- **PayPal's own example list already contains our idea.** Its resources page lists "a dashboard that shows freelancers every payment they've received across clients" and "an invoicing tool built for freelancers who bill in multiple currencies". https://paypalaihackathon.devpost.com/resources
  - This hurts us on **Innovation** ("does the project differ from existing concepts?").
  - Whatever is new has to be stated in the first sentence of the pitch.
- **PayPal's framing of AI agents (same page).** Agents should "use PayPal to take action on a user's behalf — not just recommend, but actually transact."
- **Organiser's last-minute advice (update, ~Oct 29).**
  - "Make PayPal and AI impossible to miss. Name both in your description, 'Built With' section, and video, and show them working."
  - "Give judges something to run: a hosted demo URL or clear run instructions."
  - Projects submitted by **Thu Nov 5** get an early eligibility check. https://paypalaihackathon.devpost.com/updates/47305-two-weeks-to-go-get-your-project-checked-early
- **Who judges.**
  - 6 PayPal staff: 3 Developer Advocates (Jo Franchetti, Eddie Jaoude, Marco Podien), 1 Software Engineer, 1 Engineering Manager and 1 Senior PM.
  - 7 judges from sponsor companies: AG Grid, APIMatic, Bryntum, Channel3, Elastic, Postman and Render.
  - The PayPal developer advocates ran the kickoff and demoed the **PayPal AI Toolkit, sandbox and MCP**. They will recognise their own tools on sight [inf].
- **Prize stacking.** One project can win at most one sponsor prize plus one grand prize or one honourable mention (FAQ). AG Grid's prizes ($5k / $2k / 3 × $1k) are a separate pool from the main prizes.

---

## 1. Winners table

How to read it:
- **"Why it won"** is only what the organiser or judges said. Most sponsor posts describe the winners without giving a reason, and I mark those "no stated reason".
- **"UI"** means visible design facts from the write-up. I could not play the videos: YouTube blocked automated viewing.
- **Team / video** gives the number of listed team members and the video length in seconds.

| Contest | Year | Project | Pitch (1 line) | Sponsor API use | UI (from write-up) | Team / video | Why it won (organiser/judge words) | Source |
|---|---|---|---|---|---|---|---|---|
| PayPal BattleHack World Finals | 2013 | Donate Now (Moscow) | A beacon plus phone app lets you donate instantly to a nearby cause | PayPal API (required) plus one sponsor API | Native iOS/Android apps and hardware beacon | n/a | Criteria: "code, quality of idea, and overall experience"; no stated reason | https://thenextweb.com/news/donate-now-scoops-100000-top-prize-paypals-global-hackathon-quick-donation-app |
| PayPal BattleHack World Finals | 2015 | ifCar (Venice) | Sensors make any car "smart": parking, child/pet alerts, theft deterrence | PayPal, Braintree or Venmo APIs (exact one not stated) | Hardware plus app | 4 / n/a | Judge John Lunn: "potential to democratize access to the technical features of high-end cars" | https://newsroom.paypal-corp.com/Team-from-Venice-Wins-BattleHack-World-Finals |
| PayPal Hack-ATL (in person) | 2018 | FundMyCollege (1st, Most Impactful) | College funding app | Not tagged | Android | 4 / 143 | No stated reason | https://devpost.com/software/fundmycollege |
| PayPal Hack-ATL | 2018 | PayPal Teen (2nd; Best Idea, Best Implementation, Most Feasible) | PayPal for an "untapped market" of teens | braintree-api, paypal-sandbox | NativeScript app | 5 / 117 | Multiple judge awards; no text | https://devpost.com/software/paypal-teen |
| PayPal Hack-Chicago | 2019 | Glim (1st) | "Friendly, simple repayment tool" that builds debt-payoff habits | Not tagged | Designed in Sketch/Illustrator; React Native | 5 / 131 | No stated reason | https://devpost.com/software/team-1-ayn4vs |
| PayPal Dev Days hackathon (24h, San Jose) | 2025 | CrawlerPal (1st) | "Paywall AI agent assistant" | PayPal APIs; track was "agent… leverages MCP Server, Agent Toolkit or PayPal APIs" | n/a | 2 / live demo | "wowed the judges"; final pick by 3 PayPal executives | https://developer.paypal.com/community/blog/winners-dev-days-hackathon |
| PayPal Dev Days | 2025 | Codebusters (2nd) | Migrated Shopware 6's PayPal plugin from JS SDK v5 to the v6 beta | PayPal JS SDK v6 | n/a (developer tool) | n/a | No stated reason | same |
| PayPal Dev Days | 2025 | Rosen (3rd) | Global social trading app on PYUSD | PYUSD | n/a | 2 | No stated reason | same |
| Square Small Business Hackathon | 2020 | Hurdlr (2nd, Services) | Automatically tracks self-employed expenses and taxes; "Deduction Finder" | Square | Native iOS/Android | 1 / 161 | No stated reason | https://devpost.com/software/hurdlr-s-automatic-business-expense-deduction-finder |
| Square Unboxed | 2021 | Flash Order (1st, Most Creative) | "Press one button then pay with Square Terminal" | Terminal API | Physical button plus iOS | 2 / 177 | No stated reason | https://devpost.com/software/flash-order-one-button-ordering |
| Square POS_sible | 2021 | Cadence (Grand Prize) | "Powerful automations for small business owners" | Gift Cards API | React | 2 / 96 | No stated reason | https://devpost.com/software/cadence-iba7ef |
| Square Unboxed | 2022 | tinytab (Grand, $20k) | "A teeny-tiny POS": servers take orders and payments from an Apple Watch | Square payments | watchOS/SwiftUI; highly specific form factor | 2 / **40** | Square: "servers can use technology without appearing sucked into their phone" | https://developer.squareup.com/blog/announcing-the-winners-of-the-square-unboxed-hackathon/ |
| Square Unboxed | 2022 | Custom Payments (Best Checkout API) | Pay several invoices at once or a partial amount | Invoices, Orders, Checkout APIs | Next.js | 6 / 147 | No stated reason | https://devpost.com/software/custom-pay |
| Square Emerging Tech | 2023 | Payable Kiosk (1st, $20k) | Turns any Google Form into a self-service payment kiosk | Terminal plus QR checkout; data written to Google Sheet | Uses tools sellers already know (Google Forms) | 5 / 222 | Organiser description only: "transforms any Google Form into a… payment-capable, self-service kiosk" | https://developer.squareup.com/blog/announcing-winners-of-the-square-hackathon-for-emerging-technologies/ |
| Square Emerging Tech | 2023 | Square AI (2nd) | AI psychographic analysis of sales data plus campaign generation | Square data, ChatGPT | Charts plus TTS | 2 / 117 | No stated reason | same |
| Square Emerging Tech | 2023 | B2B Invoicing (Best Terminal/Subscriptions/Invoices API **and** Most Impressive Technical) | Customer portal to view invoices and pay fully or partially; credit limits | Invoices, Subscriptions, Customers, Cards | Figma, MUI, Tailwind | 10 / 116 | No stated reason | https://devpost.com/software/b2b-invoicing |
| Square + Google AI | 2023 | **SquareSense AI (1st, $22k)** | AI chat, generated interactive charts, "AI analyst" over a store's data | Square data plus Vertex AI | Feature-dense AI dashboard ("Fancy animated AI chat button") | **1** / Vimeo | Organiser: "seamlessly integrates cutting-edge AI with Square"; criteria: idea, implementation, business value, in-person/online, community impact | https://developer.squareup.com/blog/announcing-winners-of-the-square-google-ai-hackathon/ |
| Square + Google AI | 2023 | Aisle (2nd, $18k) | Webcam POS recognises products: "no barcodes, no touch" | Square payments | Single-purpose checkout | 5 / 198 | Organiser: "removing the friction of scanning item barcodes" | same |
| Square + Google AI | 2023 | Seller AI (Best Terminal/Subscriptions/Invoices) | Restaurant inventory, menu and invoices with AI; the customer receives the invoice by email | Square Invoice API, OAuth | React dashboard | 4 / 193 | No stated reason | https://devpost.com/software/seller-ai |
| Rapyd Fintech Grand Prix | 2021 | Rapyd G-Force (Overall) | No-code Rapyd checkout inside Google business tools | Rapyd Checkout | Apps Script | 2 / **454** | No stated reason | https://devpost.com/software/rapyd-g-force |
| Rapyd | 2021 | Moolah (Judges' Choice) | Kids'/teens' first debit card plus gamified money lessons | Rapyd issuing/wallet | React | 2 / 195 | No stated reason | https://devpost.com/software/diaper |
| Finastra Hack to the Future | 2019 | Financial Assistant on FB Messenger (Consumer Banking) | "AI assistant within FB Messenger to transform your financial life" | Finastra account-info plus payments APIs | Chat UI | 4 / 163 | No stated reason | https://devpost.com/software/financial-assistant-on-fb-messenger |
| Cornell FinTech Payments | 2024 | SafeSwap (1st) | Instant daily pay converted to PYUSD for Nigerian workers | PYUSD, Coinbase | No video | 4 / none | No stated reason | https://devpost.com/software/safeswap |
| MNEE (programmable money) | 2025–26 | Flowpay (Best AI/Agent Payments) | Extends x402 with streamed payments when an agent hits a paywall | x402 / MNEE | React | 1 / 300 | No stated reason | https://devpost.com/software/flowpay-5mefh4 |
| AWS AI Agent Global | 2025 | Province (3rd) | Conversational tax agent: reads W-2/1099, fills Form 1040, explains the maths | Bedrock (document automation), AgentCore | Chat plus forms | 1 / 170 | No stated reason | https://devpost.com/software/province |
| Code with Kiro | 2025 | **Denarii (2nd)** | Answers "Should I buy this?" with a weighted decision score plus voice/chat advisor | Kiro (the dev tool sponsor) | Purchase analyser plus "pro mode" | 1 / 214 | No stated reason | https://devpost.com/software/denarii |
| Perplexity Hackathon | 2025 | Briefo (Best Finance) | Social feed with AI financial summaries | Sonar API | App | 1 / 188 | No stated reason | https://devpost.com/software/briefo |
| Google Vertex AI Agent Builder | 2024 | ArthaRaksha (Grand) | Gen-AI protection from financial fraud | Vertex Agent Builder | n/a | 2 / 263 | No stated reason | https://devpost.com/software/artharaksha |
| **Agents for Humans** | 2026 | **Tally (Grand)** | "She feeds twelve kids and files paperwork for every bite": a photo of the plate leads to a checked, approved meal-programme claim | AWS Bedrock AgentCore (Code Interpreter computes the claim) | "Both themes are designed, not inverted"; audit trail; reviewer view | 2 / 263 | No stated reason. The write-up leads with a dollar figure ("$436.92 a month unclaimed") and dated sources | https://devpost.com/software/tally-hi3t0w |
| Google Cloud Rapid Agent | 2026 | How Did I? (Fivetran 3rd) | Agentic e-commerce operator: diagnoses revenue leaks, then "drafts owner-approved fixes in one tap" | Fivetran MCP, Vertex | "Daily Pulse / Mission Console / Approval Queue"; seeded demo data disclosed | 1 / 195 | No stated reason. Write-up: "They need an operator, not another dashboard." | https://devpost.com/software/how-did-i |
| All Things Agentic | 2026 | Shoots (Honourable Mention) | "You take the photos. Shoots does the [bookkeeping]" | Gemini | Every claim linked to evidence; dataset disclosed | 1 / 237 | No stated reason | https://devpost.com/software/shoots |
| Coinbase Agents in Action | 2025 | Uniicon (Best CDP Wallet) and others | Agent payments on x402 / CDP | CDP Wallet, x402 | n/a | n/a | Names only **[2nd]** | https://www.coinbase.com/developer-platform/discover/launches/agents-in-action-winners |
| Arc Agentic Commerce (lablab) | Jan 2026 | NewsFacts (1st on-site), AisaEscrow (2nd) | Agentic payments in USDC | Circle Arc | n/a | n/a | **[2nd]** | https://lablab.ai/ai-articles/agentic-commerce-on-arc-ai-hackathon |
| freee App Award (JP) | 2020 | kansapo (Grand, ¥1M), by a tax-accountant firm | Accountant support app on freee APIs | freee accounting API | n/a | firm | Criteria: "Essential (does it capture the real workplace problem)", "Innovative", "EASY&FUN" | https://www.freee.co.jp/event/app-award-2020/ |
| SMBC Mirai Hackathon (JP) | 2016 | Grow up Care System (Glory) | Care homes replace passbook and seal with face login; families get a live statement | Bank APIs | n/a | n/a | Criteria include market need, viability, feasibility, "passion", deliverables | https://thebridge.jp/2016/10/smbc-1st-mirai-hackathon-demo-day |
| PayPay Hackathon in Product (JP, internal) | 6th ed. | PayPay Quest | Daily quests with the mascot to cross-sell group services | Internal | Gacha, dress-up | ≤5 / 180-second pitch plus demo | No criteria published | https://about.paypay.ne.jp/career/hackathon/6th/ |
| AWS Summit Japan AI Agent Hackathon | 2025 | KanpAI (Grand) | Agent for social and drinking gatherings; phone calls via Amazon Connect | Bedrock, Connect | Judge: "very high UI completeness for ~1 month" | team / live | Judges: "felt like a real product"; focused use case; feedback loop for continued use | https://aws.amazon.com/jp/blogs/news/aiagent_hackathon_report |

Not recoverable: Devpost had no winner data for QuickBooks Connect 2014/2015, PayHack 2025 or the Australian "Pinch Me" 2026 hackathon.

---

## 2. Patterns, with counts

The two datasets:
- **Payments set**: 97 winners from 13 payment or fintech hackathons. These are the Square hackathons (×6), Rapyd, PayPal ATL, PayPal Chicago, Finastra, Marqeta, Cornell Payments and MNEE.
- **AI set**: 148 winners from 14 AI hackathons held 2025–26.

Category labels are my own hand classification [inf].

**What kind of product wins (payments set, n=97)**

| Category | Count |
|---|---|
| Business / merchant tools | 64 |
| Consumer or social personal finance | 29 |
| Developer tools / infrastructure | 3 |
| Agentic payments | 1 |

The split depends on the event format:
- **Online, sponsor-run** (Square ×6): 48 of 49 winners were merchant tools.
- **In-person student events** (PayPal ATL/Chicago, Cornell): 16 of 19 winners were consumer or social apps.

PayPal 2026 is online and sponsor-run, so expect judges to lean toward "who pays whom and why", and toward products for people who earn money [inf].

**Top-two placements only (17 projects across these events, plus PayPal Dev Days)**

| Type | Count | Projects |
|---|---|---|
| Narrow single-action payment tools | 7 | Flash Order, tinytab, Payable Kiosk, Aisle, Get Together, Rapyd G-Force, watQ |
| AI insight / analyst | 3 | SquareSense, Square AI, Dingo |
| Automation | 1 | Cadence |
| Consumer finance | 4 | FundMyCollege, PayPal Teen, Glim, USustain |
| Agentic | 1 | CrawlerPal |
| Developer migration | 1 | Codebusters |

What this shows:
- **Narrow tools that finish a payment beat broad assistants by more than 2 to 1.**
- All 7 single-action winners are built around money actually changing hands in a sandbox, by their descriptions.
- None of the 3 AI-insight winners moved money [inf from descriptions].

**Do assistant or advisor apps win?** Yes, but only when they are framed around one question or one job:
- Denarii, Kiro 2nd: "Should I buy this?"
- Province, AWS 3rd: "file my taxes".
- SquareSense, 1st in 2023: an "AI analyst" for one store.

General "financial life" assistants won only side prizes (Finastra challenge prize, Finastra employee prize).

**AI dashboards: rewarded in 2023, not in 2025–26.**
- In 2023, SquareSense (AI chat plus generated charts) took 1st and Square AI took 2nd. AI analytics was novel then.
- In the 2025–26 AI set, no top-three overall winner is a dashboard. Top winners are agents that finish a job with a human approval step: Tally (grand prize), Plant Debugger (grand prize), Globot (grand prize, the Gemini 3 hackathon).
- How Did I? spells out the shift: "an operator, not another dashboard".

**Team size.**
- Payments set: median 2 members; 35% solo.
- AI set: median 1 member; **67% solo, 89% two or fewer.**
- A small team is not a handicap. Repeat winners are common: the Payable team won 1st in one Square hackathon and 2nd in the next, and the Flash Order developer won several Square prizes.

**Videos.**

| Set | Videos measured | Median | Middle half | Notes |
|---|---|---|---|---|
| Payments | 73 | 181 s | 147–226 s | 16 winners had no video (in-person events) |
| AI 2025–26 | 136 | 180.5 s | 168–236 s | 68 of 136 ran over 180 s |

Winners use almost all of the time allowed. The over-length ones still won, but our rules say judges stop watching at 3:00, so run 2:40–2:55. Outliers both ways: tinytab won a grand prize with a 40-second video, and Rapyd G-Force won overall with 454 seconds.

I could not check narration versus talking-head style, because YouTube blocked automated viewing. Devpost, MLH and judge guidance all push the same way:
- Screen-recorded live demo with a voiceover.
- No slide decks.
- Open with the problem.

**Write-ups of the 2026 grand-prize winners** share a style:
- They open with one named kind of person and one dollar amount.
- They cite dated sources.
- They show the approval step.
- They disclose seeded or test data.
- They make deterministic code own the numbers. Tally: "computed inside… Code Interpreter". Shoots: "Gemini reads and writes; code owns measurements". Pulse (OpenAI Build Week 2nd): "no LLM in the clinical loop". [inf: a deliberate trust signal]

---

## 3. What organisers and judges say they want

**PayPal (this contest)**
- Criteria wording (rules):
  - Design: "a complete, coherent product experience — not just a technical proof of concept".
  - Impact: "a credible, specific case for solving a real problem for a real audience — and does the solution actually address that problem based on what's demonstrated".
  - Presentation: "Does the video clearly demonstrate the project working end-to-end?" https://paypalaihackathon.devpost.com/rules
- "not just recommend, but actually transact" (agents inspiration). https://paypalaihackathon.devpost.com/resources
- "Make PayPal and AI impossible to miss… show them working." https://paypalaihackathon.devpost.com/updates/47305-two-weeks-to-go-get-your-project-checked-early
- PayPal Tech Blog (Sept 30, 2026): "meaningfully use both PayPal and AI"; no tracks. https://developer.paypal.com/community/blog/PayPal_AI_Hackathon

**Devpost judges** (https://info.devpost.com/blog/hackathon-judging-tips)
- Richard Moot (Square):
  - "A project that really stands out is one that was clearly considering the judging criteria."
  - Projects that lose "over-indexed on one particular criteria at the detriment of the rest."
  - "The demo video gives the most amount of scope."
- Karen Bajza-Terlouw (Databricks): "Ambiguity is a red flag." She also warned that a polished homepage can hide a project "a lot lighter on code".
- Warren Marusiak (Atlassian): "It's all about that finished product." He also said "It's not sufficient to just build the app and have it out there."
- Maria Yarotska (NEAR): she marks down projects that look like a solution searching for a problem.

**Devpost video guidance** (https://info.devpost.com/blog/6-tips-for-making-a-hackathon-demo-video)
- "Keep it short, interesting (no slide shows/decks), and visually engaging."
- "Don't try to pack in way too much information or speed up the audio to fit within a time limit."
- "Write a script!"

**MLH organiser guide**: the video "should be a demo of their hack, not a presentation." https://guide.mlh.com/general-information/judging-and-submissions/judging-plan.md

**Devpost on criteria**: if you can't explain how to use the product in a sentence or two, it may be too complicated. https://info.devpost.com/blog/understanding-hackathon-submission-and-judging-criteria

**Square's criteria (2022)**:
- "Quality of the Idea".
- Implementation and use of Square APIs.
- Quality of the submission package.
- Value to sellers and their customers.

Square also paid a "Most Valuable Feedback" prize to developers who gave platform feedback. https://developer.squareup.com/blog/announcing-the-winners-of-the-square-unboxed-hackathon/
**[inf]** Developer advocates value good API feedback. PayPal has no such prize, but a short "PayPal API notes" section in the README would be read by three of the PayPal judges.

**freee App Award criteria (JP)**: "Essential", "Innovative" and "EASY&FUN". Its special prize "favors the problem-solving approach over app polish". https://www.freee.co.jp/event/app-award-2020/

**AWS Japan judges (2025)** praised:
- a focused use case;
- "felt like a real product";
- "very high UI completeness".
https://aws.amazon.com/jp/blogs/news/aiagent_hackathon_report

**Eddie Jaoude (a judge here), old slide deck (2017)**:
- "Tell a story about your journey & paint a picture."
- "Always have a working example."
https://github.com/eddiejaoude/hackathon-tips

---

## 4. PayPal agentic commerce in 2026: what the PayPal judges will recognise

**PayPal Agent Toolkit**
- Works with OpenAI Agents SDK, LangChain, Vercel AI SDK and MCP.
- **Invoice tools:** `create_invoice`, `send_invoice`, `send_invoice_reminder`, `generate_invoice_qr_code`, `create_conditional_rules_for_invoice` (early-pay discount or auto-cancel date), `create_recurring_series`, `record_payment_for_invoice`.
- **Reporting tools:** `list_transactions`, `get_merchant_insights`.
- https://github.com/paypal/agent-toolkit

**PayPal MCP server**
- Remote: `https://mcp.sandbox.paypal.com` (sandbox) or `mcp.paypal.com`. A local version runs with `npx @paypal/mcp`.
- The example task in the docs is "list your PayPal invoices for the last month".
- https://developer.paypal.com/ai-tools/mcp-server.md

**PayPal AI Toolkit** (plugin for Claude Code, Codex and Cursor; repo updated Oct 16, 2026)
- This is what PayPal's DevRel team demoed at the hackathon kickoff.
- Its MCP covers orders, invoices, subscriptions, disputes, catalog, shipment and reporting.
- https://github.com/paypal/AI-Toolkit

**Transaction Search API**: includes `/v1/reporting/balances` and daily summary endpoints, which can feed runway figures. https://developer.paypal.com/docs/api/transaction-search/v1/

**Agentic Commerce Services** (launched Oct 28, 2025)
- **Agent Ready**: lets existing merchants take payments on AI surfaces.
- **Store Sync**: makes merchant catalogs discoverable to AI.
- https://newsroom.paypal-corp.com/2025-10-28-PayPal-Launches-Agentic-Commerce-Services-to-Power-AI-Driven-Shopping

**Agent Ready docs** (updated Oct 13, 2026)
- ChatGPT, via ACP through Braintree.
- Google AI Mode and Gemini, via UCP with Braintree, or with PayPal Orders v2.
- https://developer.paypal.com/agent-ready/overview

**WebMCP post** (Sept 16, 2026)
- Agents can search, build a cart and start checkout on Store Sync merchants. Optional, and limited to Store Sync customers today.
- Key line: "The buyer remains in charge of approving the transaction."
- https://developer.paypal.com/community/blog/WebMCP_PayPal_Agent_Ready/

**Dev Days 2025**
- CEO Alex Chriss: "the era of agentic commerce".
- PayPal called its remote MCP server the industry's first, and launched the Agent Toolkit alongside it; invoice management was named as an agent capability.
- https://newsroom.paypal-corp.com/2025-04-29-PayPal-Brings-Together-Developers,-AI-Leaders-to-Power-Agentic-Commerce-at-Dev-Days

**Other partnerships and deals**
- OpenAI ACP partnership (Oct 2025).
- Cymbio acquisition announced Jan 2026 **[2nd]**.
- Microsoft partnership Jan 2026 **[2nd]**.

**[inf] What this means for "Best Use of Agentic Commerce"**
- PayPal's 2026 language means agents *buying* (ACP, UCP, WebMCP, Store Sync) or agents *transacting on a user's behalf* with the human approving.
- A freelancer agent that drafts and sends an invoice is the seller side of that story. PayPal's own MCP examples are invoice-centred.
- Expect "Best Use of PayPal + AI" to fit us better than "Best Use of Agentic Commerce".

---

## 5. Anti-patterns: what loses or gets ignored

1. **Missing basic requirements.** Private video, broken link, no runnable build, no licence file in the repo's About section. A Devpost judge said "it was surprising to see how many submissions did not fulfill the basic requirements." https://info.devpost.com/blog/understanding-hackathon-submission-and-judging-criteria
2. **A non-functional demo.** "A design mockup, static prototype, or non-functional demo does not meet this requirement" (PayPal rules). Mock data shown as if live is a trust risk with engineering judges. The 2026 winners *disclose* seeded data instead, as How Did I? and Shoots do [inf].
3. **Sponsor tech that is decorative.** It fails Stage 1 ("PayPal integration is central") and loses the tie-break, which starts with Technological Implementation.
4. **A generic AI dashboard or chat panel in 2026.** It was rewarded in 2023 (SquareSense). In the 2025–26 top placements it was replaced by agents that complete a job with approval [inf from §2 counts].
5. **Too many features, no story.** "Don't try to pack in way too much information" (Devpost). Projects that are too complex to explain in a sentence or two overwhelm judges.
6. **Over-indexing on one criterion.** For example, a beautiful UI with thin code, or deep code with no audience (Richard Moot).
7. **A solution looking for a problem, or a vague audience** (Maria Yarotska). PayPal's Impact criterion explicitly asks for "a specific case… for a real audience".
8. **A slide-deck video, sped-up audio, or anything past 3:00.** Judges are "not required to watch past" 3:00.
9. **Rehashing the organiser's own example idea without a twist.** Here that is "freelancer payments dashboard" and "multi-currency invoicing tool" (both on PayPal's list) [inf].
10. **Secrets in the repo, or no judge access.** The organiser warned: "Hide your API keys."

---

## 6. What this means for our project (blunt)

1. **Keep the single question as the product.** "Can I spend today, or should I hold off?" Denarii placed 2nd at a ~10,000-entrant hackathon on "Should I buy this?". Make the verdict and the 30-day runway the hero screen; everything else supports it.
2. **The PayPal action is the climax, and it must really happen.**
   - The runway goes short.
   - The agent drafts a PayPal invoice: line items, client, currency, due date, optionally an early-pay discount via `create_conditional_rules_for_invoice`.
   - The user taps Approve.
   - `send_invoice` fires in the sandbox.
   - The sandbox client pays.
   - Runway updates on screen.

   Without that sequence, Presentation ("end-to-end") and Technological Implementation both drop.
3. **Make PayPal the input as well as the output.** Pull income and balance from PayPal (`list_transactions` / balances / `list_invoices`) so the runway depends on PayPal data, not only on email and receipts. This protects us at Stage 1, where "central" is judged, and moves the tie-break in our favour.
4. **Use the Agent Toolkit or the PayPal MCP server by name**, and say so in Built With, the description and the video. Three PayPal judges are developer advocates who just demoed these tools. Using raw REST alone wastes that recognition [inf].
5. **Cut from the demo** (keep only if they already work quietly):
   - generic charts, multi-tab dashboards, category breakdowns;
   - everything not on the path "bill arrives, verdict, shortfall, invoice, paid".

   The wealth moves (self-back, furusato, iDeCo, NISA) are Japan-only. Global PayPal judges will not credit them toward Impact. They also blur the "one real problem" story. That conflicts with the product priority in memory. For the hackathon, my recommendation is at most one "what's next" line, but it is the owner's call.
6. **Name one real person with real numbers in the first 15 seconds.** Copy Tally's write-up. For example: a Tokyo-based designer billing two US clients in USD through PayPal, with rent due on the 27th, a ¥X card charge landing first, and a client 18 days late. Cite dated sources for the cross-border freelancer problem (late payments, FX, irregular income) in the description. Impact is scored on "credible, specific".
7. **State the new part plainly to beat the "PayPal already listed this" risk.** Neither of PayPal's freelancer examples does this: our assistant reads obligations from email or photo, forecasts a shortfall, and *uses that shortfall to trigger* an approved PayPal invoice. Lead the description with that sentence.
8. **Make trust visible; that is the 2026 winning style.**
   - The model only reads and drafts. Deterministic code computes the runway and invoice amounts.
   - Nothing is sent without one tap of approval. That matches PayPal's own line, "The buyer remains in charge."
   - Show the receipt or email beside what was extracted, with a confidence level.
   - Label seeded sample data as such.
9. **Give judges a hosted, logged-in demo.**
   - A seeded sandbox business account plus a sandbox client account.
   - Credentials in the testing instructions.
   - A "reset demo" button.
   - A real photo of a receipt parsed live in the video.

   Submit by **Nov 5** for the early eligibility check.
10. **Video: 2:40–2:55, screen recording with voiceover, scripted, captioned, no slides beyond one title card.**

    | Time | Content |
    |---|---|
    | 0:00–0:15 | The person, the date, the number at risk |
    | 0:15–0:45 | Forward a bill email and snap a receipt; show the extraction |
    | 0:45–1:15 | Verdict: "Hold off: 11 days of runway, short ¥X on the 27th" |
    | 1:15–2:05 | Agent drafts the PayPal invoice; Approve; real sandbox invoice page; client pays; runway turns green |
    | 2:05–2:35 | Architecture in one frame: PayPal Agent Toolkit/MCP tools named, model named, deterministic runway engine |
    | 2:35–2:50 | One-line close: who it's for, what it did |

    Record at real speed. Show the PayPal sandbox UI itself at least once. Polish the design (both themes, empty states, phone width) because Design scores "complete, coherent product". Optional: if a transactions table is already needed, building it with AG Grid enters a separate $11k sponsor pool, and that prize stacks with a main prize [inf; low priority].

---

## 7. What I could not verify

- **The 2026 PayPal hackathon gallery and judge scoring notes.** The gallery is not public yet, and Devpost publishes no per-project judge comments. Discussion answers are hidden behind login.
- **Why most sponsor winners won.** Square, PayPal Dev Days and Devpost galleries give descriptions, not reasons.
- **Video style.** Narration, screen recording versus talking head, captions: YouTube blocked automated viewing. Only durations were measured.
- **Several sponsors' hackathon winners.** Stripe, Plaid, Visa, Mastercard, Wise, Nubank, Monzo, Brex/Ramp and Intuit/QuickBooks either run internal or in-person events without public galleries, or I found none. Visa Intelligent Commerce and Mastercard Agent Pay hackathon winners: none found.
- **Japanese hackathons.** I found no public results for PayPay (external), Money Forward, Mercari, Rakuten, MUFG or JPX in 2025–26. Japanese coverage is limited to freee 2020, SMBC 2016, PayPay's internal event and AWS Japan 2025.
- **The Coinbase Agents in Action page** (returned 403) and the Arc winners: names come from search summaries only **[2nd]**.
- **PayPal 2026 items**: Cymbio acquisition, Microsoft partnership, NVIDIA GTC talk, and whether the ChatGPT checkout via PayPal is fully live are **[2nd]**.
- **Category labels and the "dashboards declined" claim** are my own classification of taglines and descriptions, not organiser statements.
- **Submission count.** Only registrants are public (26,140); the submission count is not.
