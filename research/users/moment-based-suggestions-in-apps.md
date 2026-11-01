# Moment-based suggestions in money apps: what works, what people hate, what the evidence says

Researched 31 Oct 2026. Sources are official pages, regulators and peer-reviewed papers first; review blogs and Reddit mirrors only where nothing better was found, and they are marked. "Not found" means I looked and did not find a citable source.

## Summary (12 lines)

1. The strongest evidence is for **reminders tied to a dated, specific obligation**. An SMS 3 days before a loan instalment worked about as well as a 25% interest cut (Cadena & Schoar 2011). Auto-enrolled overdraft alerts cut charges 21–25% (FCA 2018).
2. **Alerts must arrive while the user can still act.** The FCA found just-in-time overdraft alerts beat early "low balance" warnings, which had weak or mixed effects.
3. **Specific beats generic, short beats long, one message beats a series.** Messages naming the goal and incentive worked best and extra late reminders added nothing (Karlan et al. 2016). Short, loss-framed AI overdraft emails cut overdrafts 9% the next week (Mint/Intuit RCT, 2025).
4. **Nudges move the targeted metric and can push the problem elsewhere.** Payment reminders cut card late fees 14% but raised overdraft fees 9% (Medina 2021). Credit-card repayment nudges had precise null effects on long-run debt (FCA/Adams et al.).
5. Generic financial education explains about 0.1% of behaviour and fades within about 20 months. The authors argue for **just-in-time education tied to one behaviour** (Fernandes et al. 2014).
6. Finance apps get some of the best push opt-in rates of any category. Tolerance is still low: about 43% of users say 2–5 pushes a week would make them disable notifications (vendor survey, 2025).
7. The apps users like attach the suggestion to the event itself. Examples: Monzo's Salary Sorter when pay lands, SMBC/Olive and Money Forward ME warnings before a card debit, Copilot's "Approve / Dismiss" budget fixes.
8. **AI assistants are trusted when they are read-only or approval-gated.** Copilot says it "never acts without your approval" and Cleo advertises a Read-Only Mode. Users revolted when Monarch put AI "sparkle" buttons everywhere; Monarch added an opt-out and admitted the assistant was "often inaccurate".
9. AI accuracy incidents are real and recent. In a Washington Post test (Mar 2024), the TurboTax and H&R Block tax bots were unhelpful or wrong up to half the time. Klarna reversed its all-AI support push in May 2025 after quality fell.
10. Monetised "better card" suggestions are the trust fault line. Credit Karma paid $3M over false "pre-approved" claims, and Cleo paid $17M over misleading cash-advance and cancellation practices. The CFPB called payment-driven steering potentially "abusive" (Circular 2024-01), then withdrew 67 guidance documents in May 2025. I could not confirm whether that circular was one of them.
11. In Japan, since 1 Oct 2023, an affiliate recommendation that does not say it is an ad is illegal stealth marketing under the 景品表示法. Labels such as 「広告」 or 「PR」 are the accepted fix.
12. Rules for us: one dated suggestion per real event, with the user's own number, a "why", one action behind an approval step, and "not now / never for this". Any paid placement must be labelled in both markets.

---

## 1. App teardown table

Legend: **Action** = whether there is a one-tap action at the moment. **Money** = how the suggestion is monetised.

| App | Moment that triggers it | What the suggestion looks like | Action | Money | User reaction | Sources |
|---|---|---|---|---|---|---|
| **Copilot Money** (US, iOS/web) | Balance crosses a threshold (e.g. under $500), big expense, miscategorised charge, unmatched refund, spending trend against budget | Alert, or an assistant card: "move $50 from Shopping to Dining out", suggested new total budget. Assistant "personalities" include Zen, Bestie, CFO and "Roast me" | **Yes: Approve / Fix or Dismiss.** Site says the assistant "always asks before acting" and "never acts without your approval" | Subscription only ($9/mo or $109/yr as of Oct 2026); no affiliate offers on the homepage | Reviews praise the design and the recurring-charge review flow. They criticise the lack of bill negotiation and cancellation tools (review blogs only) | copilot.money (fetched 31 Oct 2026); review sites e.g. thepennyhoarder.com Copilot review 2026 |
| **Monarch** (US) | Recurring charge detected; weekly; "contextual insights" on key screens | AI Assistant chat, AI Insights, **Weekly Recap** ("what changed, how spending is trending, what deserves attention") on the dashboard and by email | Mostly informational | Subscription; free advisor/partner seats; no affiliate offers found | **Backlash at the Dec 2025 launch.** Users said the AI was forced on them and wanted to remove the sparkle buttons. Monarch added an opt-out that removes the assistant, the sparkles and the Weekly Recap. It removed an "Opt out of AI training" toggle it admitted "did nothing", and acknowledged the assistant is "often inaccurate in obvious ways". | help.monarch.com AI features article (403 to fetch; seen in search); releasebot.io/updates/monarch; r/MonarchMoney "Changes to our AI Assistant (Update #2)" via reddit.sentinel-team.org mirror. Posting date unclear: the mirror's arithmetic implies about Feb 2025, other sources place it in Dec 2025. |
| **Rocket Money** (US) | Recurring bill or subscription detected | "We can negotiate this bill" / cancel subscription | Yes: hand the bill to the concierge | **Success fee: a percentage of annualised savings, charged upfront and non-refundable.** Review sites report 30–60%, chosen by the user. | Complaints about surprise or unauthorised negotiation fees, savings that expire and need renegotiating (charged again), and BBB refund requests | help.rocketmoney.com/en/articles/9744474-bill-negotiation-charge; BBB profile; robberger.com review |
| **Cleo** (US/UK) | Overspend → "roast"; hitting a target or a savings streak → "hype"; proactive alerts such as "$500 at a shoe store this month" | Chat message in a comic voice. Roast example (from a review): "Another DoorDash order? Your kitchen must be decoration at this point." | Autosave; cash advance; **Read-Only Mode** ("she can't touch your cash") | Subscription plus cash advances. **FTC: $17M settlement (27 Mar 2025)** for misleading advance amounts and speed, and for making cancellation hard while an advance was outstanding | Roast is popular with younger users; ratings are high (4.7 US App Store per 36Kr). The FTC case shows the gap between the advertised and the real offer. | ftc.gov (press release, 27 Mar 2025); hunton.com; pymnts.com; 36kr; Cleo blog |
| **Monzo** (UK) | **Pay arrives** → Salary Sorter; any card payment → instant notification; after a shared bill → Split | Salary Sorter splits incoming pay into Pots and remembers the sender next time. "Split this Bill" / Shared Tab on any transaction; Monzo.me link for non-users. Round-ups pot; Trends tab with budgets | **Yes: tap the transaction → Split; tap the incoming payment → Salary Sorter** | Plus/Premium tiers unlock non-Monzo accounts in Trends | Generally praised (Monzo's own blog; no independent review sample) | monzo.com/blog (2019–2021 feature posts); monzo.com/help Trends |
| **Revolut** | Every card payment; analytics | Real-time spending notifications; analytics; Vaults | — | Plans and subscriptions | Reviewers praise real-time alerts; one G2 review mentions duplicate notifications. **Marketing notifications have a separate toggle; account alerts are advised to stay on.** Bigger complaints are about held transfers and support. | help.revolut.com/en-JP/…/how-do-i-manage-my-notifications; g2.com Revolut reviews; Kimola app-store analysis |
| **Chime** (US) | Card purchase that would overdraw → SpotMe covers it | SpotMe up to $200 (limit grows with direct-deposit history); friends can send $5 "Boosts" (4 per month) | Automatic cover | **Optional tip after repayment.** Chime says tips don't affect eligibility (secondary source) | Users trade boosts on Reddit and Discord; Chime does not endorse this | chime.com/blog/how-do-i-get-a-higher-spotme-limit (Jun 2026); help.chime.com "What are SpotMe Boosts?" |
| **Acorns** (US) | Every purchase (Round-Ups) | Spare change invested; Multiplier 2x/3x/10x; invested once $5 accrues | Set-and-forget | Subscription | Fixed fees criticised for small balances (Business Insider) | acorns.com/round-ups; help.acorns.com |
| **YNAB** | User-driven: method, not alerts | Four rules: give every dollar a job; **embrace your true expenses** (turn big irregular bills into monthly amounts); roll with the punches; age your money | Manual | Subscription | Loved as a method; work-heavy | ynab.com/blog/spending-money-is-not-bad; Wikipedia "YNAB" |
| **Credit Karma** (US) | Credit report change; "a card or loan that could save you money" | Offers / recommendations; Intuit Assist (genAI, launched in beta Sept 2023, later rolled out to US members) to "surface timely recommendations… better financial products" | Yes: apply | **Affiliate: "we typically receive compensation from the lender or bank"; compensation is "one of several factors that may impact how and where offers appear" (except mortgages).** | **FTC $3M (proposed Sept 2022, final Jan 2023):** "pre-approved" labels shown when about a third of applicants were denied; dark patterns refined by A/B testing | creditkarma.com/advice/i/is-credit-karma-a-scam (updated 21 Sep 2026); ftc.gov business blog Sept 2022; creditkarma.com/about/releases/introducing-intuit-assist-for-credit-karma |
| **NerdWallet app** | — | — | — | Affiliate (well known) | **Not found:** the official "how we make money" page returned 404 and I did not retrieve another primary source | — |
| **Mint** (closed) | Bills, budgets, overdraft risk | Budgets by category; AI overdraft email reminders were tested on Mint users (see section 2) | — | Ads/affiliate | **Shut 23–24 Mar 2024; users were pushed to Credit Karma**, which had no category budgets. The move was one-way and lost Mint access. Users missed category budgeting. | cnbc.com 7 Nov 2023; engadget; bloomberg.com 10 Apr 2024; doctorofcredit.com |
| **マネーフォワード ME** (JP) | **Card debit amount confirmed + linked bank balance short** → push; points about to expire → push | 「カード引き落とし時の残高不足」 alert; 「ポイントの有効期限」 alert | Informational | **Both alerts are Premium-only** (paid tier) | — (no review sample retrieved) | support.me.moneyforward.com/hc/ja/articles/4406502127897; media.moneyforward.com/articles/6195 |
| **Zaim** (JP) | Bank balance screen shows each card's next debit date and amount (rolled out from late Jul 2024); 「わたしの給付金」 finds benefits you may qualify for (2015; Premium for detail) | Display, not push | — | Premium; campaign: free annual plan (¥4,800) for switchers from 1 Aug 2025 | — | resemom.jp 2024-07-29 and 2025-07-25 PR; internet.watch.impress.co.jp 684061 |
| **Moneytree** (JP) | Balance trends, large transactions | Push and email | — | — | MUFG Card ended Moneytree linking in Oct 2024. **Detailed alert features: not found.** | appllio.com/app-moneytree; cr.mufg.jp 20240529_01 |
| **三井住友 Olive / SMBC app** (JP) | **Card or other debit coming up; balance short; withdrawals over a set amount; monthly card spend over a set amount** | 「口座引落・残高不足通知」: "debits announced in advance; know instantly if short" | Toggle-based setup; **one-tap top-up not found** | Bank; campaigns are a separate notification category | — | smbc.co.jp/kojin/olive-account/guide/safety/ (info as of Dec 2025); smbc.co.jp/kojin/direct/products/2025_08/ |
| **PayPay** (JP) | Payments; campaigns | Push; v5.24.0+ allows per-category settings, and users can allow "important notices only" | — | Points and merchant fees | Complaints centre on point-rule changes and support, not notification volume (low-quality sources) | paypay.ne.jp/help/c0172/; minhyo.jp |
| **楽天 points ecosystem** | — | — | — | — | **Not researched in depth / not found** within the search budget | — |
| **Japanese app that suggests something at bill time** | MF ME and SMBC/Olive warn before a card debit when the balance is short. **No Japanese app found that pairs the bill with a suggested action** (e.g. "move ¥X from savings"). | | | | | as above |

**Pattern:** every app that users praise anchors the message to a **specific transaction or dated obligation**. The ones that draw complaints either put AI everywhere (Monarch), monetise the moment opaquely (Credit Karma, Rocket Money fees), or advertise one offer and deliver another (Cleo).

---

## 2. Notification and reminder evidence (with effect sizes)

| Study | Setting | Intervention | Measured effect | Takeaway for us |
|---|---|---|---|---|
| **Karlan, McConnell, Mullainathan, Zinman**, "Getting to the Top of Mind", *Management Science* 62(12), 2016 (NBER w16205) | Bolivia, Peru, Philippines; new commitment-savings clients | SMS/letter reminders | Raised commitment attainment. **Messages naming the goal plus the financial incentive were most effective.** Gain vs loss framing made no difference, and **extra late reminders had no additive effect**. Headline magnitudes are **not verified**: I could not retrieve the paper's numbers. A separate Peru IPA arm raised account use but not savings levels. | Name the user's goal and the money at stake; send once, not a drip |
| **Cadena & Schoar**, NBER w17020, 2011 | Uganda microfinance, ~1,121 borrowers | Monthly SMS **3 days before due date** vs cash-back worth a 25% interest cut | **SMS had about the same effect on on-time repayment as a 25% cut in interest cost**; strongest for younger borrowers | A dated, pre-deadline nudge is cheap and powerful |
| **FCA Occasional Paper 10**, "Message received?", Hunt, Kelly, Garavito, 11 Mar 2015 | UK, two large banks | Text alerts, mobile app, annual summaries | **Alerts or app: −5% to −8% unarranged overdraft charges; both together: −24%.** Annual summaries: no effect | Real-time beats an annual or periodic summary |
| **FCA OP 36**, "Sending out an SMS", Caflisch, Grubb, Kelly, Nieboer, Osborne, 31 May 2018 | 1.5M consumers, 6 banks | **Auto-enrolment** into alerts | **Unarranged overdraft alerts −25% charges; unpaid-item alerts −21% to −24%.** Only 3–8% had opted in before. Rare chargers avoided up to half their charges; heavy users still paid most of theirs | Default-on for safety alerts; don't expect heavy strugglers to be fixed by alerts |
| **FCA OP 40**, "Time to act", Adams, Grubb, Kelly, Nieboer, Osborne, 24 Jul 2018 | >1M customers, Nov 2017–Apr 2018 | Just-in-time vs early-warning alerts | **Just-in-time arranged-overdraft alert saved £0.28–£0.45/month**; early low-balance alerts were weak or mixed; unpaid-item early warnings had no effect. Survey: alerts were **not seen as distracting or annoying, even by people who opted out** | Time the alert to when the user can still act |
| **FCA OP 45 / Adams, Guttman-Kenney, Hayes, Hunt, Laibson, Stewart**, 26 Jul 2018; *Economica* 2022; NBER w31926 (2023) | 183,441 UK cardholders | Nudges to pay more than the minimum; hiding the "autopay minimum" option | Autopay amounts rose sharply, but **total repayments were unchanged** because people cut manual payments (offsetting). **Precise null effects on long-run debt**; a small rise in arrears. 96% underestimated how long minimum payments take to clear a debt | Measure total outcome, not the clicked metric |
| **Medina**, "Side Effects of Nudging", *Review of Financial Studies* 34(5), 2021 | Brazil, ~26,000 users of a finance app, 2015 | Push reminders for card due date | **Card late fees −14%, checking overdraft fees +9%**; users with an overdraft history saw **+5% net fees**, others saved 15% (figures from a secondary summary) | Before suggesting "pay X", check the cash account it comes from |
| **Sade, Ben-David, Mintz (Intuit)**, "Using AI and Behavioral Finance to Cope with Limited Attention and Reduce Overdraft Fees", *Management Science*, 14 May 2025 | 39,000+ Mint users, US/Canada | AI predicts overdraft risk → email reminder | Any reminder helped; **short beat complex; loss-framed ("Avoid overdraft fees") → −9% overdrafts the next week, ~$25 saved over 4 months**; gain framing slightly weaker. **Financially fragile users benefited less** | Predictive, short, concrete; pair with a real option for fragile users |
| **Fernandes, Lynch, Netemeyer**, *Management Science* 60(8), 2014 | Meta-analysis, 201 studies, 585,168 people | Financial education | Explains **~0.1% of variance** in behaviour; **negligible after ~20 months**; authors recommend **just-in-time education tied to a specific behaviour** | Teach one thing at the moment it matters; no courses |
| **CFPB / FCA on card repayment and overdraft prompts** | — | — | The FCA trials above are the main measured ones. **I found no CFPB randomised trial with effect sizes** on card repayment or overdraft prompts | — |

### Notification tolerance (weaker, vendor data)

- **Finance gets the highest push opt-in of any category**, especially on Android (Pushwoosh 2025 fintech benchmark). An Airship figure of 96% Android finance opt-in is only seen second-hand and is **unverified**. Fintech push click-through: Android 2.84%, iOS 2.09% (Pushwoosh, Q4 2024–Q2 2025).
- **Stated tolerance:** 43% say 2–5 pushes a week would make them disable notifications, and 30% would stop using the app at 6–10 a week (Helplama survey, updated Apr 2025). GrabOn's republication has 12% turning off after just 1 per week. Older figures: 46% would disable at 2–5 a week (Localytics, c. 2014), and 78–80% would delete the app or disable notifications "if unhappy" (DMA UK).
- These figures are stated intent, not observed behaviour. **No observed opt-out rate for money-app nudges was found.** The best behavioural signal is the FCA finding that auto-enrolled people did not find alerts annoying.
- **Working budget:** about 1 proactive push per real event, and a soft ceiling of **~2 non-urgent pushes per week**. Everything else goes to an in-app feed or a weekly digest.

---

## 3. AI money assistants, 2024–2026

**What they do when asked for advice**

- **Copilot Money**: a "money assistant" that flags mistakes, runs background instructions (e.g. tag trip expenses), discusses scenarios ("should I add to an IRA?") and proposes budget changes, always behind **Approve / Dismiss**. It has selectable personalities, including "Roast me". (copilot.money, fetched Oct 2026)
- **Monarch**: AI Assistant, AI Insights and Weekly Recap (revamped Dec 2025). These use third-party LLMs; data is sent only when the user starts a request. After backlash, users can switch the whole AI layer off, and Monarch admitted inaccuracy. (Monarch help centre; r/MonarchMoney Update #2)
- **Cleo**: chat-first, roast/hype tone that switches with behaviour; Read-Only Mode. Its revenue depends on subscriptions and cash advances, which drew FTC action. (FTC 27 Mar 2025)
- **Intuit Assist (Credit Karma, TurboTax)**: genAI over the member's data "to surface timely recommendations and help people take advantage of better financial products", which is the affiliate business in conversational form. (Credit Karma press release, Sept 2023)
- **Klarna**: claimed in Feb 2024 that its OpenAI assistant handled 2.3M chats in its first month (the work of 700 agents) with equal satisfaction. In **May 2025 the CEO said the cost focus had lowered quality** and Klarna began hiring humans again (Bloomberg via Entrepreneur and Finextra, May 2025).
- **Bank chatbots**: the CFPB's *Chatbots in Consumer Finance* spotlight (6 Jun 2023) warned of inaccurate answers, failure to recognise disputes, and "doom loops" with no route to a human.

**Incidents**

- **Washington Post test, Mar 2024**: the TurboTax (Intuit Assist) and H&R Block AI Tax Assist bots were "unhelpful or wrong" on up to half of 16 tax questions. H&R Block invented a claim that the IRS had not addressed a crypto question. (accountingtoday.com; nysscpa.org 7 Mar 2024)
- **Monarch**: the company acknowledged the assistant was "often inaccurate in obvious ways" and that its AI-training opt-out toggle did nothing.
- **Hallucinated numbers in Copilot or Cleo**: no specific documented incident found.

**Regulators**

- **SEC**: withdrew the 2023 "predictive data analytics" conflicts rule on 12 Jun 2025 (with 13 other proposals). Existing conflict-of-interest and fiduciary law still applies. (Ropes & Gray; Paul Hastings)
- **FINRA**: the 2026 Annual Regulatory Oversight Report (9 Dec 2025) has a GenAI section that flags hallucination and bias. It expects human-in-the-loop review and treats a wrong AI explanation of a product, fee or risk as a potential Reg BI issue. For **AI agents** it expects narrow scope, defined permissions, audit trails and **human checkpoints before execution**. (finra.org; Debevoise; Mayer Brown)
- **FCA**: AI Live Testing. The second cohort (Barclays, Lloyds, UBS, Experian and others) has run trials since Apr 2026, including **AI-enabled "targeted support"**, the new lighter-touch category between guidance and advice. An evaluation is due Q1 2027. (professionaladviser.com; ffnews.com)
- **金融庁 (FSA Japan)**: *AI Discussion Paper* v1.0 (4 Mar 2025), revised to **v1.1 on 3 Mar 2026** with a focus on customer-facing genAI, legal-interpretation Q&A and AI agents. It stresses monitoring and verification because of hallucination risk; an AI 官民フォーラム has met since Jun 2025. (fsa.go.jp/news/r6/sonota/20250304/aidp_summary.pdf; dir.co.jp 2026-04-15)
- **CFPB**: the 2023 chatbot spotlight; Circular 2024-01 on steering (see section 4); a mass withdrawal of guidance on 12 May 2025.

**Implication**: keep the assistant explanatory and approval-gated. Never let it state a tax amount or a deadline it did not compute from data or rules we can show. Keep a human or an "ask a professional" exit.

---

## 4. Trust, monetisation and disclosure

- **How "better card" apps earn**: lender or bank bounties per approved application. Credit Karma's disclosure says compensation is "one of several factors that may impact how and where offers appear". NerdWallet uses the same model (its official page was not retrieved).
- **Backlash and enforcement**
  - **Credit Karma, FTC ($3M; order final Jan 2023)**: "pre-approved" shown to people of whom about a third were denied. Dark patterns refined through A/B tests; the order requires keeping A/B testing records.
  - **Cleo, FTC ($17M, 27 Mar 2025)**: advertised advance amounts and speed that users didn't get; blocked cancellation while an advance was outstanding.
  - **Rocket Money**: complaints about surprise negotiation fees and non-refundable success fees (BBB; help centre).
  - **Mint → Credit Karma (2024)**: users read the shutdown as moving them from a budgeting tool to a loan marketplace. Coverage framed it as Intuit pushing users toward the monetised product.
- **CFPB Circular 2024-01 (29 Feb 2024)**: operators of digital comparison-shopping tools and lead generators may engage in **abusive** practices if they steer consumers to products based on payments to the operator, including through ranking algorithms. Recommendation-style tools are in scope. The CFPB withdrew 67 guidance documents on 12 May 2025 (90 FR 20084). **Whether 2024-01 was among them is not confirmed.** Either way, the legal theory (UDAAP abusiveness) still stands in the statute. **CFPB "digital dark patterns" work (2024–2025): no specific document found** in this pass.
- **Japan, 景品表示法 stealth-marketing rule**: 内閣府告示第19号 (28 Mar 2023), **in force 1 Oct 2023**. A representation is stealth marketing if (1) it is the business's own representation and (2) consumers cannot tell it is. **Affiliate content counts as the advertiser's representation.** Consumer Affairs Agency guidance gives 「広告」, 「PR」 or "posted with product provided by A社" as acceptable labels, and suggests making the PR label a condition of affiliate payment. Remedy: 措置命令. (data-max.co.jp; ohebashi.com newsletter Jul 2023; prtimes 2023-09-29)
- **Disclosures users accept** (inferred from the cases): (a) a visible "Ad / PR / we may be paid" label **on the card itself**, not in a footer; (b) "pre-approved" or approval odds only when true; (c) a non-sponsored option shown alongside; (d) no sponsored item inside a safety alert. **No survey that measures which disclosure wording users accept was found.**

---

## 5. Rules for our suggestion moments

1. **One event, one suggestion.** Trigger only on a real event (client payment received, statement or bill posted, debit coming with a short balance, tax or 予定納税 deadline within N days, purchase about to happen). No pushes without a trigger.
2. **Put the user's own number first.** For example: "Client paid $4,200 → about ¥612,000 at today's rate; set aside ¥92,000 for tax." Concrete amounts beat generic tips (Karlan; Mint RCT).
3. **Show the deadline and time the alert so the user can still act.** Send it before the debit, not after (FCA OP 40; Cadena & Schoar's 3 days before). Name the date.
4. **Add "Why this?" in one line.** State the rule or data behind it, e.g. "Because your last 3 USD payments went to living costs and your 2026 tax estimate is ¥X." The explanation is required for any AI-generated suggestion.
5. **Offer a single primary action plus an approval step.** Do nothing irreversible without a tap to confirm, like Copilot's Approve / Dismiss and FINRA's human checkpoint for agents. Money movement is always preview → confirm.
6. **Put the controls on the card:** "Not now" (snooze 1 day / until payday), "Never for this payer or bill", and "Fewer like this". Respect them across devices.
7. **Default safety alerts on, everything else to the digest.** Short-balance-before-debit and tax-deadline alerts are default-on (FCA auto-enrolment: −21% to −25% charges). Insights and tips go to a **weekly digest** in the app or by email. Keep a soft ceiling of about 2 non-urgent pushes a week.
8. **Check where the money comes from.** Before suggesting "pay the card" or "move to savings", check the account it comes from so we don't swap a late fee for an overdraft (Medina 2021).
9. **Keep messages short and concrete, framed as the loss avoided.** Use "Avoid a ¥X late fee", not a paragraph (Mint RCT: −9%).
10. **Teach one fact, at the moment it matters.** One line of just-in-time education per suggestion (e.g. what 予定納税 is when the first notice arrives), never a course (Fernandes et al.).
11. **Label every paid suggestion and keep it out of safety alerts.** A paid card or product appears with 「広告」/「PR」 in Japan and "Sponsored / we may be paid" in the US. Never put one inside a safety alert. Rank by user benefit and show the unpaid option too. Never say "pre-approved" unless it is true.
12. **Never let the AI invent a number or a rule.** Tax amounts, deadlines and FX figures come from deterministic code with the source shown. The LLM explains them only. Give an exit to a human or tax professional, and make the whole AI layer switchable off (Monarch lesson).
13. **Measure the total outcome**: net fees, tax set aside and missed deadlines, not just taps. Nudges can show a "semblance of success" (FCA OP 45).
14. **Choose the tone with care.** Roast or hype is opt-in only. Use a neutral default for money-stress moments (tax, short balance).

---

## Not found / not verified

- Karlan et al. (2016) headline magnitudes: direction and design confirmed, numbers not retrieved.
- Whether CFPB Circular 2024-01 is on the 12 May 2025 withdrawal list.
- Any CFPB 2024–2025 "digital dark patterns" publication specific to money apps, and any CFPB randomised trial with effect sizes on card repayment or overdraft prompts.
- NerdWallet's own monetisation and disclosure page (404), and NerdWallet app suggestion moments.
- Documented hallucinated-number incidents for Copilot, Cleo or Monarch beyond Monarch's own admission.
- Observed (not stated) notification opt-out rates for finance apps; the primary Airship and Pushwoosh numbers.
- Moneytree's alert details; Zaim push notifications in 2025–26; 楽天 point-ecosystem suggestion moments; PayPay notification complaints with reliable sourcing.
- Any Japanese app that pairs a bill with an action (e.g. move funds); none found.
- Freee and Money Forward クラウド確定申告 deadline reminder features: not found in this pass.
- A survey of which disclosure wording users accept.
- The posting date of Monarch's "Update #2": a Reddit mirror implies about Feb 2025, while other sources place the AI launch and opt-out in Dec 2025.
