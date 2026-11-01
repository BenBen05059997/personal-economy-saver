# Desktop web app shells of real money products

This covers the logged-in desktop web app, not marketing sites or phone apps. Researched 2026-11-01.

**Evidence key**
- **[M] Measured.** Measured live in a browser at a 1440x900 viewport. Only Mercury could be measured, using its public demo at demo.mercury.com.
- **[D] Documented.** Stated in the vendor's official help or docs.
- **[I] Inferred.** Based on recollection of the product, third-party screenshots and reviews, or analogy. Treat every [I] line as a hypothesis to check against a real screenshot before copying it.

Many help centres (Wise, Wave, Monarch, freee, Mercury support, Revolut) returned 403 or 404 to automated fetches. Their entries rely more heavily on [I].

---

## 1. Mercury (business banking): the best-evidenced reference
Source: https://demo.mercury.com/dashboard (public demo, measured [M]). Also https://mercury.com/blog/march-2026-product-updates (Insights in the sidebar [D]).

- **Navigation [M]:** Left sidebar, exactly **220px** wide, full height below a top bar of about 56px.
  - Top of the sidebar: org switcher ("Mercury Demo") and a segmented switch: Banking | Payroll | Books.
  - Group 1: Home, Tasks (count badge "10"), Command ("New").
  - Group 2: Accounts, Transactions (sub-item Insights), Cards, Team Spend, Payments, Invoicing, Accounting.
  - Group 3, "Bookmarks": user-pinned accounts with balances, Credit Card, Bill Pay, Insights.
  - That is about 10 primary items in 2 to 3 groups. The profile is an avatar at the top right, not at the bottom of the sidebar.
- **Top bar [M]:** "Search for anything" on the left, aligned with the content. On the right: **"Move money"** (the primary action), a hide-balances toggle, settings, a bell and the avatar. There is no "+ New" button.
- **Home [M]:**
  - Order: "Welcome, Jane" (28px, weight 380), then a row of pill action buttons (Send primary, then Transfer, Deposit, Request, Upload bill), then a 2-column card grid.
  - The first card is "Mercury balance" at **28px**, the same size as the H1, with a 30-day area chart. Beside it is an Accounts list card. The next row has Credit Card, Bill Pay (Outstanding 11 / Overdue 1, "Inbox 3 items"), and others.
  - Above the fold: the greeting, the actions row and 2 large cards, with the third row just starting.
  - The hero number is modest (28px light weight), not a giant display figure.
- **List and detail [M]:** The Transactions table is full-width.
  - Clicking a row opens a **floating right-hand panel of about 420px**. The list stays visible and the selected row is highlighted.
  - The URL changes to `/transactions/<id>`, so the detail can be deep-linked.
  - The panel holds the amount, merchant, a timeline, category, GL code, and a comment box at the bottom.
- **Width [M]:**
  - Home has a **fixed max width of 968px, centred** in the area right of the sidebar.
  - The Transactions table is **fluid** and scrolls horizontally.
  - The page header above the table holds summary numbers: Net change, Money in, Money out.
- **Visual details [M]:**
  - Body text 16px. Font "Arcadia Text" with a system-ui fallback.
  - Cards have a 12px radius, a 1px hairline border at about 10% opacity, and **no shadow**.
- **What feels normal:** A calm sidebar, one primary action in the top bar, a narrow centred home and a wide table, and detail in a side panel with its own URL.

## 2. Stripe Dashboard
Source: https://docs.stripe.com/dashboard/basics [D]

- **Navigation [D]:** Left sidebar.
  - Section 1: Home, Balances, Transactions, Customers, Product catalog.
  - "Shortcuts": pinned and recent pages.
  - "Products": Connect, Payments, Billing, Reporting, and "More" (Workflows, Tax, Identity, Issuing, Capital…).
  - Developers and Settings sit low in the sidebar [I]. The account switcher is at the top left [I].
  - About 5 core items, then grouped product sections.
- **Top bar [I]:** A wide search ("Search", with `?` for shortcuts per [D]). On the right: help, notifications bell, settings gear, and a **"+" create** menu.
- **Home [D/I]:**
  - [D]: Analytics and charts, plus important notices: open disputes, verification needed. Widgets can be customised with "Add" and "Edit".
  - [I]: The first block is "Today", with a gross-volume line chart and the number beside it. Next is "Your overview", a 2 to 3 column widget grid.
  - The hero number is about 24 to 28px.
- **List and detail [I]:** Clicking a payment, customer or invoice opens a **full detail page**. Create and edit flows open as **right-hand drawers** or focused full-screen editors (invoice editor).
- **Width [I]:** Fluid, with generous side padding. Very wide screens get a max width of about 1200 to 1400px.
- **What feels normal:** Notices that need action are mixed into Home rather than shown as a separate alarm. Search is the main top-bar element.

## 3. PayPal web (personal, logged in)
Sources:
- https://www.paypal.com/us/cshelp/article/paypal-app-business-account-update-whats-new-help1366 (Business app refresh from June 2026, app not web [D])
- Third-party guide: "click Activity at the top of the page" ([D] via a secondary source)

- **Navigation [I, partly D]:** **Top nav**, not a sidebar: logo, Home, Send and Request (labelled "Send"/"Request" in some regions), Wallet, Activity, Help. On the right: bell, settings gear, Log Out. About 5 items.
- **Top bar [I]:** Same as the nav. No global search box; search lives inside Activity.
- **Home [I]:**
  - Two columns, fixed width. The left column, about 1/3, holds the PayPal balance card (hero number about 32 to 40px, with a "Transfer money" link), then Send / Request shortcut tiles.
  - The right column, about 2/3, holds "Recent activity".
  - 2 to 3 modules above the fold.
- **List and detail [I]:** Activity is a date-grouped list with search and filter chips (date, type). A row opens a **separate transaction-detail page** (`/activity/payment/<id>`), not a drawer.
- **Width [I]:** Fixed max width of about 1100 to 1200px, centred.
- **Business accounts [I]:** They use a different shell, a left sidebar with Home, Activity, Pay & Get Paid, Financial Services, Reports, Apps…
- **What feels normal:** A balance card plus recent activity, which is the consumer-wallet pattern. It is dated next to sidebar shells, though.

## 4. Wise web
Source: https://wise.com/help/articles/0pZf4t8FdGwauVsQGiHqD/why-does-wise-look-different [D, general]. The layout details are [I].

- **Navigation [I]:** Left sidebar: Home, Cards, Recipients, Payments (on business accounts: Payments, Team, Insights, Account). The profile and account switcher are at the top or bottom of the sidebar. About 5 to 7 items.
- **Top bar [I]:** Minimal: notifications and the profile avatar. **"Send"** is the primary green pill, at the top of the home content and sometimes in the sidebar.
- **Home [I/D]:**
  - First comes the total balance (large, about 36 to 48px in Wise Sans), with Send / Add money / Request buttons.
  - Next is a horizontal row of currency balance cards and Jars ([D] says Home shows currencies, jars and groups), then "Transactions".
  - About 3 modules above the fold.
- **List and detail [I]:** Clicking an activity opens a **detail view**: a full page on older builds, an overlay or side panel on newer ones.
- **Width [I]:** Fixed and centred, about 900 to 1100px.
- **What feels normal:** One clear "Send" action, balances as cards, and activity below.

## 5. Revolut web (personal)
Sources:
- https://www.revolut.com/blog/post/introducing-the-revolut-web-app/
- https://help.revolut.com/en-JP/help/more/revolut-web-app/what-features-are-supported-on-the-web-app/ [D: account overview, transactions, cards, statements, freeze card, PIN, chat]

- **Navigation [I]:** Left sidebar (Home, Payments/Transfers, Cards, Crypto, Stocks/Invest, Hub), or a top nav on some builds. **Low confidence.** A review notes it is "not 1:1 with mobile", covering only core features.
- **Top bar [I]:** Search, notifications, and chat/help at the top right.
- **Home [I]:** Balance hero (about 40px) with Add money / Move / More pill buttons, then a transaction list. It mirrors the mobile home stretched into a centred column.
- **List and detail [I]:** A transaction opens a **right-side panel or modal sheet**.
- **Width [I]:** Fixed and centred, about 900 to 1000px.
- **What feels normal:** Familiarity with the phone app. The desktop shell is thin.

## 6. Monzo web
Sources:
- https://www.finextra.com/pressarticle/74409/monzo-launches-web-interface
- https://monzo.com/blog/2020/04/01/monzo-business-for-web-is-here
- https://community.monzo.com/t/desktop-version-of-the-monzo-app-full-feature-monzo-web/64995

- **Personal [D]:** There is no full desktop app. "Monzo Web" is an emergency-lite interface: freeze card, see balance and recent transactions. It is a single narrow centred column.
- **Business web [D/I]:** It launched using the "same layout as Monzo Emergency" [D]. Later it gained a left nav with Home, Payments, Invoices, Tax pots, Team, Settings [I].
- **List and detail [I]:** List, then a detail page.
- **What feels normal:** Nothing in particular. It is a counter-example: a phone app with web as an afterthought. Users ask for a real desktop version years on, which shows that desktop absence is noticed.

## 7. Copilot Money (Mac app and web, web launched Dec 2025)
Sources:
- https://9to5mac.com/2026/01/01/copilot-money-brings-clarity-to-your-finances-now-on-the-web/ [D: 8 sections]
- The Penny Hoarder review, Mar 2026 (web lacks Goals, Cash Flow, and month-in-review)

- **Navigation [D names / I placement]:** Left sidebar: Dashboard, Transactions, Investments, Accounts, Categories, Recurrings, Goals, Cash Flow. That is 8 items, with fewer on the web at launch. Profile and settings are at the bottom [I].
- **Top bar [I]:** Practically none. The page title sits in the content area, and search and filter live inside Transactions.
- **Home [D/I]:**
  - "Big-picture overview of spending, income, recent transactions", plus month progress, upcoming recurrings and trending categories [D].
  - First comes the month's spend versus budget, as a big number with a cumulative-spend line chart against last month [I].
- **List and detail [I]:** In the Mac app a row opens a **right-hand inspector pane**. The web app mirrors this with a side panel.
- **Width [I]:** Fluid with a max width.
- **What feels normal:** An Apple-like sidebar app, one chart that answers "am I on pace", and dense but quiet lists.

## 8. YNAB web
Sources:
- https://support.ynab.com/en_us/navigating-multiple-plans-r1qeOvbC5 [D]
- https://support.ynab.com/en_us/the-plan-header-BkmiuJ_C9.md [D]
- https://support.ynab.com/en_us/reflect-in-ynab-B1GJsrWkj [D]

- **Navigation [D]:** Dark left sidebar, collapsible.
  - **The plan name sits at the top of the sidebar.** It is the menu for settings, switching plans, and creating a new plan.
  - Then Plan, Reflect, All Accounts.
  - Then accounts grouped by type (Cash, Credit, Loans, Tracking) with balances, and "+ Add Account" at the bottom [I].
- **Top bar [D/I]:** No global top bar. The "plan header" holds the month selector, **"Ready to Assign"** (a big green or red box, the hero number) and the Auto-Assign entry.
- **Home [D]:** The Plan screen is the home: a category table (Assigned / Activity / Available).
- **List and detail [D]:**
  - A **right sidebar inspector** (Auto-Assign, the selected category's targets and balances) updates with the selection.
  - The account register edits **inline in the row**. There is no drawer and no page change.
- **Width [I]:** Fluid. The table stretches; the inspector is fixed at about 300 to 360px.
- **What feels normal:** One master number ("Ready to Assign") and one master table, with a contextual inspector on the right.

## 9. Monarch Money web
Sources:
- https://www.monarch.com (product shots)
- https://robberger.com/monarch-money-review/ (reviews of tab names)

- **Navigation [I, names corroborated by reviews]:** Left sidebar (about 220 to 240px): Dashboard, Accounts, Transactions, Cash Flow, Reports, Budget, Recurring, Goals, Investments, Advice. That is about 10 items. Help, settings and profile are at the bottom.
- **Top bar [I]:** None globally. Each page header carries its own actions: "+ Add transaction", Edit, and a date-range control.
- **Home [D via reviews/I]:**
  - "Good morning, Name", then a customisable widget grid (2 columns).
  - Widgets: spending vs last month (a cumulative line chart with a big number), budget, recent transactions, net worth, upcoming recurring, investments, goals.
  - Above the fold: greeting plus 2 to 4 widgets.
- **List and detail [I]:** A transaction row opens a **right-hand drawer** (merchant, category, tags, notes, splits, attachments) over the list.
- **Width [I]:** Fluid with a max of about 1200 to 1400px.
- **What feels normal:** This is the canonical consumer-finance desktop shell today.

## 10. Wave (invoicing and accounting)
Sources:
- https://support.waveapps.com/hc/en-us/articles/32453204338324 (overview, via search snippet [D])
- https://support.waveapps.com/hc/en-us/articles/48497863638548 (new Dashboard [D])

- **Navigation [D]:** Left sidebar: Dashboard, Sales & Payments (invoices, estimates, checkouts, customers, products), Purchases (bills, vendors), Accounting (transactions, chart of accounts), Banking, Payroll, Reports, Wave Advisors / Tax. That is about 8 to 9 groups that expand into sub-items. The business switcher is at the top and the profile at the bottom [I].
- **Top bar [I]:** A **"Create new"** button (invoice, bill, customer…), notifications and help.
- **Home [D]:** New dashboard. It has a "Switch back" option at the top right. Users can't customise the dashboard's content [D].
  - [I]: It shows cash flow, money owed (invoices due / overdue), bills due, and profit & loss. It is chart-heavy.
- **List and detail [I]:** An invoice opens as a **full page** (preview of the document plus status and actions).
- **Width [I]:** Fixed and centred, about 1100 to 1200px.
- **What feels normal:** Accounting-style grouped navigation and "overdue" counts on the dashboard.

## 11. Found (sole-proprietor banking)
Source: https://found.com (product shots) [I]. Found's help centre was not reachable.

- **Navigation [I]:** Left sidebar: Home, Transactions, Invoices, Taxes, Reports, Contacts/Pockets, Cards. About 7 items. Settings and profile are at the bottom.
- **Top bar [I]:** Minimal, with a "Move money" or "Pay" primary action.
- **Home [I]:** The balance first, then a tax set-aside module, then recent transactions needing categorisation.
- **List and detail [I]:** A **right drawer** for categorise / receipt.
- **Width [I]:** Fixed and centred.
- **What feels normal:** "Needs categorising" as a count on Home.

## 12. Money Forward ME (web)
Sources:
- https://internet.watch.impress.co.jp/docs/yajiuma/1264240.html [D: July 2020 web redesign rolled back after 2 days]
- https://prtimes.jp/main/html/rd/p/000001660.000008962.html (app)

- **Navigation [I]:** **Top global nav**: ホーム, 家計簿 (入出金 / 月次推移 / 収支内訳…), 資産, 将来設計, レポート, 口座, 設定, with submenus as tabs under each. About 6 to 7 items.
- **Top bar [I]:** Logo, the global nav, user and premium links, help.
- **Home [I]:**
  - A fixed 2-column layout. The main column holds 資産総額 (hero yen figure) with a stacked bar chart, then 当月収支 and the latest 入出金.
  - The **right column lists linked accounts** with their last-update status and "一括更新".
- **List and detail [I]:** The 入出金 table edits inline or in a small modal (category, memo). There is no side drawer.
- **Width [I]:** **Fixed at about 960 to 1080px, centred.** This is a legacy portal width.
- **What feels normal:** For Japanese users, a top-nav portal with account sync status visible.
- **Lesson [D]:** The 2020 redesign removed features and changed the familiar layout. It was reverted in 2 days, and the CEO admitted it was "partly hard to use". Asset-management power users punish lost density.

## 13. freee会計
Sources:
- https://support.freee.co.jp/hc/ja/articles/40849745400857 (新メニューバー 活用ガイド [D, via search snippet])
- https://www.freee.co.jp/blog/product-update-20201215.html (home renewal)

- **Navigation [D/I]:**
  - [D]: The "新メニューバー" is ordered by the flow from bookkeeping to closing, with submenus by usage scene. AR sits under 「請求・入金」 and AP under 「発注・経費・支払」.
  - [I]: Historically a blue **top** header menu, so placement (top or left) is unconfirmed.
- **Top bar [I]:** Business switcher, search, notifications, help, user.
- **Home [D 2020/I]:**
  - The "sync all accounts" button sits at the top, and up to 4 custom shortcut buttons can be configured [D].
  - Then to-dos (未処理明細 counts), cash balances, and P&L charts [I].
- **List and detail [I]:** 取引 lists expand rows inline or open full edit pages. There are some side panels in newer screens.
- **Width [I]:** Fluid tables.
- **What feels normal:** Work-flow-ordered menus and to-do counts.

## 14. マネーフォワード クラウド会計 / 会計Plus
Sources:
- https://biz.moneyforward.com/support/ac-plus/guide/others/home.html [D]
- https://biz.moneyforward.com/support/account/guide/others/ot06.html [D]
- https://biz.moneyforward.com/support/mypage/news/20260827.html [D]

- **Navigation [D]:** **Left side menu, collapsible** ("閉じる" folds it). The items shown depend on permissions. A service-switcher icon is at the top left.
  - [I]: ホーム, 取引入力・仕訳, 帳簿, レポート, 決算・申告, 各種設定, データ連携.
- **Top bar [D, Plus]:**
  - Service switcher, logo (home), a megaphone for notices, "?" help, fiscal year with ‹ › arrows, business name, and the user menu.
  - **Counts of 未申請 / 差戻し / 未承認 journal entries**, each clickable to its queue.
  - This is the clearest "needs you in the header" example found.
- **Home [D, standard edition]:** 残高合計 (balance total), 一括再取得 (re-sync all), "+データ連携新規登録", linked-service status, お知らせ, and AI chat support.
- **Unread counts [D]:** The MF Cloud My Page shows **unread 社内お知らせ counts in the left menu**, added August 2026.
- **List and detail [I]:** Journal lists open edit in a modal or a full page.
- **Width [I]:** Fluid.
- **What feels normal:** Approval counts are always visible and one click from the queue.

## 15. Zaim (web)
Sources:
- https://thebridge.jp/2013/05/zaim-web-ver
- https://forest.watch.impress.co.jp/docs/serial/androidlab/20130515_599333.html

- **Navigation [I]:** Top nav: ホーム, 入力, 履歴, 分析, 口座, 設定. About 6 items.
- **Top bar [I]:** Same as the nav.
- **Home and analysis [D 2013]:** The web version was positioned as "enter on the phone, analyse on the big screen", with pie charts and daily charts and weekly comparisons. It also had a keyboard-only input mode.
- **List and detail [I]:** History opens an edit modal.
- **Width [I]:** Fixed at about 960px, centred.
- **What feels normal:** Web as the analysis companion to the phone app.

## 16. PayPay for Business (web 管理画面)
Sources:
- https://paypay.ne.jp/help-merchant/b0809/ [D]
- https://paypay.ne.jp/help-merchant/b0391/ [D]

- **Navigation [D/I]:**
  - [D]: A "メインメニュー" with [取引] (865 days of history) and [入金] (payout history, latest 1 year by default). The store/brand switcher is at the top left (brand view vs store view).
  - [I]: The menu is a left sidebar with ホーム, 取引, 入金, 店舗, キャンペーン, 設定.
- **Top bar [I]:** Store switcher, notices, help, account.
- **Home [I]:** Today's and this month's sales, the next payout date and amount, and notices.
- **List and detail [D]:** The 取引 page has a **chart of count and amount at the top and the list below**, with filter buttons (期間, 取引種別) that turn blue when active.
  - [I]: A row opens a detail page.
- **Width [I]:** Fluid.
- **What feels normal:** Chart-over-table for the transaction history, and an active-filter state on the buttons.

## 17. 楽天カード e-NAVI (PC)
Sources:
- https://www.rakuten-card.co.jp/service/e-navi/
- https://www.rakuten-card.co.jp/e-navi/p/rc/e-navi/statement/guide.html [D]

- **Navigation [D]:** **Top global nav.** The PC path is 「画面上部の『お支払い(ご利用明細)』」; the phone version uses a hamburger at the top left.
  - [I]: Items: お支払い(ご利用明細), ポイント, カード設定, キャンペーン, お手続き.
- **Home [D]:** 今月のご請求金額 and お支払い日 are shown on the top page right after login. This is the hero.
- **List and detail [D]:** The statement table can be sorted by 利用店名, 利用者, 支払方法, 利用日 and 金額, with a card switcher.
  - [I]: There is no row detail panel. Details are shown inline.
- **Width [I]:** **Fixed at about 960 to 1000px, centred**, with dense banners and campaign tiles.
- **What feels normal:** The amount due and due date first. Everything else is a portal.

## 18. Vpass (三井住友カード, PC)
Sources:
- https://www.smbc-card.com/company/news/news0001128.jsp (2015 renewal [D])
- https://www.smbc-card.com/mem/vps/welcome/index.jsp

- **Navigation [I]:** Top nav with mega-menus: ご利用明細, お支払い, ポイント, 各種お手続き, キャンペーン.
- **Home [D app/I PC]:** The next payment amount appears once it is fixed, otherwise the month's running total. The PC version shows the same as a hero.
- **List and detail [I]:** WEB明細書 pages, with no drawers.
- **Width [I]:** Fixed at about 960 to 1000px, centred.
- **What feels normal:** The Japanese card-portal convention: fixed width, top nav, the bill amount as the hero.

## 19. Linear (non-finance reference)
Sources:
- https://linear.app/docs/peek [D]
- Reddit staff reply, Feb 2025: split view only in Inbox and Triage [D-ish]

- **Navigation [I]:** Left sidebar of about 220 to 250px, resizable.
  - Top: workspace switcher, then search and a **new-issue (compose) icon**.
  - Then **Inbox (unread count)**, My issues, a Workspace section (Projects, Views, Initiatives), and Teams with Issues, Cycles and Projects as sub-items.
  - Help and invite are at the bottom.
  - About 3 to 4 fixed items plus collapsible groups.
- **Top bar [I]:** No global top bar. Each view has a header row with its title, filter and display options.
- **Home [I]:** There is no dashboard. The first screen is My issues or Inbox.
- **List and detail [D]:** By default a row opens a **full page**. **Peek** (Space) previews it as an overlay or side panel. **Split view** (list plus detail) exists in Inbox and Triage.
- **Width [I]:** Lists are fluid. The issue page body is capped at about 700 to 800px, with a property sidebar at the right.
- **What feels normal:** Keyboard-first, an inbox count in the sidebar, and the primary "create" action in the sidebar header.

## 20. Notion (non-finance reference)
Sources:
- https://www.notion.com/help (help centre)
- https://www.landmarklabs.co/notion-tutorials/notion-page-width-default (width toggle [D])

- **Navigation [I]:** Left sidebar, about 240px by default and resizable.
  - Top: workspace switcher, then Search, Home and **Inbox**.
  - Then Favorites, Teamspaces, Private.
  - Settings, Templates and Trash are near the bottom.
- **Top bar [I]:** Breadcrumb on the left. On the right: Share, comments/updates, favourite, "…".
- **Home [I]:** "Good morning", then recently visited cards and upcoming events.
- **List and detail [I]:** A database row opens as **side peek** (right panel), **center peek** (modal) or a full page. This is configurable per database, with side peek as the common default.
- **Width [D/I]:**
  - [D]: Pages default to a **fixed reading width**, with a per-page "Full width" toggle.
  - [I]: The column is about 708px of text inside a container of about 900px.
- **What feels normal:** Narrow reading column, wide tables, and a choice of peek pattern.

---

## The normal shell, distilled

1. **A left sidebar, about 220 to 260px wide** (Mercury measured at 220px), full height, collapsible.
   - The top holds the org or workspace switcher.
   - The bottom holds help, settings or profile. Fintechs often put the avatar at the top right of the header instead (Mercury).
   - Top nav survives only in legacy consumer portals: PayPal personal, e-NAVI, Vpass, MF ME, Zaim.
2. **About 6 to 10 primary items in 2 to 3 labelled groups**, each with an icon and a label of 13 to 15px at a row height of about 32 to 36px.
   - Group 1 is overview-type items (Home, Tasks/Inbox).
   - Group 2 is money objects (Accounts, Transactions, Cards, Payments, Invoices).
   - Group 3 is optional user bookmarks or pinned accounts.
   - Anything beyond that goes under "More" (Stripe) or a mode switch (Mercury's Banking | Payroll | Books).
3. **"Needs you" items are counts in the chrome, not a separate page.**
   - Sidebar badges: Mercury "Tasks 10", Linear and Notion "Inbox".
   - Header counters: MF クラウド会計Plus 未申請 / 差戻し / 未承認.
   - A Home card per queue: Mercury Bill Pay "Overdue 1 · Inbox 3 items", Stripe disputes and verification notices.
   - Each count is one click from a filtered list.
4. **The primary action sits in the top-right of the header or as the first button on Home.**
   - It is a single named verb ("Move money", "Send") or a "+"/"Create new" menu.
   - Secondary actions sit in a pill row under the H1 (Mercury: Send · Transfer · Deposit · Request · Upload bill).
5. **The top bar is about 56 to 64px tall** with a wide search ("Search for anything", ⌘K) on the left. On the right: primary action, notifications bell, help/settings, avatar. There is no logo-heavy banner and no marketing.
6. **Home follows the pattern greeting or page title, then the actions row, then a 2-column card grid.**
   - The first card is the balance or "on pace" card with one chart.
   - Next to it is an accounts or queue card.
   - Above the fold at 1440x900 there are 2 to 4 modules.
   - Dashboards are a centred **fixed max width of about 960 to 1200px** (Mercury 968px).
7. **The hero number is modest: about 28 to 40px in a light or regular weight**, often the same size as the H1 (Mercury: 28px, weight 380, with smaller cents digits).
   - Typography scale: body 14 to 16px, table 13 to 14px, H1 24 to 32px, section labels 12 to 13px muted.
   - Numbers use tabular figures and right-aligned amounts.
8. **List and detail: the table is fluid and full width, and a row opens a right-hand panel of about 380 to 480px** (Mercury about 420px, a floating card).
   - The list stays visible, the row is highlighted, and the **URL changes** so the panel is linkable and survives refresh.
   - Full detail pages are for heavy objects (Stripe payment, Wave invoice).
   - Modals are reserved for create and confirm flows.
   - YNAB-style inline row editing is the alternative for spreadsheet-like data.
9. **Charts are few and functional.**
   - One area or line chart per balance card, often 30 days or month-to-date versus last month, with sparse axis labels.
   - Chart-over-table for history pages (PayPay for Business, Mercury summary strip: Net change / In / Out).
   - Charts are never decorative. They answer "am I on pace?" or "how much moved?".
10. **Surfaces are quiet.**
    - White or near-white background, cards with an 8 to 12px radius, 1px hairline borders, and little or no shadow.
    - One brand accent for the primary button and selected nav item. Green and red are reserved for money direction and errors.
    - Japanese portals add a fixed 960 to 1080px width and denser text, but keep the bill or balance as the first thing.

### Five signs a layout is *not* a normal product (avoid)

1. **A phone layout stretched onto desktop:**
   - A single centred column of about 375 to 480px, or a bottom tab bar on a 1440px screen.
   - Monzo's emergency web and the early Revolut web are cited by users as "not a real desktop app".
2. **A giant display hero number of 64px or more, or a full-bleed gradient hero banner on the app home.** That is marketing-site language. Real products keep the balance about the size of the H1.
3. **Every detail as a centred modal, or navigating away and losing list context.** Real apps use a side panel with a URL. Modals that stack two deep are a tell.
4. **More than about 12 flat top-level nav items, or nav with no grouping.**
   - The same applies to decorative charts (3D, donuts of 2 values, unlabeled sparklines everywhere) and heavy drop shadows or glassmorphism on every card.
5. **"Needs you" hidden behind a bell only, or shown as an alarming red banner.**
   - Normal products show a neutral count badge in the sidebar or header that links to a filtered queue.
   - Removing density or features familiar users relied on gets punished. Money Forward ME's 2020 web redesign was rolled back within 2 days.
