# What freelancers paid across borders want, and what makes a money app loved or abandoned

Researched 2026-11-01. Web research only. This builds on `questions-people-ask.md`, `what-people-want-from-advice.md`, `moment-based-suggestions-in-apps.md` and `../ux/daily-money-apps.md`, and does not repeat them. Not repeated here: Fed SHED income volatility, Mynavi's ¥0-month figure, IEC tax set-aside figures, 住民税/予定納税 mechanics, Gallup/CFP Board AI trust, the Credit Karma/Cleo enforcement cases, Simple's formula, and the tab-structure findings.

Tags: **[measured]** survey or dataset; **[community]** forum post or comment (anecdote); **[vendor]** company's own claim or marketing; **[inference]** my reading, not a source.

Reddit, X and note.com block direct fetching. Reddit posts were read through the reddit.sentinel-team.org snapshot mirror and Hacker News through its official API. Quotes are short excerpts. Snapshot dates are given.

---

## Summary (12 lines)

1. Freelancers rarely talk about budgets. They talk about **waiting**: for a client to pay, for PayPal to release funds, for the card debit date. The feeling they name is watching the balance shrink while money is "owed" (「口座の残高がどんどん減っていくのを見るのが一番辛かった」).
2. Waiting on the card debit is stressful enough that Japanese users **pre-pay their card before the debit date just to make the feeling stop** (two Yahoo!知恵袋 questions, Mar and Jun 2026).
3. When freelancers are short, the action they struggle with is **chasing an invoice already sent** ("I don't know when I should send another reminder"), not creating a new one. They fear damaging the client relationship.
4. Simple's Safe-to-Spend was mourned because it changed "how rich or poor you feel day to day" (HN, 2012), not because of a feature list. It failed for people who spent on credit cards, because the number could not see card spending.
5. Every loved product got one feeling right: **Simple** "can I spend?", **Monzo** "I know the moment it happens", **YNAB** "less stressed" (a company claim), **Wise** "I see the fee before I send", **Found** "I don't have to think about taxes", **Money Forward** "it's all collected automatically", **Square** the "cha-ching" when an invoice is paid.
6. People leave for one of six reasons: typing things in, broken bank syncs, guilt-trip notifications, price or paywall changes handled badly, a pivot toward selling to them (Mint→Credit Karma), and a system that does not fit how they live (categories, monthly budgets).
7. Finance apps keep about **5–9% of installs at day 30** (AppsFlyer Q4 2025). A daily habit has to come from real money events, not content.
8. AI: people accept reading, reminding and drafting. They reject AI moving money: 23% trust gen-AI with payments (Visa/Harris, May 2026), 33% want to approve every transaction (Global Payments, Sep 2026), and in Japan only 5.3% (n=300) would let AI handle 家計の計算・お金の管理.
9. A second, newer finding: **47% say constantly checking an AI agent's work worries them more than its mistakes** (Ping Identity 2026, n=11,000). Too many approval prompts is a failure mode in itself.
10. Freelancer tools all sell the same feeling: "peace of mind", "take the guesswork out", "takes that worry off you", 「あんしん」. None of them speaks to the person's own life (rent, card bill, a trip). Lili and Bonsai have drifted to "business" language.
11. For the product, the feeling to deliver is **"I know where I stand before it happens."** The first screen says whether you're OK, until when, and which client could change that.
12. Cut categories, charts, net worth, chat-first input and anything the user has to type. Keep one number that includes unbilled card spend, the late client by name, and one approval at a time.

---

## 1. The problems, in users' own words

### 1.1 Waiting for money that is owed (late clients, net terms)

| Quote | Who / where | Source |
|---|---|---|
| "Client 'can't pay me right now due to internal processing issues'" (title). Same post: "Is this a fancy way of telling me they can't afford to pay me right now?" | r/freelance (snapshot 2026-02-23) | https://reddit.sentinel-team.org/posts/1oul58j/snapshots/2026-02-23T12%3A25%3A37.491863Z [community] |
| Top reply: "It's usually cashflow, with small businesses" | same thread | same |
| "They all note in their term a +30 days payment, which is a pain" / "I'd like to work for money already paid." Reply: "Chasing bills is 30% of the job!" | r/freelance | https://reddit.sentinel-team.org/posts/1nb5oj4/snapshots/2026-02-23T12%3A25%3A37.491863Z [community] |
| "Using you, and others, as a bank. Not OK." (149 pts, on a Net30 client paying 3 weeks late) | r/livesound | https://reddit.sentinel-team.org/posts/1qrtnlb/snapshots/2026-02-04T07%3A00%3A05.88879Z [community] |
| "I don't know when I should send another reminder." / "I don't want to damage the client relationship." / "Late payments destroy cash flow." | 50 freelancer interviews (DEV post, Jul, year not shown). The author's finding: the pain comes **after** the invoice is sent, not in creating it | https://dev.to/priya__008/i-interviewed-50-freelancers-about-late-payments-almost-everyone-was-solving-the-wrong-problem-22o4 [community] |
| 「口座の残高がどんどん減っていくのを見るのが一番辛かった」 | freelancer, 3 years | FundBridge survey (Feb 2026, n=200) https://newscast.jp/smart/news/8165110 [measured + quote] |
| 「仕事を完了したのに、その会社が入金前に倒産してしまった。」 | freelancer, 5 years | same |
| **45.0%** have had late payment, **18.0%** have gone unpaid, 11.0% gave up collecting; 84.0% name unstable income as the biggest worry; 47.0% wait a month or more to be paid | n=200 JP freelancers, Feb 2026 (sponsor sells factoring, so read with care) | same; 47% figure via https://webtan.impress.co.jp/r/prtimes/items/000000002.000171038 [measured] |
| 79% of UK freelancers name cash flow as their major concern; invoices are paid on average 18.5 days after the due date; only 19% say most invoices arrive on time | Ormsby Street, n=1,002 (date not shown) | https://www.pandle.com/?p=27276 via search summary [measured, secondary] |

The 45% late-payment figure now has a second, independent source. The earlier file flagged it as unconfirmed.

### 1.2 Irregular income: the feeling more than the maths

| Quote | Source |
|---|---|
| "mentally it's exhausting constantly asking 'is this a feast month or am I about to hit famine.'" / "I start second-guessing every decision I made when things were 'good.'" | r/PartneredYoutube, 2026-01 https://reddit.sentinel-team.org/posts/1q7g591/snapshots/2026-01-10T03%3A01%3A14.011615Z [community] |
| Replies: "I keep 6-12 months of expenses in the bank" / a large emergency fund is "the only thing that buys me a little peace of mind" | same |
| "I had just signed a lease … thinking this income was stable." / "down about $2k/month in expected income, and I'm panicking" | r/freelance https://reddit.sentinel-team.org/posts/1ntzu2f/snapshots/2026-02-23T12%3A25%3A37.491863Z [community] |
| "I feel like either I have money or I have time. But I never have both." (title) | r/freelance https://reddit.sentinel-team.org/posts/1ov0ske/snapshots/2026-02-23T12%3A25%3A37.491863Z [community] |
| 「毎月収入の乱高下が激しすぎて、日常生活にも影響が出ている。」 | freelancer under 1 year, FundBridge Feb 2026 https://newscast.jp/smart/news/8165110 [measured + quote] |
| 「税金や社会保険料が、会社員の時に比べてかなり負担が大きい。」 | freelancer, 3 years, same |

**[inference]** The anxiety is about *not knowing which month this is* more than about low income. A forecast that says "this is a feast month; the famine starts on the 14th if X doesn't pay" answers the question these posts actually ask.

### 1.3 Card statement timing (the debit-day dread)

| Quote | Source |
|---|---|
| 「私はクレジットカードの引き落とし の日まで待つのがすごくストレスなので、請求が反映されたら…事前に全額入金をお願いしちゃったりします」 (2026-06-14) | https://detail.chiebukuro.yahoo.co.jp/qa/question_detail/q13328930418 [community] |
| 「クレジットカードの引き落としの日まで待つのが嫌で…毎回確定前に事前入金して支払ってます」 (2026-03-31) | https://detail.chiebukuro.yahoo.co.jp/qa/question_detail/q11326785041 [community] |
| 「今度海外へ旅行に行くので初めてクレジットカードを作ったのですが、使った分のお金を翌月に払えなかったら…」 (2019). Best answer: switch to あとからリボ at about 18% | https://detail.chiebukuro.yahoo.co.jp/qa/question_detail/q11214107306 [community] |
| Why travel bills surprise people: hotel deposits, fuel and overseas transactions post on a different date from the purchase, and FX moves can trigger extra debits | PayPay Bank FAQ https://www.paypay-bank.co.jp/debit/answer/notremember.html [vendor] |
| Payment terms run 30–60 days ("月末締め翌月払い" is 30 days), while the card debit is fixed, so the debit often arrives before the client's money | https://atsoho.com/blog/freelance-shiharai-site [secondary] |
| "my balance is currently at $281.83 when I've only spent $158.71" (top reply: look at pending charges and holds) | r/personalfinance, 2026-03 https://reddit.sentinel-team.org/posts/1rm13ba/snapshots/2026-03-06T22%3A02%3A11.942692Z [community] |

**[inference]** Pre-paying to make the waiting stop is the strongest sign that a "Covered ✓ by [source], debits on the 27th" status has emotional value. It removes the reason to pre-pay.

### 1.4 PayPal, FX and fees (cross-border)

| Point | Source |
|---|---|
| PayPal in Japan has two layers: a receiving fee (blogs cite about 3.9% + fixed fee) **plus** a currency conversion spread (blogs cite 3–4%). One worked example: $3,000 at ¥150 → about ¥416k via PayPal vs about ¥447k via Wise. Withdrawals under ¥50,000 cost ¥250 | https://atsoho.com/blog/fintech-paypal-freelance-how-to ; https://pay-route.co.jp/article/?p=8081 [secondary, check against PayPal JP fee page] |
| The phrase freelancers use: 「届いた金額」と「手元に残る金額」は最初から違う | atsoho.com (above) [secondary] |
| "Your funds are usually held for up to 21 days." Freelancers on PayPal community describe needing rent money that was earned 3 weeks earlier. A Kenyan report covers a writer evicted while funds were held | https://paypal.com/au/brc/article/funds-on-hold [vendor]; https://businesstoday.co.ke/paypal-nightmare-experiences-leave-kenyan-writers-online-freelancers-broke-distressed/ [press] |
| An Indian video editor hit with a chargeback by a US client: "I'm shocked at how easy it was for them to do this." Top reply recommends PayPal and keeping screenshots of the client's "thank you" | r/freelance https://reddit.sentinel-team.org/posts/1mqv8ak/snapshots/2026-02-23T12%3A25%3A37.491863Z [community] |
| PayPal won't withdraw USD to a local bank, only local currency (MetaFilter) | https://ask.metafilter.com/345588/ [community] |
| Japanese clients are unlikely to open Wise just to pay a foreign freelancer, so PayPal or a bank transfer stays the default for many | https://lists.tlug.jp/ML/2208/msg00003.html (via search) [community] |

### 1.5 How they cope today

- **Buffers sized in months:** "6-12 months", "enough savings to live 2 years without any income" (r/PartneredYoutube thread above) [community].
- **Live on the worst month:** 「最も収入が低い月を基準に生活費を決める」 (expert advice, https://sogyotecho.jp/freelance-money-management/) [secondary]; "live on your average, not your best months" (https://community.tofu.com/t/how-do-you-handle-irregular-income-as-a-freelancer/726) [community].
- **Separate accounts as envelopes:** a tax account at 25% of sales after a 住民税 shock in year 2 (https://atsoho.com/blog/money-freelance-resident-tax) [community]. On HN, one user split money between two banks "to replicate safe-to-spend" after Simple closed (HN 25681323) [community].
- **Weekly spreadsheet plus a monthly transfer of "exactly the amount I needed for that month"** (ex-Microsoft founder, 2026-01-06, https://vinitvr.pages.dev/personal-blog/finance-tracking-without-salary) [community].
- **Pre-paying the card early** (知恵袋, above).
- **YNAB's "budget only money you have"** is praised for irregular income ("YNAB does that out of the box", HN 22903308) but also found hard to fit ("I've never managed to make it handle that well", HN 8017446) [community].
- **[inference]** Every method is a way to **turn uncertain future money into a number you can trust today**. That is the job.

---

## 2. What loved products got right (one line each) and why people left

### 2.1 The one thing each got right

| Product | The feeling, in one line | Evidence |
|---|---|---|
| **Simple** (Safe-to-Spend) | "Can I spend this?" answered in a single number that changes how rich or poor you feel that day | HN 4413472 (2012, summarised by the fetch tool); "Simple's 'Safe-to-Spend' is really a game changer for people like me" (HN 25687818, 2021); "the most transparent feature they've seen from any bank" (HN 25679699, paraphrased). Around 30 HN comments from 2011–2026 praise it, and new builders still cite it (HN 47087816, 2026) [community] |
| **Monzo** (early) | "I know the moment it happens": instant spend notifications and a balance that updates immediately | Monzo: "We'll tell you as soon as you spend" (https://monzo.com/blog/2019/10/24/15-features-thatll-turn-monzo-sceptics-into-monzo-obsessives) [vendor]. Reviewers say it lets them be "confident my card details haven't been breached" (Smart Money People) [community] |
| **Monzo Get Paid Early** | Payday arrives sooner. Monzo says about 70% of eligible payments are taken early | https://monzo.com/features/get-paid-early [vendor]; Which? found the gain is often only about 8 hours (https://www.which.co.uk/news/2019/08/monzo-allows-current-account-customers-to-get-their-salaries-a-day-early/) |
| **YNAB** | Being ahead of your money: "less stressed" (YNAB claims 92% of users say so) and "Age of Money" | App Store listing and YNAB stats page [vendor]; Carsen case study: stress "disappeared" (https://www.ynab.com/blog/how-carsen-saved-three-months-of-living-expenses-in-18-months) [vendor] |
| **Copilot** | An app people "actually enjoy opening": design, plus AI categorising things so they don't have to | Penny Hoarder, 9to5Mac reviews (https://www.thepennyhoarder.com/?p=225952) [secondary] |
| **Wise** | "I see the fee and the rate before I send." Transparency made the product | TrustRadius, Financer reviews (https://www.trustradius.com/products/transferwise/reviews) [community/secondary] |
| **Revolut** | Confidence spending abroad: "the easiest way to spend money abroad" after a local bank blocked the user's cards | https://dreambigtravelfarblog.com/blog/revolut-review ; Trustpilot [community] |
| **Found** | "I love how it takes taxes out immediately so I don't have to think about it." | found.com testimonial [vendor] |
| **Wave** | "takes that worry off you" / "for the peace of mind alone, totally worth it" | waveapps.com testimonials [vendor] |
| **Square invoices** | The paid-invoice "cha-ching": "it really makes my day", "it's like a celebration!" Users asked for it back when an update removed it | https://community.squareup.com/t5/Troubleshooting/Invoice-PAID-cash-register-sound-is-gone-WHY/td-p/151999 (2020–2023) [community] |
| **Money Forward ME** | 「終わっちゃえば全部自動で計算してくれるから楽」: set up once, everything is collected | みん評 / my-best reviews (https://minhyo.jp/moneyforward-app) [community] |
| **Zaim** | Photograph the receipt instead of typing it (from the earlier UX file; not re-verified) | `../ux/daily-money-apps.md` |
| **PayPay** | Points: 「ポイントがたくさん貯まるから」 was the top reason for QR payments (MMD 2023) | https://www.commercepick.com/?p=31346 [measured, 2023] |
| **Mint** | Every account in one place, categorised automatically, free | CNBC 2023 (https://www.cnbc.com/2023/11/07/budgeting-app-mint-is-shutting-down-users-are-disappointed.html) [press] |

**[inference]** None of these is "insight" or "advice". Each one removes an uncertainty (can I spend? did it happen? what will it cost? did I set aside enough? did they pay?) at the moment it arises.

### 2.2 Why people left

| Reason | Evidence |
|---|---|
| **Typing it in** | NilCraft JP survey: the top three reasons for quitting a 家計簿 are all about input effort; about 20% quit within a month; only 30.3% who retry succeed, and the top change among those who stuck with it was 「毎日こまめに記録することをやめた」 (18.5%) (https://prtimes.jp/main/html/rd/p/000000007.000182139.html) [measured, vendor-run, n≈300]. "expense tracking is an incredible drudge"; apps "require too much babysitting and aren't smart enough" (r/MiddleClassFinance, 2025-12, https://reddit.sentinel-team.org/posts/1pp2tk7/snapshots/2025-12-20T11%3A10%3A57.037049Z) [community] |
| **The system doesn't match life** | "having defined categories doesn't really match how people do their shopping" (same thread); "YNAB, Monarch, and Copilot force one budgeting shape on every user" (HN 48261088, 2026-05) [community] |
| **Sync breaks** | Monarch reviewers report reconnecting "every three days" (Trustpilot); Monarch support says "we can't ever guarantee any specific connection" (r/MonarchMoney mirror). Money Forward reviewers report a broker link failing for a month or more and card data arriving late (https://minhyo.jp/moneyforward-app) [community] |
| **Guilt** | "notifications made me feel like a parent was scolding me" … "the tool slowly turned into a chore, and one day I just... stopped opening it." (Product Hunt thread, 2026) https://www.producthunt.com/p/general/what-s-the-money-app-you-rage-quit-and-what-finally-did-it [community] |
| **Price or paywall changes handled badly** | YNAB, Nov 2021: $83.99→$98.99, about double for $45 legacy users, announced by in-app pop-up; users called it a "breach of trust" and left for Aspire or Actual (r/ynab mirrors, https://lr.us.psf.lt/r/ynab/comments/qlunk3/ynab_communication_about_price_change). Money Forward ME cut free account links from 10 to 4 (Dec 2022); users called it 「改悪」 (https://appllio.com/news/2022-11-08-34376-money-forward-me-service-link-change) [press] |
| **Learning curve** | "noticeably steep learning curve"; "took a few months to 'get into'" (YNAB Trustpilot, G2) [community] |
| **Shutdown or pivot to selling** | Simple's closure (2021) took away Safe-to-Spend, with no replacement at BBVA or PNC (NerdWallet). Mint→Credit Karma (2024) was read as moving users from budgeting to a loan marketplace (prior file) [press] |
| **The number stopped fitting how they pay** | "don't think running everything directly from a checking account is wise" (moved to a credit card plus YNAB, HN 25678864). **Safe-to-Spend could not see card spending** [community] |

---

## 3. The AI trust line

### 3.1 What people will let an AI do (2025–2026)

| Task | Figure | Source |
|---|---|---|
| Proactive reminders (pay bills, save) | 59% trust AI to do this | MX, Sep 2024 (https://www.mx.com/blog/shifting-trust-in-ai/) [measured] |
| Make recommendations on its own | 18% | MX follow-up survey (n>2,500, date unclear) [measured, secondary] |
| Handle payment transactions | **23%** trust gen-AI; 61% would trust Visa | Visa/Harris, May 2026, n=2,065 US (https://finovate.com/visa-study-finds-consumers-trust-ai-to-shop-but-not-to-pay/) [measured] |
| Approve every transaction before payment | **33%** want this | Global Payments, published 2026-09-23 (https://finviz.com/news/394701/) [measured] |
| Act only if they approve each action | 34% | Radial/Dynata, Dec 2025–Jan 2026, US (via search) [measured, secondary] |
| Agent picks within limits, user reviews before paying | 32%; fully autonomous payment 12% | Accenture "Talk to my AI Agent" 2026, 25k+ in 16 countries, including Japan n=1,005 (https://www.accenture.com/gb-en/insights/consulting/talk-my-ai-agent) [measured] |
| Comfort by amount | 29% "very comfortable" under $20; **6% at $500+**; airfare and hotels 17% | Wildfire, 2026-10-20, n=1,007 US (https://www.prnewswire.com/news-releases/survey-agentic-commerce-has-a-payment-trust-problem-302913466.html) [measured] |
| Who should process an agent's payment | AI platform 5%; bank 17%; wallet 14%; none 41% | same |
| Limit allowed without extra approval | average £177 per purchase; wanted controls: spending cap 30%, instant revoke 29%, easy cancel 28% | Checkout.com 2026, 6 markets (https://www.checkout.com/ja-jp/newsroom/agentic-commerce-report-2026-jp) [measured] |
| **Checking the AI's work** | **47% find constant oversight of AI agents more concerning than its mistakes**; 5% comfortable with AI acting even with approval | Ping Identity 2026, n=11,000, 12 countries (https://briefglance.com/companies/ping-identity-corporation/pulses/85001) [measured, secondary] |
| **Japan**: let AI do 家計の計算・お金の管理 | **5.3%** (vs 53.0% for 調べもの); 60.7% want to decide 大きな買い物・お金の使い道 themselves | GLAM, 40s women, n=300, Aug 2026 (https://prtimes.jp/main/html/rd/p/000000017.000118812.html) [measured, small] |
| **Japan**: link household data to gen-AI | 77.7% would use it; 14.8% would not, and 67.5% of those cite privacy | Money Forward ME users, n=1,000, 2026-06-30 to 07-05 (https://news.infoseek.co.jp/article/prtimes_000001676_000008962/) [measured, users only] |

### 3.2 Where the line is

- **Read: yes.** Most people want their data linked when the benefit is visible, while privacy is the main objection (MF 77.7% vs 14.8%).
- **Remind and suggest: yes.** Reminders are the most trusted AI task (MX 59%).
- **Draft: yes.** This is the "within limits, I review before payment" pattern (Accenture 32%).
- **Send or pay: only with a tap, per item, showing the amount and recipient.** About a third insist on per-transaction approval. Under 15% would accept autonomous payment, and that falls to about 6% above $500.
- **[inference]** Approving costs attention too. If every small action needs a tap, the 47% "oversight is worse than mistakes" group churns. The answer is **few approvals, each worth it**: one card when it changes the runway, not a queue of 12.
- **[inference]** An invoice or payment reminder goes to a *client*. Freelancers' stated fear is "damage the client relationship" (§1.1). So the approval card must show the exact message text and tone, not just "Send invoice $800?". Their reputation matters more than the money here.
- **[inference]** In Japan the framing must keep the decision with the person (60.7% 自分で決めたい). The app says 「〜した方が安全です」 and the user taps; it never says 「〜しました」 about money it moved.

---

## 4. How freelancer tools describe the problem (landing-page words, fetched 2026-11-01)

| Tool | Hero / key words (verbatim) | What users praise (verbatim) |
|---|---|---|
| **Found** | "Business banking with built in tax tools"; tax page: "Peace of mind that lasts beyond tax season", "Take the guesswork out of tax season", "When you get paid, we'll set aside money to cover your estimated taxes." | "takes taxes out immediately so I don't have to think about it"; "I'm a social worker, not a business major" |
| **Lili** | "Expect more from your business banking."; "Set aside funds … to stay tax ready" (no "freelancer", "cash flow" or "irregular income" anywhere on the page) | "provided the clarity and confidence to take big leaps"; "This bank wants you to win" |
| **Collective** | "Run your business. We'll run the numbers."; "Stress-free taxes for solopreneurs"; "Get paid faster, without the busywork" | (no testimonials on page) |
| **Wave** | "Clear books. Confident decisions."; "know who owes you and who you owe"; "Unpaid invoices can quickly disrupt a small business's cash flow." | "takes that worry off you"; "for the peace of mind alone, totally worth it" |
| **Bonsai** | "The unified platform for service businesses" (now sells to firms; "freelancers" appears once) | "It costs me a click, instead of a full-time job." |
| **Wise Business** | "The business account for going global"; "get paid … in different currencies" | (reviews) "no hidden fees", fee "shown upfront before confirming" |
| **freee** | 「みんなが選ぶ確定申告ソフトであんしん」; 「はじめての確定申告も乗り越えられる」; 〇×形式の質問に答えるだけ | (blog) 簿記を知らなくても直感的に |
| **Money Forward Cloud 確定申告** | 「月々900円〜で使える確定申告ソフト」; pains quoted from cases: 「初めての確定申告で何から手をつけたらいいかわからなかった」「明細を会計ソフトへ入力するのが大変だった」 | 「初めての確定申告も安心」; 「取引データが毎日自動で取り込まれる」 |
| **Misoca (Yayoi)** | 「クラウド請求書作成ソフト」; 「請求・回収漏れを防ぎたい」 | (no direct quotes) |

**Patterns [inference]:**
- The shared vocabulary is **peace of mind / 安心 / no guesswork / no worry / don't have to think about it.** It is a promise of *absence* (of worry, of typing, of a tax surprise).
- They all describe the **business** problem (books, taxes, invoices). None describes the **personal** problem: rent, the card bill on the 27th, the trip. That is the gap our product sits in.
- US tools are drifting upmarket (Lili and Bonsai now say "business" or "firms"). The solo, cross-border person is being left behind.
- Japanese tools sell **安心 for first-timers** and **自動取り込み**, never speed or "AI".
- Nobody uses "runway", "safe to spend" or "can I afford" on a freelancer landing page, and nobody mentions FX or PayPal fees except Wise.

---

## 5. What keeps a money app daily

- **Most installs are gone by day 30:** finance D30 retention is about 9% on iOS and 5% on Android (AppsFlyer Q4 2025, via Liftoff, https://liftoff.ai/es/?p=35620). Other aggregators say 3–4.5%, and definitions vary [measured, secondary]. Only 1 in 5 who install a fintech app sign up in the first week; active users launch about 11 times a month (CleverTap 2022, https://clevertap.com/news/press-release/clevertaps-fintech-benchmark-report-only-1-in-5-users-that-install-fintech-apps-sign-up-within-week-one) [vendor].
- **What brings people back is a money event, not content.** The earlier files cover payday logins and balance checks. New here:
  - **The "paid" moment is emotional.** Square sellers call the cha-ching "a celebration" and asked for it back.
  - **The "it happened" moment** is Monzo's founding feature.
  - **[inference]** For a freelancer, "Acme paid $1,200 → ¥171,400 after fees, runway now to Dec 9" is the daily-open trigger. It is PayPal data by definition.
- **What makes people stop:** typing (NilCraft), reconnecting (Monarch), scolding (Product Hunt), and upkeep: "too much babysitting" (r/MiddleClassFinance).
  - **[inference]** Reading bills and receipts from email avoids bank-sync breakage, but **forwarding a receipt by hand is still manual entry**. Ingestion has to be automatic (inbox read with consent, PayPal events), with photos as the exception.
- **Low-effort routines last.** Among JP 家計簿 users who succeeded on a second try, the top change was stopping daily logging (18.5%) and dropping fine categories (16.0%) (NilCraft).
  - **[inference]** Make the daily open a 5-second glance that needs nothing from the user, and keep the "review" to weekly or on events.
- **Avoidance:** people log in less when things are bad (earlier file).
  - **[inference]** The worst-case view must never feel like a scolding. Phrase it as a plan ("If Acme is late, hold off on X until the 14th"), not a red warning.

---

## 6. What this means for our product (10 blunt bullets)

1. **The one feeling: "I know where I stand before it happens" (先に分かるから安心).** Every loved product removed one uncertainty at the moment it arose. Ours removes "will the money be there when the card debits?" Nothing else is the point.

2. **The first screen says one sentence, a date and a name.** For example: **"You're OK until Dec 9. If Acme pays late, hold off from the 14th."** / 「12月9日までは大丈夫。Acmeの入金が遅れたら14日以降は控えめに。」 The number (safe to spend) goes under the sentence, never in place of it. **[inference]**, built on Simple and HN.

3. **The number must include card spend that hasn't been billed yet.** Simple's Safe-to-Spend broke for people who pay by card, because it could not see card spending. Our number subtracts this month's charges and the next statement, including trip spend in yen after FX. That is the one structural thing we do that Simple couldn't.

4. **Model the worst case as a named client, not a percentage.** Freelancers think "Acme is 3 weeks late", not "income −20%". The worst case should be built from *which* invoices slip, with days overdue shown. Their own words are "is this a feast month or famine". Answer with the date famine starts.

5. **When short, the first action is a polite nudge on an invoice already sent; a new invoice comes second.** The pain is "I don't know when I should send another reminder" and "I don't want to damage the client relationship." Draft the reminder at the right day, in a tone they would use, and show the exact text on the approval card. A new invoice or deposit request is the second rung. Never offer PayPal Credit or Pay Later as the fix (that is the Mint/Credit Karma trust break).

6. **Turn the card debit date from dread into a check mark.** People pre-pay to stop waiting. Show "Covered ✓ by PayPal balance + Acme (due 20th)" on each statement, and say early, before the statement closes, if it isn't covered. After a trip, show the trip total in yen before the bill does.

7. **Show the money as it will land: net, in yen, after fees.** 「届いた金額」と「手元に残る金額」は違う is what freelancers complain about, and Wise won trust by showing the fee before you send. Show PayPal's own receive fee and conversion honestly on every payout. Hiding it would cost more trust than the fee does. **[inference]**

8. **AI line: read, suggest and draft by default; send only on a tap, one item at a time; never move money.** Keep approvals rare and valuable (47% would rather have mistakes than constant checking), and cap it to things that change the runway. Pitch it as **"You approve, it sends"** / 「送るのは、あなたが確認してから」. Don't say "AI agent" or "AI advisor" on screen: 5.3% in Japan want AI managing money, and 23% in the US trust it with payments.

9. **Cut from the hackathon build:** categories and budgets, spending charts, net worth, a chat-first home, streaks and gamification, anything typed by hand, and any red over-budget state. Keep: the sentence, the runway (expected vs worst), the card statements with a covered status, the "paid" moment, and one approval card. Wealth moves stay in the product but appear only in surplus moments (as decided in the earlier files), never on the first screen.

10. **Words to use, and words to drop.**
    - **On screen:** "OK until [date]", "safe to spend", "covered ✓", "short by ¥X on the 27th", "hold off", "waiting on Acme (12 days late)", "you'll receive ¥X after fees", "paid ✓". JP: 「〇日まで大丈夫」「カバー済み」「〇円足りません」「控えめに」「入金待ち」「手取り」.
    - **Pitch:** "Know before the card bill does." / "Can I spend, or should I hold off?" / 「使っていいか、待つべきか。」
    - **Avoid:** budget, planner, wealth, AI advisor, insights, 家計簿 (it signals typing).
    - **Celebrate the "paid" moment** (the Square cha-ching lesson). It is the one notification people want, and it is PayPal's own event.

---

## 7. What I couldn't verify

- **Reddit, X/Twitter and note.com directly.** Reddit was read through a third-party snapshot mirror, so scores and comment counts are partial. X and note.com first-person posts were not reachable, and searches returned only blogs. Japanese voice comes from the FundBridge survey free text and Yahoo!知恵袋.
- **r/digitalnomad, r/PayPal and r/japanlife** threads specifically about USD-paid freelancers in Japan were not found. Snapshots were sparse. **There is still no survey of Japan-resident freelancers paid in foreign currency.**
- **PayPal JP fee figures** (3.9% + spread, ¥250 under ¥50k) come from blogs. Check them against PayPal's JP fee page before putting them on screen.
- **Finance D30 retention** figures disagree (3–12%) because definitions differ. The AppsFlyer figure is via Liftoff, not the original report. The "80% stop within a month" claim was not found in a primary source.
- **Ping Identity 2026** (the 47% figure) and **Global Payments** (33%) were read through secondary coverage. The Checkout.com sample size and dates were not stated. Accenture's Japan-only numbers sit behind a members-only article.
- **Japan AI figures** are small or skewed: GLAM n=300 women in their 40s; Money Forward n=1,000 of its own users.
- **Satisfaction claims** (YNAB 92% less stressed, $600 saved; Monzo 70% Get Paid Early uptake) come from the companies themselves.
- **Why people left Revolut, PayPay or Copilot:** no systematic data found, only anecdotes. The PayPay "why people use it" data is from 2023.
- **フリーランス保護新法** (Nov 2024, payment within 60 days of receipt) may give the app a legal hook for "this client is past 60 days". Whether it covers *overseas* clients was not checked.
- **Monzo's early "hot coral" era sentiment**: no first-hand 2015–2017 user quotes retrieved beyond Monzo's own blog and later reviews.
