# Everyday money apps: how they are structured, and what our app should do

Research date: 2026-11-01. Web research only. Every claim that comes from a source has a link. Items marked **(unverified)** come from my own memory of the apps or from weak sources. Check them in the real app before relying on them. Tab names change often: Monzo, Monarch, YNAB, Money Forward and PayPal have all changed their tab bars in the last 1–2 years.

---

## 1. App by app

### PayPal (consumer app)
- **Tabs (Germany, rolling out July 2026):** the old menu is gone. There are now 3 bottom tabs: **Home**, **Senden** (Send) and **Konto** (Account). Contactless (NFC) pay is reached straight from the bar. [GIGA, 13 Jul 2026](https://www.giga.de/tech/wer-die-paypal-app-nutzt-musst-sich-jetzt-umstellen--01KXDRN40Y2WSPACPNFSXNAJG9)
- **Home** shows PayPal balance, Rewards points and open Pay Later instalments, then cashback and merchant deals.
- **Send** holds send, request and money pools. **Account** holds balances, transactions (activity), subscriptions and deliveries.
- **US app:** the 2021 "super app" relaunch had Wallet, Finance (savings, crypto) and Shopping sections. [SiliconANGLE 2021](https://siliconangle.com/2021/09/21/paypal-launches-massive-update-coupons-direct-deposit-bill-pay/), [TechRadar](https://www.techradar.com/news/paypal-launches-super-app-to-cover-all-your-payment-needs). I could not confirm the current US tab bar **(unverified)**.
- **Invoicing on mobile:** Request → "Send an invoice to get paid" → who / what / notes → Review → Send. It also offers quick invoices (a shareable link), recurring invoices, and up to 2 manual reminders per 24 hours. [PayPal help](https://www.paypal.com/us/cshelp/article/how-do-i-create-and-send-an-invoice-help319). For sellers this lives in the separate **PayPal Business** app. [App Store](https://apps.apple.com/us/app/id1053148887)
- **Notable:** PayPal is cutting down to 3 tabs and pushing everything else into Account. Home is "what you have + what's open". Activity is not a tab of its own.

### Wise
- **Tabs:** bottom navigation. Wise help pages mention a **Cards** tab, a **Payments** tab and a **Recipients** tab, and say transactions are on Home. [Wise help: cards tab](https://www.wise.com/help/articles/2977967/im-having-trouble-adding-my-wise-card-to-a-mobile-wallet), [Wise help: request money](https://wise.com/help/articles/2WvlZST6DiDMUBhyl1N4zM/how-do-i-request-money). My best reading is Home · Cards · Recipients · Payments, with the account/profile reached from the top of the screen **(order unverified)**.
- **Home:** currency balances as cards you swipe sideways, plus jars and groups (Wise's names for separate pots and shared balances). Then a Send / Add / Request row, then transactions. [Wise: new look](https://wise.com/help/articles/645Ve1Ah1Psi0srHGfKYmm/your-wise-account-has-a-new-look)
- **Critique:** the currency cards take over the returning-user screen and push primary actions down. Promos sit above the rate calculator. New users face too many competing options. [Pratt IxD critique, Sep 2025](https://ixd.prattsi.org/2025/09/design-critique-wise-ios-app/)
- **Get paid:** you can request payment from a currency balance, the Payments tab or the Recipients tab. Business accounts get payment links (amount, purpose, optional invoice and due date, one-time or reusable, tracked as paid/unpaid). [Wise help: payment links](https://www.wise.com/help/articles/4qr3kkvIQlHNiD8BegEB4u/getting-paid-to-your-wise-business-by-payment-link), [reusable links](https://wise.com/blog/reusable-payments-links)
- **Notable:** money is organised **by currency**, and "get paid" is a first-class action. This is the closest match to a freelancer paid in USD who lives in JPY.

### Revolut
- **Tabs (Revolut 10, Oct 2023):** the bar went from 3 buttons (Home, Transfers, Hub) to 5: **Home, Invest, Payments/Transfers, Crypto, Lifestyle** ("Lifestyle" replaced "Hub"). [Presse-citron](https://www.presse-citron.net/revolut-fait-peau-neuve-les-plus-grosses-nouveautes-qui-debarquent/), [Finextra](https://www.finextra.com/pressarticle/98301/revolut-overhauls-design-and-layout-of-primary-app-account)
- **Home:** total balance with account switcher, then quick actions (Add money, Move, Details, More), then recent transactions, then customisable widgets (themes, widgets, custom backgrounds were headline features). [The Digital Banker](https://thedigitalbanker.com/revolut-launches-its-best-version-yet-as-it-passes-35m-customers-worldwide-meet-revolut-10-built-for-ease/)
- **Travel/foreign spend:** Analytics can sort by category, merchant, **country, currency** or card. **Revolut Trips** detects trips automatically (card payments outside your home country, at least 2 days and 2 transactions), shows a map, and lets you edit or add trips. [Revolut help: Trips](https://help.revolut.com/help/accounts/budget-and-analytics/revolut-trips-using-revolut-trips/), [How is a trip defined](https://help.revolut.com/en-US/help/accounts/budget-and-analytics/revolut-trips-how-is-a-trip-defined/), [Analytics](https://help.revolut.com/help/app-features/budgeting-and-analytics/how-does-the-analytics-feature-work/)
- **Notable:** travel is **not a tab**. It is a view inside spending analytics, and trips are grouped automatically.

### Monzo (UK)
- **Tabs:** a redesign cut the bar to **Home, Payments, Help** (Summary and Account tabs removed). [Monzo community announcement](https://community.monzo.com/t/were-working-on-a-new-look-for-the-monzo-app/65333). Later a **Grow** tab (savings, investments, pension, home equity) arrived so that Home stays "focused on your day-to-day spending", and **Trends** moved onto Home. [Monzo: Grow tab](https://community.monzo.com/t/we-re-launching-grow-tab-sign-up-for-early-access/190853). Current exact bar **(unverified)**.
- **Home:** balance and card, pots and accounts as cards, then the transaction feed. Trends and spending insights sit on Home.
- **Complaints:** after the redesign, users could not find the pots view and kept tapping Payments. They missed the running balance, called the look "generic", and disliked that pots had no transaction history. [Monzo redesign retrospective thread](https://community.monzo.com/t/monzo-redesign-a-retrospective/95953). Users also said they rarely use Help or Payments, yet those tabs take prime space. [It's time to kill the Payments and Help tabs](https://community.monzo.com/t/its-time-to-kill-the-payments-and-help-tabs/107420)
- **Notable:** Monzo deliberately keeps Home about **day-to-day money** and moves long-term wealth into another tab. That is the same split we want between "today" and "Found for you".

### Copilot Money (US, iOS/Mac/web)
- **Tabs:** **Dashboard** (default home), Transactions, Accounts, Cash Flow, Categories, Recurrings, Investments, Goals. Users can reorder them (Settings › Appearance › App sections). iPad and web use a **sidebar**. [Copilot help: Dashboard](https://help.copilot.money/en/articles/6045480-dashboard-tab-overview), [Quick start](https://help.copilot.money/en/articles/11157550-quick-start-guide), [9to5Mac iPad review](https://9to5mac.com/2024/10/31/copilot-money-review-ipad-cash-flow-tags/), [Copilot for web](https://help.copilot.money/en/articles/11780342-copilot-money-for-web)
- **Dashboard, top to bottom:** (1) **Graph with "Free to Spend"** at the top, e.g. "$1,380 left" this month. It plots the ideal pace against actual spend, leaves out expected recurring bills, and the line colour shifts with the day of the month. (2) **To Review**: newly imported transactions you have not confirmed yet. (3) **Budgets**: trending categories with what's left. (4) **Upcoming**: expected recurring charges you scroll sideways. (5) **Net this month** vs last month. (6) referral promo. [Copilot help: Dashboard](https://help.copilot.money/en/articles/6045480-dashboard-tab-overview)
- **Recurrings** shows "paid" vs "**left to pay**" this month. [Money with Katie review](https://moneywithkatie.com/blog/copilot-review-a-budgeting-app-that-finally-gets-it-right?format=amp), [Copilot pricing page](https://copilot.money/pricing/)
- **Notable:** this is the best model for our home. One number ("left"), then a **review queue** (our AI approval cards), then upcoming, all on one screen. Each item links out to its own tab.

### YNAB
- **Tabs (mobile):** **Home, Plan, Spending, Accounts, Reflect**. Help is no longer a tab. [YNAB: Spaces in the mobile app](https://support.ynab.com/en_us/spaces-in-the-mobile-app-S1iIZQoqgg.md). On the web the same sections sit in a **left sidebar**. [Spending Trends](https://support.ynab.com/en_us/spending-trends-H1inlhzAc.md)
- **Home:** an **alert at the top** if there is money to assign, transactions to approve or overspending to cover. Then pinned priority categories, one current goal, the month summary (Targets / Assigned / Underfunded / Spent), future months, and "For You" content. Every section can collapse. [At Home in YNAB](https://support.ynab.com/en_us/spotlight-BkdHBZUokg.md)
- **Approval flow:** imported transactions need approval. A newer iOS **Card Mode** lets you swipe right to approve and left to skip, and the old List Mode is kept. [Updates to YNAB](https://support.ynab.com/en_us/updates-to-ynab-S1f4aRLeC.md), [Approving & matching](https://support.ynab.com/en_us/approving-and-matching-transactions-a-guide-ByYNZaQ1i.md)
- **Notable:** "things that need you" appear as **one alert at the top of Home**, not as a separate tab. The approve/skip swipe card is a proven pattern for confirming data the machine read.

### Monarch Money
- **Navigation:** the iPhone bottom bar shows **5 tabs by default**, and every other screen sits in a **sidebar**. Users choose which items go in the bar (Settings › Display & Navigation › Edit Navigation). [Monarch What's New](https://www.monarch.com/ipad-support-budget-enhancements-and-more). Sections include Dashboard, Accounts, Transactions, Cash Flow, Budget/Plan, **Recurring (as a calendar)**, Goals, Investments, Reports. [Monarch getting started](https://help.monarch.com/hc/en-us/articles/360048393272-Getting-Started-Guide), [Motley Fool review](https://www.fool.com/money/personal-finance/monarch-money-review)
- **Dashboard:** customisable widgets (net worth, budget, goals, monthly spending, recent transactions, investments). Default 5 tabs **(unverified)**.
- **Notable:** a strong desktop model (sidebar plus widget dashboard). The Recurring calendar is the reference for a bills calendar.

### Rocket Money
- **Structure:** **Dashboard** first (monthly income, spending by category, **upcoming bills**, recent balance changes, recurring services), then **Recurring** (subscriptions, cancel assistant), Spending/Budgets, Net Worth (premium), Credit, and others under **More**. [Clark review](https://clark.com/save-money/rocket-money-review/amp/), [Rocket Money help](https://help.truebill.com/articles/1940551-how-to-get-the-most-out-of-truebill), [Motley Fool](https://www.fool.com/money/banks/articles/is-rocket-money-worth-paying-for-heres-what-you-really-get)
- **Notable:** "found savings" (subscriptions to cancel, bill negotiation) is the product's hook, but it sits in its **own section**, not on top of your balance. Exact tab labels **(unverified)**.

### Cash App
- **Tabs:** official help puts the **Money** tab (balance) at the bottom left and **Activity** (clock icon) at the bottom right. [Cash App help: balance](https://cash.app/help/6539-view-cash-balance), [Activity](https://cash.app/help/us/en-us/6540-view-activity). The middle holds the **$ / Pay** keypad, plus Card and Investing/Discover. The middle tabs are **(unverified)**; third-party guides disagree.
- **AI:** "Moneybot" (Nov 2025) answers questions about balance and habits and **suggests actions** (split a bill, request money). It only acts after the user confirms. [TechCrunch](https://www.techcrunch.com/2025/11/13/cash-app-debuts-a-new-ai-assistant-that-answers-questions-about-your-finances), [Design Compass](https://designcompass.org/en/2025/12/03/cash-apps-new-design-language-and-ai-moneybot/)
- **Notable:** an AI that suggests and the user confirms before anything moves. That is exactly our draft-invoice model.

### Money Forward ME (マネーフォワード ME, Japan)
- **Tabs (since Aug 2026, v20):** cut from 6 to 5: **ホーム (Home), 入出金 (in/out transactions), 家計簿 (household budget), 口座 (accounts), 資産 (assets)**. The Points tab moved into a new **マイページ (My page)**, opened from an icon at the top left. My page also holds reports and settings. The reason given: paths to settings and reports had become so complex that users "couldn't reach the function they wanted". [Impress Watch, 21 Aug 2026](https://www.watch.impress.co.jp/docs/news/2134734.html), [AppBank](https://www.appbank.net/2026/08/19/iphone-news/3081407.php)
- **Home:** total assets with a separate **liabilities (負債)** entry at the top, then this month's income and spending, budget, linked accounts and card withdrawals. The monthly report sits behind the gear icon. [MF support](https://support.me.moneyforward.com/hc/ja/articles/900006008226-). Exact order **(unverified)**.
- **Notable:** a major Japanese app **removed a tab** to simplify, and moved reports and settings off the bar into a profile page.

### Zaim (Japan)
- **Structure:** the classic layout is Home (amount spent today / this week / this month), **入力** (input: receipt camera or typing it in), history/calendar, **分析** (analysis pie charts), plus settings. [Impress](https://internet.watch.impress.co.jp/docs/column/biz_i_app/640274.html), [Precious](https://precious.jp/articles/-/2269). Current tab labels **(unverified)**; the sources are old.
- **Notable:** **receipt capture is a primary action**, one tap from the bar. Relevant to our "photograph a receipt" feature.

### PayPay (Japan)
- **Home (Apr 2024 renewal):** the **pay barcode at the very top**, a **transaction history** icon right under it, swipe to switch between balance and PayPay Card credit, then points, available card credit and balance status, then shortcuts to Card, Bank and NISA (Japan's tax-free investment account). [Appllio](https://appllio.com/news/2024-04-23-50196-paypay-app-home-renewal), [Impress Web担](https://webtan.impress.co.jp/n/2024/04/24/46926)
- **Bottom bar:** the "残高" (balance) tab was renamed **ウォレット (Wallet)** in Oct 2022. Wallet shows usable amount, recent transactions and points. [PayPay notice](https://paypay.ne.jp/notice/20221026/f-wallet/). It also has Scan, Pay and Account. [PayPay help](https://paypay.ne.jp/help/c0140/)
- **Notable:** the primary action leads Home. Credit and cash sit side by side and you swipe between them.

### Rakuten Card app (楽天カード) / Vpass (SMBC Card)
- **Rakuten Card Home (added Nov 2021):** **ご利用可能額** (available credit), **請求金額** (amount billed) and **引き落とし口座** (account it is paid from) on one screen. Swipe the card image to reach that card's statement. Change how you pay from Home (revolving, instalments, pay with points). Points at the top left, notices with an unread badge at the top right. [Rakuten Card press release](https://www.rakuten-card.co.jp/corporate/press_release/20211104/), [All About](https://news.allabout.co.jp/articles/o/33662/). The Feb 2024 renewal added memos on statement lines and a custom header. [Appllio](https://appllio.com/news/2024-02-19-48526-rakuten-card-app-renewal)
- **Vpass:** the main features are the statement (ご利用明細) and **次回のお支払い金額** (next payment amount). Each month an email says the bill is final (請求額確定通知). [App Store](https://apps.apple.com/jp/app/%E4%B8%89%E4%BA%95%E4%BD%8F%E5%8F%8B%E3%82%AB%E3%83%BC%E3%83%89-vpass%E3%82%A2%E3%83%97%E3%83%AA-%E3%82%AF%E3%83%AC%E3%82%B8%E3%83%83%E3%83%88%E3%82%AB%E3%83%BC%E3%83%89%E6%B1%BA%E6%B8%88%E7%AE%A1%E7%90%86/id838138452), [SMBC: WEB明細](https://www.smbc-card.com/mem/oshiharai/pop/mail.jsp)
- **Notable:** Japanese card users think in terms of **"this statement amount, final or not" + "withdrawal date" + "which bank account"**. Our card view should use exactly those three facts, plus our "covered?" answer.
- **Apple Card (reference for the payment view):** the payment screen shows the balance with a ring, a green check when paying the full balance means **no interest**, and an interest estimate appears as you move the slider. [Apple support](https://support.apple.com/en-ca/102294), [CNBC](https://www.cnbc.com/2019/09/25/how-to-make-apple-card-payments.html), [AppleInsider](https://appleinsider.com/articles/19/08/14/how-to-pay-your-apple-card-bill)

### Found (US, self-employed banking)
- **Features:** tax estimate with **auto-save for taxes**, **pockets**, unlimited **invoices** (templates, auto-fill), automatic expense categorising, receipts with notes, virtual cards, real-time notifications, and an AI assistant called "Found Assistant". [App Store](https://apps.apple.com/us/app/id1477267167?l=en-us)
- **Praise:** the tax set-aside with an editable percentage, and pockets that take a percentage of each deposit. **Complaints:** deposit holds, verification friction. Same source.
- **Tabs:** not documented; I believe Home · Taxes · Invoices/Get paid · Pockets/Cards **(unverified)**.

### Lili (US, freelancer banking)
- Banking plus a **Tax Bucket** (auto set-aside of a percentage of income), invoicing with reminders (paid tiers), expense categorising. Reviews disagree on whether there is desktop access. [Business.org](https://www.business.org/finance/banking/lili-banking-review/), [Merchant Maverick](https://www.merchantmaverick.com/reviews/lili-bank-review/), [Finder](https://www.finder.com/business-banking/lili-banking). Tab structure **(unverified)**.

### Wave (accounting)
- **Dashboard:** **overdue invoices and bills**, cash-flow graph (cash basis), payables and what you are owed, bank balances, profit and loss. Customisable on the web but **not on mobile**. [Wave help: new dashboard](https://support.waveapps.com/hc/en-us/articles/48497863638548-Overview-of-your-business-Dashboard-new-Dashboard-experience). An older manual adds "Total overdue / Due within next 30 days / Average time to get paid". The sidebar has Dashboard, Sales (invoices), Purchases, Accounting, Banking, Reports. [Wave manual (2020)](https://www.meruaccounting.com/wp-content/uploads/2022/08/2.-Wave-App-Manual.pdf)
- **Notable:** "**Average time to get paid**" per client is directly useful for our worst-case runway.

### QuickBooks Self-Employed → QuickBooks Solopreneur
- Self-Employed was discontinued and replaced by **Solopreneur** (2024). Solopreneur estimates federal quarterly tax, tracks mileage by GPS and categorises income and expenses. [NerdWallet](https://www.nerdwallet.com/article/small-business/quickbooks-self-employed-review), [FitSmallBusiness](https://fitsmallbusiness.com/quickbooks-solopreneur-review/), [Intuit blog](https://quickbooks.intuit.com/r/product-update/quickbooks-self-employed-vs-quickbooks-solopreneur)
- The old dashboard showed profit and loss, expenses, accounts, invoices, mileage and estimated taxes. The current Solopreneur tabs are **(unverified)**.

### freee / Money Forward Cloud (for sole proprietors, 個人事業主)
- **freee会計:** Home shows each account's **book balance next to its synced (real) balance**, plus links to frequent tasks. The iOS app for sole proprietors has an Account tab. [freee support](https://support.freee.co.jp/hc/ja/articles/115000528926). Invoices and receivables (売掛) are core features. [Google Workspace listing](https://workspace.google.com/marketplace/app/%E3%82%AF%E3%83%A9%E3%82%A6%E3%83%89%E4%BC%9A%E8%A8%88%E3%82%BD%E3%83%95%E3%83%88_freee_%E3%83%95%E3%83%AA%E3%83%BC/1074817653597?hl=vi)
- I could not verify the mobile tab layouts for freee or Money Forward Cloud. Both are accounting-first: built for filing, not for checking every day.

---

## 2. Why people open money apps every day

- **52%** open their most-used banking or finance app **daily**, and **23%** open it several times a day (MX research, Oct 2025, as reported in a press release; I could not fetch the original). [MX via press release](https://business.mammothtimes.com/mammothtimes/article/gnwcq-2025-10-27-new-mx-research-shows-most-consumers-cant-live-without-their-favorite-mobile-banking-apps)
- **38%** check their balance daily and 82% weekly or more (SoFi survey, undated). Bank of America (2016): 35% of mobile users open the app at least daily. [ABA Banking Journal](https://bankingjournal.aba.com/?p=7664)
- **The top reason is checking the balance:** 81% (BofA 2014), 85% balances and statements (BofA 2016), then transfers (49%) and bills (48%). [BofA 2014 report](https://static.thefinancialbrand.com/uploads/2014/08/2014_BofA_Trends_in_Consumer_Mobility.pdf), [BofA 2016](https://eu-assets.contentstack.com/v3/assets/blt7dacf616844cf077/blt8710c0af924c2fac/679925be9b81e81803c99568/2016_BAC_Trends_in_Consumer_Mobility_Report.pdf)
- **Nearly 9 in 10 use alerts** for fraud, **deposits** ("did I get paid?") and low balance. [ABA](https://bankingjournal.aba.com/?p=7664)
- In short, a daily open is a **5-second check**: How much do I have? Did money land? Is anything wrong? Charts and analysis are weekly or monthly activities, which is why Money Forward moved reports to My page and Monzo moved Trends off the bar.

## 3. What users praise and complain about

- **Praise for one clear number:** reviewers liked Simple's Safe-to-Spend because it replaced the raw balance with "how much can I spend". [PCWorld](https://www.pcworld.com/article/402233/simple-review-budgeting-financial-app.html), [Atomic Object case study](https://spin.atomicobject.com/?p=156661). PocketGuard markets itself as "a budgeting app built around one number". [Penny Hoarder](https://www.thepennyhoarder.com/?p=226665)
- **The number has to be trustworthy:** Simple's figure broke when card spending wasn't visible, and users had to work around it by hand. [Atomic Object](https://spin.atomicobject.com/?p=156661). PocketGuard's "In My Pocket" showed **negative** because of miscalculations, and its model **assumes regular paychecks**, which fits freelancers badly. [AJC review](https://www.ajc.com/news/pocketguard-review-5-things-to-know-about-the-budgeting-tool/CP275HF3W5DSZPVVSKKVONML2I), [PocketGuard help](https://pocketguard.com/help/leftover)
- **Overload:** crowded dashboards overwhelm new users ([Modest Money on Moneydance](https://www.modestmoney.com/reviewing-moneydance-complaints-and-problems)). Too many competing options on Wise's home ([Pratt critique](https://ixd.prattsi.org/2025/09/design-critique-wise-ios-app/)). Money Forward cut a tab because users "couldn't reach" features ([Impress](https://www.watch.impress.co.jp/docs/news/2134734.html)). First-week complaints centre on "too complicated" setup ([Unstar comparison](https://unstar.app/blog/ynab-rocket-money-monarch-everydollar-copilot-budget-apps-ranked-2026); vendor blog, so treat as anecdotal). I found **no formal usability study** on chart density. The evidence is reviews and redesign rationale.
- **Redesign pain (Monzo):** content that was hard to find (pots), features removed (running balance), tabs taking prime space for rarely used screens (Help). [Retrospective](https://community.monzo.com/t/monzo-redesign-a-retrospective/95953)
- **Clear labels:** Simple's terms "ready" and "coming-up" confused people at first. [Atomic Object](https://spin.atomicobject.com/?p=156661)

---

## 4. Patterns that matter for us

1. **3–5 bottom tabs, never more.** Material says 3–5 destinations, because more than 5 puts tap targets too close together ([Material bottom nav](https://chromium.googlesource.com/external/github.com/material-components/material-components-ios/+/v55.5.0/components/BottomNavigation/README.md)). Larger screens use a **navigation rail or sidebar** ([M3 nav rail via SAP Fiori](https://www.sap.com/design-system/fiori-design-android/v26-4/components/m3-standard-components/navigation-rail/usage)). Real apps: PayPal DE 3, Monzo 3–4, Wise 4, YNAB 5, Revolut 5, Money Forward 5, Monarch 5 + sidebar. (I could not fetch Apple's HIG; iOS convention is also ≤5 with "More".)
2. **The first tab is a short "today" screen, not a dashboard of everything.** Copilot is the template: one number → review queue → upcoming → one summary. YNAB: alert → priorities → summary. Monzo moved wealth to Grow to keep Home about the day.
3. **One headline number, defined plainly and with a horizon.** Copilot's "Free to Spend … left" this month, PocketGuard's "Leftover / In My Pocket" (income − bills − budgets − goals), Simple's "Safe-to-Spend" (balance − expenses − goals). For freelancers the honest version is horizon-based (until the next money lands), not monthly, because income is irregular (PocketGuard's weakness).
4. **"Needs you" is a queue at the top of Home, not a tab.** Copilot's To Review section, YNAB's top alert plus swipe card mode (approve / skip), Cash App's Moneybot (suggest → confirm). Badge the count. Each card shows what was read, from where, and one primary button.
5. **Upcoming bills appear as a short horizontal list on Home and a full calendar elsewhere.** Copilot Upcoming (horizontal), Rocket Money Upcoming bills, Monarch Recurring calendar, Copilot Recurrings "left to pay".
6. **Card views use exactly three facts plus a status.** Statement amount (provisional vs final), due/withdrawal date, paying account (Rakuten / Vpass). Add the Apple Card idea: a big check when "pay in full = no interest". Our extra: **"Covered ✓ by [source]"**.
7. **Travel/foreign spend is a filter or view inside spending, not a tab.** Revolut groups by country and currency and detects trips automatically. Wise organises balances by currency.
8. **Get paid is a first-class action.** PayPal: Request → Send invoice. Wise: request from balance / Payments / Recipients, plus payment links tracked paid/unpaid. Found and Lili: invoices next to banking. Wave: overdue, due in 30 days, **average time to get paid**.
9. **Activity is reached in one tap** (Cash App Activity tab, PayPay history icon under the barcode, PayPal Account › transactions). Search and filters live there, not on Home.
10. **Reports and settings move off the bar** (Money Forward My page, Monzo Help removed, YNAB Help removed). Use a profile/avatar entry at the top.
11. **Capture is a primary action** (Zaim input, PayPay scan, Revolut quick actions): one obvious "+" to forward or photograph a bill or receipt.
12. **Desktop:** the same sections become a left sidebar (Copilot web/iPad, YNAB web, Monarch, Wave). Home becomes 2 columns, never a longer page.

---

## 5. Recommended structure for our app

Below are generic tab names (no borrowed trademarks). There are 5 tabs, plus a "+" capture button and a top-right profile/menu.

### Top number on Home: **"Safe to spend"** with a date horizon
> **¥84,000 safe to spend** · until **Nov 28**, when Acme's $1,200 is due to land
> Small line under it: "Cash ¥412,000 (PayPal ¥260k + bank ¥152k) · ¥328,000 already spoken for"

- **Definition:** cash available now (PayPal + bank, converted to home currency) − everything due before the next client money lands **on its worst-case date** (bills, card statements, tax set-aside, a small buffer). It is horizon-based, not a calendar month, because freelance income is irregular. That fixes the paycheck assumption that makes PocketGuard-style numbers fail.
- **Verdict chip next to it:** **Go** / **Go easy** / **Hold off**. This answers question 2 in one word. Tapping the number opens the breakdown (Copilot and PocketGuard both make the calculation tappable). Trust depends on users being able to see the maths.
- Show the raw total cash as the second line, not the headline. Balance is the #1 daily check, so it must be visible, but the decision number is what makes us different.

### Tab 1: **Today** (home; the only tab most daily visits need)
Top to bottom:
1. Safe-to-spend number, verdict chip, cash line (above).
2. **"Can I afford…?"** input: type ¥ amount → instant answer ("Yes, still ¥34k safe until Nov 28" / "Only if Acme pays on time").
3. **Needs you** (max 3 cards, then "See all 5"): AI approval cards. Kinds: "Read from your email: Electric bill ¥8,420 due Nov 20. Correct?" [Confirm] [Edit]. "Card spend ¥12,300 at … (from card email). Add?" "You'll be ¥40k short on Nov 26. Draft invoice to Acme for $300?" [Review draft]. Approve/skip, like YNAB's swipe card mode. Each card names its source (email, photo, PayPal).
4. **Coming up (next 7 days)**: horizontal chips, each with a ✓ Covered / ⚠ Short status: bills, card withdrawals, expected client payments.
5. **Mini runway**: one small sparkline for 30 days with the low point labelled. Tap → Plan tab. No other charts here.
6. **Found for you**: one quiet line ("2 ways to save ~¥6,000/mo ›"). Collapsed by default, opens the full list in Profile › Found for you.

### Tab 2: **Plan** (the 30-day runway; "will I be OK?")
1. Toggle **Expected | If clients pay late**.
2. 30-day runway chart: two lines, low-point marker, a "short" zone shaded.
3. **Timeline list** under the chart: every dated event in order (bills, card statements, client payments, tax set-aside), each with a running balance (Monzo users missed their running balance) and a covered/short tag.
4. **Who pays when**: client list with expected date, worst-case date and average days late (Wave's "average time to get paid").
5. The "If short" plan: suggested moves (draft invoice, chase a late client, delay a payment). Each opens an approval card.

### Tab 3: **Cards** (credit, statements, and how you pay them back; question 3)
1. One block per card: **This statement ¥X (provisional / final)**, **closes** date, **withdrawal** date and **from which account**, then status **Covered ✓ by bank balance** or **Covered after Acme pays on Nov 25** or **⚠ ¥18k short**.
2. **Payback plan**: "Pay ¥120,000 on Dec 10 from the Acme invoice (lands Nov 28, worst case Dec 5)". If the worst case is later than the due date, it is flagged, with a one-tap way to draft an invoice or move money.
3. Spend this cycle: a category list, with a small bar at most.
4. **Abroad / foreign currency**: a filter chip on the card spend list (**All · Home currency · Abroad · USD · EUR**), plus an auto-grouped "Trip: Seoul, Nov 3–7 · ¥64,200 · FX fees ¥1,900" card when 2 or more foreign transactions span 2 or more days (Revolut Trips rule). Travel lives **here, not in its own tab**.

### Tab 4: **Get paid** (clients and invoices)
1. Summary row: **Owed to you $X · Overdue $Y · Due in 30 days $Z**.
2. Invoice list grouped **Overdue / Due soon / Paid**, with status and "remind" (respect PayPal's limit of 2 manual reminders per 24 hours).
3. **Drafts from the assistant**: invoice drafts waiting for your approval. These are the same cards as Today's Needs you, so there is a single source of truth.
4. "New invoice" button (also in the "+" menu).
5. Per-client detail: history, average days late, preferred currency, and expected FX (USD → JPY) shown on what you will receive.

### Tab 5: **Activity** (inbox + everything that happened)
1. Segmented control: **To check (n) | All activity**.
2. **To check**: the full queue of AI-read items (forwarded bills, card-use emails, photographed receipts) waiting for confirmation, in YNAB-style card mode (swipe to approve/skip) on mobile and list mode with bulk confirm on desktop (Copilot web).
3. **All activity**: one feed across PayPal, bank and cards, with search, filters (account, card, currency, abroad, client) and a running balance. Each item shows where we got it (PayPal API, email, photo).
4. Top: your forwarding address and an "Upload photo" button.

### Global elements
- **"+" capture button** (centre of the bottom bar on mobile, top of the sidebar on desktop): Photo of receipt · Paste/forward email · New invoice · Add a bill.
- **Profile (top-right avatar)**: Found for you (full list), connected accounts, currencies, tax set-aside %, notifications, settings. Same idea as Money Forward's My page: rarely used screens stay off the bar.
- **Notifications** (for push and email; reflects the "did I get paid?" daily habit): "Acme paid $1,200 → safe to spend is now ¥196,000", "Card withdrawal tomorrow ¥120,000: covered ✓", "Heads up: if Beta pays late you'll be short on Nov 26".

### Mobile vs desktop
- **Phone:** bottom bar **Today · Plan · [+] · Cards · Get paid**, with Activity reached from a badge or inbox icon in the Today header, **or** 5 tabs **Today · Plan · Cards · Get paid · Activity** with "+" floating. Pick one. My recommendation is the 5 tabs plus floating "+", because Activity holds the "To check" queue and deserves one tap.
- **Desktop (the demo video):** left sidebar with the same 5 items, a "+" at the top and profile at the bottom. **Today in 2 columns:** left = number + "Can I afford" + Needs you cards; right = Coming up + mini runway + Found for you. Every other tab is 1 main column with a detail panel on the right (click an invoice or bill → details slide in), as on Copilot web and Wave. That keeps the "long page" problem from coming back.

### Mapping our current single page to the tabs
| Current block | New home |
|---|---|
| Runway chart | Plan (full) + Today (sparkline) |
| "Needs you" action card | Today (top 3) + Activity › To check (all) + Get paid › Drafts (invoice drafts) |
| Moment cards | Today › Needs you / Coming up (merge; don't keep a separate block) |
| Cards panel | Cards |
| Due soon list | Today › Coming up (7 days) + Plan › Timeline (30 days) |
| Who pays when | Plan › Who pays when + Get paid |
| Activity log | Activity › All activity |
| Found for you | Today (one line) + Profile › Found for you |

---

## 6. Things I could not verify
- The current US PayPal app tab bar (only the German 2026 version and the US 2021 version are documented).
- The exact Wise, Monzo, Monarch, Cash App, Found, Lili, QuickBooks Solopreneur, freee and Zaim tab labels and order. These are noted inline as unverified.
- Money Forward ME's Home section order.
- Apple HIG tab-bar text (page not fetched). Material's 3–5 rule comes from a mirror of the Material docs.
- MX 2025 stats are from a press-release mirror; the original couldn't be fetched (SSL error).
- No peer-reviewed study on "too many charts" in money apps; that evidence is anecdotal (reviews, redesign notes).
